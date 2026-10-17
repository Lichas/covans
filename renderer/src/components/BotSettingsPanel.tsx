// components/BotSettingsPanel.tsx — 右栏：Bot 设定 / 记忆 / 工作区
import { useEffect, useRef, useState, type RefObject } from 'react'
import type {
  Bot,
  ChatSummary,
  GroupReplyMode,
  ReasoningEffort,
  ResponseDecisionStrategy,
} from '@shared/types'
import { useBotsStore } from '../stores/botsStore'
import { useActiveChat, useChatsStore } from '../stores/chatsStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { AvatarDialog } from './AvatarSettings'
import { AvatarLifestyle } from './AvatarLifestyle'
import { MemoryPanel } from './MemoryPanel'
import { WorkspacePanel } from './WorkspacePanel'
import { ScheduledTasksPanel } from './ScheduledTasksPanel'
import { ExtensionsPanel } from './ExtensionsPanel'
import { LocalCliFields, isCliBackend } from './LocalCliFields'
import { Field, Toggle, inputCls } from './controls'
import { CloseIcon, PencilIcon, ProviderIcon, UsersIcon } from './icons'
import { MarkdownContent } from './MarkdownContent'
import { GROUP_BACKGROUNDS, groupBackgroundUrl } from '../lib/groupBackground'

type Tab = 'settings' | 'lifestyle' | 'memory' | 'workspace' | 'scheduled' | 'model' | 'extensions'

/** 失焦保存的文本输入 */
function BotField({
  label,
  value,
  multiline,
  placeholder,
  onSave,
}: {
  label: string
  value: string
  multiline?: boolean
  placeholder?: string
  onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onSave(draft)
  }
  return (
    <Field label={label}>
      {multiline ? (
        <textarea
          className={`${inputCls} scroll-thin min-h-[120px] resize-y leading-relaxed`}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          className={inputCls}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      )}
    </Field>
  )
}

type MarkdownToken = { text: string; className?: string }

function tokenizeMarkdown(line: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = []
  const pattern = /(<!--.*?-->|^\s{0,3}#{1,6}\s.*$|```.*$|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]*\))/g
  let cursor = 0
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) tokens.push({ text: line.slice(cursor, index) })
    const text = match[0]
    const className = text.trimStart().startsWith('#')
      ? 'md-token-heading'
      : text.startsWith('```')
        ? 'md-token-fence'
        : text.startsWith('<!--')
          ? 'md-token-comment'
          : text.startsWith('`')
            ? 'md-token-code'
            : text.startsWith('[')
              ? 'md-token-link'
              : 'md-token-emphasis'
    tokens.push({ text, className })
    cursor = index + text.length
  }
  if (cursor < line.length) tokens.push({ text: line.slice(cursor) })
  return tokens.length ? tokens : [{ text: ' ' }]
}

function MarkdownCodeLayer({ value, highlightRef }: { value: string; highlightRef: RefObject<HTMLPreElement> }) {
  return (
    <pre ref={highlightRef} aria-hidden="true" className="markdown-editor-highlight selectable-none">
      {value.split('\n').map((line, index) => (
        <div key={index} className="markdown-editor-line">
          {tokenizeMarkdown(line).map((token, tokenIndex) => (
            <span key={tokenIndex} className={token.className}>{token.text}</span>
          ))}
        </div>
      ))}
    </pre>
  )
}

function MarkdownBotField({
  label,
  value,
  placeholder,
  onSave,
  fillRemaining,
}: {
  label: string
  value: string
  placeholder?: string
  onSave: (v: string) => void
  fillRemaining?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])
  const syncScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }
  const finish = () => {
    if (draft !== value) onSave(draft)
    setEditing(false)
  }
  const cancel = () => {
    setDraft(value)
    setEditing(false)
  }
  return (
    <div className={fillRemaining ? 'flex min-h-0 flex-1 flex-col' : 'block'}>
      <span className="mb-1 block text-[12px] font-medium text-stone-500 dark:text-stone-400">
        {label}
      </span>
      {editing ? (
        /* 编辑态外层保持普通块级流：一旦作为 flex 项参与剩余空间分配，
           高度会被压缩到面板可用高度（约 245px），低于 360px 的可读下限。
           改由侧栏滚动来容纳固定 380px 的编辑区。 */
        <div className="space-y-2">
          <div className="markdown-editor-shell" style={{ height: 380 }}>
            <MarkdownCodeLayer value={draft} highlightRef={highlightRef} />
            <textarea
              ref={textareaRef}
              autoFocus
              value={draft}
              placeholder={placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              aria-label="编辑人设 System Prompt"
              className="markdown-editor-input"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancel} className="rounded-lg px-2.5 py-1 text-[11px] text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700">取消</button>
            <button type="button" onClick={finish} className="rounded-lg bg-ink px-2.5 py-1 text-[11px] text-white dark:bg-stone-100 dark:text-stone-900">完成</button>
          </div>
        </div>
      ) : (
        <div className={`relative rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800${fillRemaining ? ' flex min-h-0 flex-1 flex-col' : ''}`}>
          <div className={`markdown-preview scroll-thin overflow-y-auto p-3 pr-11${fillRemaining ? ' min-h-[220px] flex-1' : ' max-h-[360px] min-h-[220px]'}`}>
            {value.trim() ? <MarkdownContent content={value} /> : <span className="text-[13px] text-stone-400">{placeholder}</span>}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="编辑人设"
            aria-label="编辑人设"
            className="absolute right-2 top-2 rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
          >
            <PencilIcon width={14} height={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function ChatBackgroundPicker({
  chat,
  compact,
}: {
  chat: ChatSummary
  compact?: boolean
}) {
  const updateChat = useChatsStore((s) => s.updateChat)
  const [savingBackground, setSavingBackground] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(!compact)
  const [error, setError] = useState('')
  const currentBackground = GROUP_BACKGROUNDS.find(
    (background) => background.file === chat.background_image,
  )

  const chooseBackground = async (backgroundImage: string) => {
    if (backgroundImage === chat.background_image || savingBackground) return
    setSavingBackground(backgroundImage || 'none')
    setError('')
    try {
      await updateChat(chat.id, { backgroundImage })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingBackground(null)
    }
  }

  const randomizeBackground = () => {
    const pool = GROUP_BACKGROUNDS.filter(
      (background) => background.file !== chat.background_image,
    )
    const next = pool[Math.floor(Math.random() * pool.length)]?.file
    if (next) void chooseBackground(next)
  }

  return (
    <div className={compact ? 'rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-700 dark:bg-stone-800/40' : ''}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-stone-500 dark:text-stone-400">
          聊天背景
        </span>
        <div className="flex items-center gap-1">
          {compact && (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[11px] text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起' : '更换'}
            </button>
          )}
          {chat.background_image && (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[11px] text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              disabled={!!savingBackground}
              onClick={() => void chooseBackground('')}
            >
              清除
            </button>
          )}
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[11px] text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            disabled={!!savingBackground}
            onClick={randomizeBackground}
          >
            随机
          </button>
        </div>
      </div>
      {compact && (
        <button
          type="button"
          className="chat-background-current"
          onClick={() => setExpanded((value) => !value)}
          aria-label="更换聊天背景"
        >
          {currentBackground ? (
            <img
              src={groupBackgroundUrl(currentBackground.file)}
              alt=""
              draggable={false}
            />
          ) : (
            <span aria-hidden="true" />
          )}
          <strong>{currentBackground?.label || '无背景'}</strong>
        </button>
      )}
      {expanded && <div className="group-background-grid">
        {GROUP_BACKGROUNDS.map((background) => {
          const selected = chat.background_image === background.file
          return (
            <button
              key={background.file}
              type="button"
              className="group-background-option"
              aria-pressed={selected}
              title={background.label}
              disabled={!!savingBackground}
              onClick={() => void chooseBackground(background.file)}
            >
              <img
                src={groupBackgroundUrl(background.file)}
                alt=""
                draggable={false}
              />
              <span>{background.label}</span>
              {savingBackground === background.file && <i>保存中</i>}
            </button>
          )
        })}
      </div>}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}

function SettingsTab({ bot, chat }: { bot: Bot; chat: ChatSummary }) {
  const updateBot = useBotsStore((s) => s.updateBot)
  const save = (patch: Parameters<typeof updateBot>[1]) => {
    void updateBot(bot.id, patch).catch(() => undefined)
  }
  return (
    <div className="settings-tab-pane flex min-h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-stone-600 dark:text-stone-300">
          新消息通知
        </span>
        <Toggle checked={!!bot.notify} onChange={(v) => save({ notify: v })} />
      </div>
      <BotField
        label="描述"
        value={bot.description}
        placeholder="一句话介绍这个 Bot"
        onSave={(v) => save({ description: v })}
      />
      <BotField
        label="标签（逗号分隔）"
        value={bot.tags}
        placeholder="开发,后端"
        onSave={(v) => save({ tags: v })}
      />
      {chat.type === 'dm' && <ChatBackgroundPicker chat={chat} compact />}
      <MarkdownBotField
        label="人设 System Prompt"
        value={bot.system_prompt}
        placeholder="描述这个 Bot 的身份、能力与说话方式…"
        onSave={(v) => save({ system_prompt: v })}
        fillRemaining
      />
    </div>
  )
}

function ModelTab({ bot }: { bot: Bot }) {
  const providers = useSettingsStore((s) => s.providers)
  const updateBot = useBotsStore((s) => s.updateBot)
  const [temp, setTemp] = useState(bot.temperature)
  const provider = providers.find((p) => p.id === bot.provider_id)
  const fixedTemperature =
    provider?.kind === 'kimi' && (bot.model || provider.default_model) === 'k3'
  const tempTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => setTemp(bot.temperature), [bot.id, bot.temperature])

  const save = (patch: Parameters<typeof updateBot>[1]) => {
    void updateBot(bot.id, patch).catch(() => undefined)
  }

  const commitTemp = (v: number) => {
    setTemp(v)
    clearTimeout(tempTimer.current)
    tempTimer.current = setTimeout(() => save({ temperature: v }), 400)
  }

  return (
    <div className="p-4">
      <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-3.5 dark:border-stone-700 dark:bg-stone-800/50">
        <div className="text-[12.5px] font-medium text-stone-600 dark:text-stone-300">
          模型配置
        </div>
        <LocalCliFields
          value={{
            backend: bot.backend,
            cliPath: bot.cli_path,
            cliAccess: bot.cli_access,
            model: bot.model,
          }}
          onChange={({ cliPath, cliAccess, ...patch }) =>
            save({
              ...patch,
              ...(cliPath !== undefined ? { cli_path: cliPath } : {}),
              ...(cliAccess !== undefined ? { cli_access: cliAccess } : {}),
            })
          }
        />
        <Field
          label={isCliBackend(bot.backend) ? 'Provider（判断用，可选）' : 'Provider'}
        >
          <div className="flex items-center gap-2">
            {bot.provider_id ? (
              <ProviderIcon
                kind={
                  providers.find((p) => p.id === bot.provider_id)?.kind ??
                  'openai'
                }
                width={22}
                height={22}
                className="shrink-0"
              />
            ) : (
              <span className="h-[22px] w-[22px] shrink-0 rounded-md border border-dashed border-stone-300 dark:border-stone-600" />
            )}
            <select
              className={`${inputCls} min-w-0 flex-1`}
              value={bot.provider_id ?? ''}
              onChange={(e) => {
                const providerId = e.target.value || null
                save({ provider_id: providerId })
              }}
            >
              <option value="">未选择</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.kind}）
                </option>
              ))}
            </select>
          </div>
        </Field>
        {!isCliBackend(bot.backend) && (
          <BotField
            label="模型（留空用 Provider 默认）"
            value={bot.model}
            placeholder={
              providers.find((p) => p.id === bot.provider_id)?.default_model ||
              '如 gpt-4o'
            }
            onSave={(v) => save({ model: v })}
          />
        )}
        <Field label="响应决策策略">
          <select
            aria-label="响应决策策略"
            className={inputCls}
            value={bot.response_decision_strategy}
            onChange={(event) =>
              save({
                response_decision_strategy: event.target
                  .value as ResponseDecisionStrategy,
              })
            }
          >
            <option value="auto">自动 · Jev 可用时优先</option>
            <option value="llm">传统 LLM · 当前模型判断</option>
            <option value="jev">Jev · 结构化快速判断</option>
          </select>
          <p className="mt-1.5 text-[11px] leading-relaxed text-stone-400">
            默认自动优先使用已配置的 Jev；未配置、低置信度或不可用时回退当前
            LLM。回复正文仍使用上方模型。
          </p>
        </Field>
        <Field label="推理强度">
          <select
            aria-label="推理强度"
            className={inputCls}
            value={bot.reasoning_effort}
            onChange={(e) =>
              save({ reasoning_effort: e.target.value as ReasoningEffort })
            }
          >
            <option value="off">关闭 · 最快</option>
            <option value="low">低 · 日常对话</option>
            <option value="medium">中 · 分析任务</option>
            <option value="high">高 · 复杂任务</option>
            <option value="xhigh">极高 · 最慢</option>
          </select>
          <p className="mt-1.5 text-[11px] leading-relaxed text-stone-400">
            {provider?.kind === 'lm-studio'
              ? '同时发送标准参数和本地模型兼容提示；第三方模型是否支持全部档位取决于其模板。'
              : '仅在当前模型支持推理控制时生效。'}
          </p>
        </Field>
        <Field label="最大输出 Token">
          <input
            aria-label="最大输出 Token"
            key={`${bot.id}:${bot.max_tokens}`}
            className={inputCls}
            type="number"
            min={64}
            max={131072}
            step={64}
            defaultValue={bot.max_tokens}
            onBlur={(e) => {
              const value = Math.max(
                64,
                Math.min(131072, Math.round(Number(e.target.value) || 8192)),
              )
              e.target.value = String(value)
              if (value !== bot.max_tokens) save({ max_tokens: value })
            }}
          />
          <p className="mt-1.5 text-[11px] text-stone-400">
            新建 Bot 默认 8192；简短聊天可按成本需要调低。
          </p>
        </Field>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] font-medium text-stone-500 dark:text-stone-400">
              Temperature
            </span>
            <span className="text-[12px] tabular-nums text-stone-500 dark:text-stone-400">
              {fixedTemperature ? '1.0 · 模型固定' : temp.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={fixedTemperature ? 1 : temp}
            disabled={fixedTemperature}
            onChange={(e) => commitTemp(Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  )
}

function GroupSettingsPanel({ chat }: { chat: ChatSummary }) {
  const updateChat = useChatsStore((s) => s.updateChat)
  const [saving, setSaving] = useState<GroupReplyMode | null>(null)
  const [error, setError] = useState('')

  const choose = async (replyMode: GroupReplyMode) => {
    if (replyMode === chat.reply_mode || saving) return
    setSaving(replyMode)
    setError('')
    try {
      await updateChat(chat.id, { replyMode })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  const modes: {
    id: GroupReplyMode
    title: string
    description: string
    badge: string
  }[] = [
    {
      id: 'active',
      title: '主动回复',
      description:
        '每位成员并发结合前文总结与最新 5 条消息，自己判断是否发言。思考时收到新消息会刷新尚未完成的判断。',
      badge: '并发',
    },
    {
      id: 'sequential',
      title: '顺序回复',
      description:
        '成员按群成员顺序逐个判断与发言，后面的成员可以看到前面成员的回复。',
      badge: '低并发',
    },
  ]

  return (
    <aside
      className="bot-settings-panel flex h-full w-[320px] shrink-0 flex-col border-l border-stone-200 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-900/40"
      aria-label="群聊设定"
    >
      <div className="flex items-center gap-3 border-b border-stone-200 px-4 py-4 dark:border-stone-800">
        <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          <UsersIcon width={20} height={20} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-stone-800 dark:text-stone-100">
            {chat.name || '群聊设置'}
          </div>
          <div className="mt-0.5 text-[11.5px] text-stone-400">
            {chat.member_bots.length} 位成员 · 群成员回复机制
          </div>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-2 text-[12px] font-medium text-stone-500 dark:text-stone-400">
          回复机制
        </div>
        <div className="space-y-2.5">
          {modes.map((mode) => {
            const selected = chat.reply_mode === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                disabled={!!saving}
                aria-pressed={selected}
                onClick={() => void choose(mode.id)}
                className={`w-full rounded-xl border p-3.5 text-left transition ${
                  selected
                    ? 'border-stone-500 bg-white shadow-sm dark:border-stone-500 dark:bg-stone-800'
                    : 'border-stone-200 bg-white/60 hover:border-stone-300 hover:bg-white dark:border-stone-800 dark:bg-stone-900/40 dark:hover:border-stone-700 dark:hover:bg-stone-800/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-stone-800 dark:text-stone-100">
                    {mode.title}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      selected
                        ? 'bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900'
                        : 'bg-stone-100 text-stone-400 dark:bg-stone-800'
                    }`}
                  >
                    {saving === mode.id ? '保存中…' : mode.badge}
                  </span>
                </div>
                <p className="mt-2 text-[11.5px] leading-[1.65] text-stone-500 dark:text-stone-400">
                  {mode.description}
                </p>
              </button>
            )
          })}
        </div>

        <div className="mt-5 rounded-xl bg-stone-100/80 p-3.5 text-[11px] leading-relaxed text-stone-500 dark:bg-stone-800/60 dark:text-stone-400">
          Covan 会持续保存群聊前文总结。成员判断时只携带该总结与最新 5
          条消息，避免群聊越长越慢。
        </div>

        <div className="mt-6">
          <ChatBackgroundPicker chat={chat} />
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[12px] text-red-500">
            {error}
          </p>
        )}
      </div>
    </aside>
  )
}

export function BotSettingsPanel({
  onActionsTarget,
}: {
  onActionsTarget: (node: HTMLDivElement | null) => void
}) {
  const chat = useActiveChat()
  const inspectedBotId = useUiStore((s) => s.inspectedBotId)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const bots = useBotsStore((s) => s.bots)
  const updateBot = useBotsStore((s) => s.updateBot)
  const [tab, setTab] = useState<Tab>('settings')
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [error, setError] = useState('')

  // 确定当前展示的 bot：单聊 = 会话 bot；群聊 = 被选中的成员
  const botId = chat?.type === 'dm' ? chat.bot_id : inspectedBotId
  const bot = bots.find((b) => b.id === botId) ?? null

  if (!rightPanelOpen) return null
  if (!chat) return null

  if (chat.type === 'group' && !inspectedBotId)
    return <GroupSettingsPanel chat={chat} />

  if (!bot) {
    return (
      <aside className="bot-settings-panel flex w-[320px] shrink-0 flex-col items-center justify-center gap-2 border-l border-stone-200 bg-stone-50/60 text-stone-400 dark:border-stone-800 dark:bg-stone-900/40">
        <p className="px-8 text-center text-[13px] leading-relaxed">
          {chat.type === 'group'
            ? '点击群聊中某位成员的头像，即可查看与编辑它的设置'
            : '该会话没有关联 Bot'}
        </p>
      </aside>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'lifestyle', label: '生活照' },
    { id: 'settings', label: '设定' },
    { id: 'memory', label: '记忆' },
    { id: 'workspace', label: '工作区' },
    { id: 'scheduled', label: '定时' },
    { id: 'model', label: '模型' },
    { id: 'extensions', label: '扩展' },
  ]

  return (
    <aside
      className="bot-settings-panel flex h-full w-[320px] shrink-0 flex-col border-l border-stone-200 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-900/40"
      id="bot-settings-panel"
      aria-label="Bot 设定"
    >
      <div className="bot-profile-header relative flex flex-col items-center border-b border-stone-200 px-4 pb-5 pt-6 dark:border-stone-800">
        {chat.type === 'dm' && (
          <button
            className="icon-button bot-panel-close"
            aria-label="关闭 Bot 设定"
            title="关闭 Bot 设定"
            onClick={() => useUiStore.getState().setRightPanelOpen(false)}
          >
            <CloseIcon width={16} height={16} />
          </button>
        )}
        <div className="bot-profile-portrait">
          <button
            onClick={() => setAvatarOpen(true)}
            className="group relative shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
            title="更换头像"
            aria-label="更换头像"
          >
            <Avatar name={bot.name} avatar={bot.avatar} size={76} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
              <PencilIcon width={18} height={18} />
            </span>
          </button>
          {chat.type === 'dm' && (
            <div className="bot-profile-actions" ref={onActionsTarget} />
          )}
        </div>
        <input
          key={bot.id + bot.name}
          aria-label="Bot 名称"
          defaultValue={bot.name}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v && v !== bot.name)
              void updateBot(bot.id, { name: v }).catch((e) =>
                setError(String(e)),
              )
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="selectable mt-3 w-full rounded-md bg-transparent px-1 py-0.5 text-center text-[16px] font-semibold text-stone-800 outline-none transition hover:bg-stone-100 focus:bg-white focus:ring-1 focus:ring-stone-300 dark:text-stone-100 dark:hover:bg-stone-800 dark:focus:bg-stone-800"
        />
        <div className="mt-1 w-full truncate px-1 text-center text-[11.5px] text-stone-400">
          {bot.description || '暂无描述'}
        </div>
      </div>

      {error && (
        <p role="alert" className="px-5 pb-2 text-[12px] text-red-500">
          {error}
        </p>
      )}
      <AvatarDialog
        key={bot.id}
        bot={bot}
        open={avatarOpen}
        onClose={() => setAvatarOpen(false)}
      />

      {/* Tabs */}
      <div className="grid grid-cols-7 border-b border-stone-200 px-2 dark:border-stone-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`relative min-w-0 whitespace-nowrap px-0.5 py-2.5 text-[12px] transition ${
              tab === t.id
                ? 'font-medium text-stone-800 dark:text-stone-100'
                : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'
            }`}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-stone-700 dark:bg-stone-300" />
            )}
          </button>
        ))}
      </div>

      <div
        key={`${bot.id}:${tab}`}
        className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {tab === 'settings' && <SettingsTab key={bot.id} bot={bot} chat={chat} />}
        {tab === 'memory' && <MemoryPanel botId={bot.id} sceneId={chat.id} />}
        {tab === 'workspace' && <WorkspacePanel botId={bot.id} />}
        {tab === 'scheduled' && <ScheduledTasksPanel bot={bot} chat={chat} />}
        {tab === 'model' && <ModelTab bot={bot} />}
        {tab === 'extensions' && <ExtensionsPanel key={bot.id} botId={bot.id} />}
        {tab === 'lifestyle' && <AvatarLifestyle bot={bot} />}
      </div>
    </aside>
  )
}
