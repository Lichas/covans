import { Cron } from 'croner'
import type { ScheduledTaskSchedule } from '../shared/types'

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function assertTimeZone(timezone: string): string {
  const value = timezone.trim() || localTimeZone()
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value })
  } catch {
    throw new Error('时区必须是有效的 IANA 时区，例如 Asia/Shanghai')
  }
  return value
}

export function nextScheduledRun(
  schedule: ScheduledTaskSchedule,
  cron: string,
  runAt: number | null,
  timezone: string,
): number | null {
  if (schedule === 'once') {
    if (!Number.isSafeInteger(runAt) || (runAt ?? 0) <= Date.now())
      throw new Error('单次任务的执行时间必须在当前时间之后')
    return runAt
  }
  if (!cron.trim()) throw new Error('重复任务需要 Cron 表达式')
  try {
    const job = new Cron(cron.trim(), { timezone })
    const next = job.nextRun()
    job.stop()
    if (!next) throw new Error('没有可执行的下一次时间')
    return next.getTime()
  } catch (error) {
    throw new Error(
      `Cron 表达式无效：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
