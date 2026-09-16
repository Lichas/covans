// components/ScheduledTasksPanel.tsx — Bot 专属与全局定时任务入口
import { useEffect, useMemo, useState } from 'react'
import type { Bot, ChatSummary, ScheduledTask, ScheduledTaskInput } from '@shared/types'
import { useBotsStore } from '../stores/botsStore'
import { useChatsStore } from '../stores/chatsStore'
import { useScheduledTasksStore } from '../stores/scheduledTasksStore'
import { api } from '../lib/api'
import { btnGhostCls, btnPrimaryCls, Field, inputCls, Toggle } from './controls'
import { ClockIcon, PencilIcon, PlayIcon, PlusIcon, TrashIcon } from './icons'

const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function toDateTimeInput(value: number | null, timezone: string): string {
  const date = new Date(value ?? Date.now() + 60 * 60 * 1000)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? ''
    return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}T${valueOf('hour')}:${valueOf('minute')}`
  } catch {
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
}

/** 将 datetime-local 的墙上时间按任务时区换算为 UTC 毫秒。 */
function parseDateTimeInput(value: string, timezone: string): number {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return Number.NaN
  const desired = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  )
  const zonedWallTime = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant))
    const number = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? Number.NaN)
    return Date.UTC(number('year'), number('month') - 1, number('day'), number('hour'), number('minute'))
  }
  try {
    let instant = desired - (zonedWallTime(desired) - desired)
    // 夏令时切换附近再校正一次，使显示值与用户输入的墙上时间一致。
    instant += desired - zonedWallTime(instant)
    return instant
  } catch {
    return new Date(value).getTime()
  }
}

function formatTime(value: number | null, timezone: string): string {
  if (!value) return '暂无下一次执行'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(value)
  } catch {
    return new Date(value).toLocaleString('zh-CN')
  }
}

function scheduleLabel(task: ScheduledTask): string {
  if (task.schedule === 'once') return `一次 · ${formatTime(task.run_at, task.timezone)}`
  const daily = task.cron.match(/^0?\s+(\d{1,2})\s+\*\s+\*\s+\*$/)
  if (daily) return `每天 ${daily[1].padStart(2, '0')}:00`
  const weekday = task.cron.match(/^0?\s+(\d{1,2})\s+\*\s+\*\s+1-5$/)
  if (weekday) return `工作日 ${weekday[1].padStart(2, '0')}:00`
  return `Cron · ${task.cron}`
}

function statusLabel(task: ScheduledTask): string {
  if (!task.enabled) return task.last_status === 'missed' ? '已错过' : '已暂停'
  if (task.last_status === 'running') return '执行中'
  if (task.last_status === 'error') return '执行失败'
  return `下次 ${formatTime(task.next_run_at, task.timezone)}`
}

function TaskEditor({
  task,
  bot,
  chat,
  global,
  onClose,
}: {
  task: ScheduledTask | null
  bot?: Bot
  chat?: ChatSummary
  global: boolean
  onClose: () => void
}) {
  const bots = useBotsStore((state) => state.bots)
  const chats = useChatsStore((state) => state.chats)
  const loadChats = useChatsStore((state) => state.loadChats)
  const saveTask = useScheduledTasksStore((state) => state.saveTask)
  const [botId, setBotId] = useState(task?.bot_id ?? bot?.id ?? bots[0]?.id ?? '')
  const [title, setTitle] = useState(task?.title ?? '')
  const [prompt, setPrompt] = useState(task?.prompt ?? '')
  const [schedule, setSchedule] = useState<ScheduledTask['schedule']>(task?.schedule ?? 'cron')
  const [runAt, setRunAt] = useState(
    toDateTimeInput(task?.run_at ?? null, task?.timezone ?? systemTimezone),
  )
  const [cron, setCron] = useState(task?.cron || '0 9 * * *')
  const [timezone, setTimezone] = useState(task?.timezone ?? systemTimezone)
  const [model, setModel] = useState(task?.model ?? '')
  const [enabled, setEnabled] = useState(task?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const targetChat = useMemo(() => {
    if (task && task.bot_id === botId)
      return chats.find((item) => item.id === task.chat_id) ?? chat
    if (chat && chat.type === 'group' && chat.member_bots.some((member) => member.id === botId)) return chat
    return chats.find((item) => item.type === 'dm' && item.bot_id === botId)
  }, [botId, chat, chats, task])

  const save = async () => {
    setError('')
    const trimmedTitle = title.trim()
    const trimmedPrompt = prompt.trim()
    if (!botId || !trimmedTitle || !trimmedPrompt) {
      setError('请填写 Bot、任务名称和任务指令')
      return
    }
    const parsedRunAt = parseDateTimeInput(runAt, timezone.trim() || systemTimezone)
    if (schedule === 'once' && (!Number.isFinite(parsedRunAt) || parsedRunAt <= Date.now())) {
      setError('单次任务需要填写未来的执行时间')
      return
    }
    setSaving(true)
    try {
      const deliveryChat = targetChat ?? (await api.createDm(botId))
      if (!targetChat) void loadChats()
      const input: ScheduledTaskInput = {
        id: task?.id,
        bot_id: botId,
        chat_id: deliveryChat.id,
        title: trimmedTitle,
        prompt: trimmedPrompt,
        schedule,
        run_at: schedule === 'once' ? parsedRunAt : null,
        cron: schedule === 'cron' ? cron.trim() : '',
        timezone: timezone.trim() || systemTimezone,
        model: model.trim(),
        enabled,
      }
      await saveTask(input)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
          {task ? '编辑定时任务' : '新建定时任务'}
        </h3>
        <button type="button" className={btnGhostCls} onClick={onClose}>取消</button>
      </div>
      {global && (
        <Field label="执行 Bot">
          <select value={botId} onChange={(event) => setBotId(event.target.value)} className={inputCls}>
            {bots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="任务名称">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：每日行业简报" className={inputCls} />
      </Field>
      <Field label="Agent 任务">
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="写清要完成的工作、输出格式和必要边界" rows={5} className={`${inputCls} resize-y leading-relaxed`} />
      </Field>
      <div>
        <span className="mb-1 block text-[12px] font-medium text-stone-500 dark:text-stone-400">执行计划</span>
        <div className="flex gap-2">
          {([['once', '仅一次'], ['cron', '重复']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setSchedule(value)} className={`rounded-lg border px-3 py-1.5 text-[12px] ${schedule === value ? 'border-stone-700 bg-stone-800 text-white dark:border-stone-300 dark:bg-stone-100 dark:text-stone-900' : 'border-stone-200 text-stone-500 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'}`}>{label}</button>
          ))}
        </div>
      </div>
      {schedule === 'once' ? (
        <Field label="执行时间">
          <input type="datetime-local" value={runAt} onChange={(event) => setRunAt(event.target.value)} className={inputCls} />
        </Field>
      ) : (
        <Field label="Cron 表达式">
          <input value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 9 * * *" spellCheck={false} className={`${inputCls} font-mono`} />
        </Field>
      )}
      <Field label="时区">
        <input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Shanghai" className={inputCls} />
      </Field>
      <Field label="模型覆盖">
        <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="留空则跟随 Bot 默认模型" className={inputCls} />
      </Field>
      <div className="flex items-center justify-between border-t border-stone-200 pt-3 dark:border-stone-700">
        <div className="min-w-0 pr-3 text-[12px] text-stone-500">
          投递到 {targetChat?.name ?? '该 Bot 的单聊'}
        </div>
        <Toggle checked={enabled} onChange={setEnabled} label="启用定时任务" />
      </div>
      {error && <p role="alert" className="text-[12px] text-red-500">{error}</p>}
      <button type="button" disabled={saving} onClick={() => void save()} className={`${btnPrimaryCls} w-full`}>
        {saving ? '保存中…' : '保存任务'}
      </button>
    </div>
  )
}

export function ScheduledTasksPanel({ bot, chat, global = false }: { bot?: Bot; chat?: ChatSummary; global?: boolean }) {
  const tasks = useScheduledTasksStore((state) => state.tasks)
  const loadTasks = useScheduledTasksStore((state) => state.loadTasks)
  const saveTask = useScheduledTasksStore((state) => state.saveTask)
  const deleteTask = useScheduledTasksStore((state) => state.deleteTask)
  const runTask = useScheduledTasksStore((state) => state.runTask)
  const bots = useBotsStore((state) => state.bots)
  const [editing, setEditing] = useState<ScheduledTask | null | undefined>(undefined)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { void loadTasks() }, [loadTasks])
  const visibleTasks = global ? tasks : tasks.filter((task) => task.bot_id === bot?.id)

  if (editing !== undefined) return <TaskEditor task={editing} bot={bot} chat={chat} global={global} onClose={() => setEditing(undefined)} />

  const toggle = async (task: ScheduledTask, enabled: boolean) => {
    setError('')
    try {
      await saveTask({
        id: task.id, bot_id: task.bot_id, chat_id: task.chat_id, title: task.title,
        prompt: task.prompt, schedule: task.schedule, cron: task.cron, run_at: task.run_at,
        timezone: task.timezone, model: task.model, enabled,
      })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const run = async (id: string) => {
    setRunningId(id); setError('')
    try { await runTask(id) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setRunningId(null) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <div>
          <h3 className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">定时任务</h3>
          <p className="mt-0.5 text-[11.5px] text-stone-400">{global ? '所有 Bot 的自动执行任务' : '此 Bot 的自动执行任务'}</p>
        </div>
        <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100" aria-label="新建定时任务" title="新建定时任务"><PlusIcon width={18} height={18} /></button>
      </div>
      {error && <p role="alert" className="px-4 pt-3 text-[12px] text-red-500">{error}</p>}
      {!visibleTasks.length ? (
        <div className="px-4 py-10 text-center text-[13px] leading-relaxed text-stone-400">还没有定时任务</div>
      ) : (
        <div className="divide-y divide-stone-200 dark:divide-stone-800">
          {visibleTasks.map((task) => {
            const taskBot = bots.find((item) => item.id === task.bot_id)
            const failure = task.last_status === 'error' && task.last_error
            return <div key={task.id} className="px-4 py-3">
              <div className="flex gap-2.5">
                <ClockIcon width={17} height={17} className="mt-0.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-stone-800 dark:text-stone-100">{task.title}</div>
                      {global && <div className="mt-0.5 truncate text-[11.5px] text-stone-400">{taskBot?.name ?? '已删除的 Bot'}</div>}
                    </div>
                    <Toggle checked={task.enabled} onChange={(value) => void toggle(task, value)} label={`启用 ${task.title}`} />
                  </div>
                  <div className="mt-1 text-[11.5px] text-stone-500">{scheduleLabel(task)} · {task.model || '跟随 Bot 模型'}</div>
                  <div className={`mt-0.5 text-[11.5px] ${failure ? 'text-red-500' : 'text-stone-400'}`} title={failure || undefined}>{failure ? `执行失败：${failure}` : statusLabel(task)}</div>
                  <div className="mt-2 flex items-center gap-1">
                    <button type="button" disabled={runningId === task.id || task.last_status === 'running'} onClick={() => void run(task.id)} className="rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-100" aria-label={`立即执行 ${task.title}`} title="立即执行"><PlayIcon width={15} height={15} /></button>
                    <button type="button" onClick={() => setEditing(task)} className="rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100" aria-label={`编辑 ${task.title}`} title="编辑"><PencilIcon width={15} height={15} /></button>
                    <button type="button" onClick={() => { if (window.confirm(`删除定时任务“${task.title}”？`)) void deleteTask(task.id) }} className="rounded-md p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30" aria-label={`删除 ${task.title}`} title="删除"><TrashIcon width={15} height={15} /></button>
                  </div>
                </div>
              </div>
            </div>
          })}
        </div>
      )}
    </div>
  )
}
