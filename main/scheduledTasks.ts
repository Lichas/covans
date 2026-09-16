import { Cron, type Cron as CronJob } from 'croner'
import { randomUUID } from 'node:crypto'
import type { ScheduledTask } from '../shared/types'
import * as db from './db'
import { emitEvent } from './events'
import { classifyObservationError, observe } from './observability'

type TaskRunner = (task: ScheduledTask, traceId: string) => Promise<{
  status: 'done' | 'error' | 'stopped'
  error?: string
}>

const jobs = new Map<string, CronJob>()
const running = new Set<string>()
let runner: TaskRunner | null = null

function stopJobs(): void {
  for (const job of jobs.values()) job.stop()
  jobs.clear()
}

function nextRun(job: CronJob): number | null {
  return job.nextRun()?.getTime() ?? null
}

async function executeTask(id: string, triggerSource: 'timer' | 'manual'): Promise<void> {
  if (running.has(id)) {
    observe('scheduled_task.skipped', { scheduled_task_id: id, outcome: 'already_running', trigger_source: triggerSource })
    return
  }
  const task = db.getScheduledTask(id)
  if (!task || !task.enabled || !runner) {
    observe('scheduled_task.skipped', { scheduled_task_id: id, outcome: !task ? 'missing' : !task.enabled ? 'disabled' : 'runner_unavailable', trigger_source: triggerSource })
    return
  }
  running.add(id)
  const startedAt = Date.now()
  const traceId = randomUUID()
  observe('scheduled_task.triggered', {
    scheduled_task_id: id, chat_id: task.chat_id, bot_id: task.bot_id,
    trace_id: traceId, trigger_source: triggerSource, schedule_kind: task.schedule,
    timezone: task.timezone,
  })
  db.updateScheduledTaskRuntime(id, {
    lastRunAt: startedAt,
    lastStatus: 'running',
    lastError: '',
  })
  try {
    const result = await runner(task, traceId)
    const current = db.getScheduledTask(id)
    if (!current) {
      observe('scheduled_task.deleted_during_run', { scheduled_task_id: id, chat_id: task.chat_id, bot_id: task.bot_id, trace_id: traceId, trigger_source: triggerSource, duration_ms: Date.now() - startedAt })
      return
    }
    const onceDone = current.schedule === 'once'
    const job = jobs.get(id)
    db.updateScheduledTaskRuntime(id, {
      enabled: onceDone ? false : current.enabled,
      nextRunAt: onceDone ? null : job ? nextRun(job) : current.next_run_at,
      lastStatus: result.status,
      lastError: result.error ?? '',
    })
    observe(result.status === 'error' ? 'scheduled_task.failed' : 'scheduled_task.completed', {
      scheduled_task_id: id, chat_id: task.chat_id, bot_id: task.bot_id,
      trace_id: traceId, trigger_source: triggerSource, result_status: result.status,
      error_code: result.error ? classifyObservationError(result.error) : null,
      duration_ms: Date.now() - startedAt,
      next_run_at: onceDone ? null : job ? nextRun(job) : current.next_run_at,
    })
    if (onceDone) {
      job?.stop()
      jobs.delete(id)
    }
  } catch (error) {
    const current = db.getScheduledTask(id)
    if (!current) {
      observe('scheduled_task.deleted_during_run', { scheduled_task_id: id, chat_id: task.chat_id, bot_id: task.bot_id, trace_id: traceId, trigger_source: triggerSource, duration_ms: Date.now() - startedAt, error_code: classifyObservationError(error) })
      return
    }
    const onceDone = current.schedule === 'once'
    const job = jobs.get(id)
    db.updateScheduledTaskRuntime(id, {
      enabled: onceDone ? false : current.enabled,
      nextRunAt: onceDone ? null : job ? nextRun(job) : current.next_run_at,
      lastStatus: 'error',
      lastError: error instanceof Error ? error.message : String(error),
    })
    observe('scheduled_task.failed', {
      scheduled_task_id: id, chat_id: task.chat_id, bot_id: task.bot_id,
      trace_id: traceId, trigger_source: triggerSource, result_status: 'error',
      error_code: classifyObservationError(error), duration_ms: Date.now() - startedAt,
      next_run_at: onceDone ? null : job ? nextRun(job) : current.next_run_at,
    })
    if (onceDone) {
      job?.stop()
      jobs.delete(id)
    }
  } finally {
    running.delete(id)
  }
}

/** 重建所有未来任务。重启时不补跑已错过的触发。 */
export function refreshScheduledTasks(): void {
  stopJobs()
  const now = Date.now()
  for (const task of db.listScheduledTasks()) {
    if (!task.enabled) continue
    if (task.schedule === 'once' && (!task.run_at || task.run_at <= now)) {
      db.updateScheduledTaskRuntime(task.id, {
        enabled: false,
        nextRunAt: null,
        lastStatus: 'missed',
        lastError: '应用未运行，已跳过错过的单次任务',
      })
      observe('scheduled_task.missed', { scheduled_task_id: task.id, chat_id: task.chat_id, bot_id: task.bot_id, schedule_kind: task.schedule, timezone: task.timezone })
      continue
    }
    try {
      const pattern =
        task.schedule === 'once' ? new Date(task.run_at!) : task.cron
      const job = new Cron(
        pattern,
        { timezone: task.timezone, protect: true, unref: true },
        () => void executeTask(task.id, 'timer'),
      )
      jobs.set(task.id, job)
      const nextRunAt = nextRun(job)
      db.updateScheduledTaskRuntime(task.id, { nextRunAt })
      observe('scheduled_task.scheduled', { scheduled_task_id: task.id, chat_id: task.chat_id, bot_id: task.bot_id, schedule_kind: task.schedule, timezone: task.timezone, enabled: true, next_run_at: nextRunAt })
    } catch (error) {
      db.updateScheduledTaskRuntime(task.id, {
        enabled: false,
        nextRunAt: null,
        lastStatus: 'error',
        lastError: `无法恢复计划：${error instanceof Error ? error.message : String(error)}`,
      })
      observe('scheduled_task.schedule_failed', { scheduled_task_id: task.id, chat_id: task.chat_id, bot_id: task.bot_id, schedule_kind: task.schedule, timezone: task.timezone, error_code: classifyObservationError(error) })
    }
  }
  emitEvent({ type: 'scheduled-tasks-updated' })
}

export function startScheduledTasks(nextRunner: TaskRunner): void {
  runner = nextRunner
  observe('scheduler.started')
  refreshScheduledTasks()
}

export function stopScheduledTasks(): void {
  observe('scheduler.stopped', { active_jobs: jobs.size, running_tasks: running.size })
  stopJobs()
  runner = null
}

export function observeScheduledTaskChange(action: 'created' | 'updated' | 'deleted', task: ScheduledTask): void {
  observe(`scheduled_task.${action}`, {
    scheduled_task_id: task.id, chat_id: task.chat_id, bot_id: task.bot_id,
    schedule_kind: task.schedule, timezone: task.timezone, enabled: task.enabled,
    has_model_override: Boolean(task.model),
  })
}

/** 手动立即执行不会改变原有计划与下次触发时间。 */
export async function runScheduledTaskNow(id: string): Promise<void> {
  const task = db.getScheduledTask(id)
  if (!task) throw new Error('定时任务不存在')
  if (running.has(id)) throw new Error('该定时任务正在执行')
  const wasEnabled = task.enabled
  if (!wasEnabled)
    db.updateScheduledTaskRuntime(id, { enabled: true, nextRunAt: task.next_run_at })
  try {
    await executeTask(id, 'manual')
  } finally {
    if (!wasEnabled) {
      const current = db.getScheduledTask(id)
      if (current)
        db.updateScheduledTaskRuntime(id, {
          enabled: false,
          nextRunAt: null,
        })
    }
  }
}
