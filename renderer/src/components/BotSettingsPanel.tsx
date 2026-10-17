// components/BotSettingsPanel.tsx — 右栏：Bot 资料 / 记忆 / 工作区
import { useEffect, useRef, useState, type RefObject } from 'react'
import type {
  Bot,
  ChatSummary,
  GroupReplyMode,
  Provider,
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
import { CliAccessSegmented, isCliBackend } from './LocalCliFields'
import { ModelPicker, describeBotModel } from './ModelPicker'
import { api } from '../lib/api'
import { Toggle, inputCls } from './controls'
import { ChevronRightIcon, CloseIcon, PencilIcon, UsersIcon } from './icons'
import { avatarSrc } from '../lib/format'
import { GROUP_BACKGROUNDS, groupBackgroundUrl } from '../lib/groupBackground'

type Tab = 'lifestyle' | 'settings' | 'memory' | 'workspace' | 'scheduled' | 'extensions'

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

/** 把 Markdown 人设压成一行摘要：去掉标题、强调、代码与链接语法后截断。 */
function plainSummary(markdown: string, limit = 88): string {
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** 人设指令编辑区：等宽透明输入层叠加 Markdown 语法高亮层。 */
function InstructionsEditor({
  value,
  onSave,
  onDone,
}: {
  value: string
  onSave: (next: string) => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const syncScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }
  return (
    <div className="space-y-2">
      <div className="markdown-editor-shell" style={{ height: 380 }}>
        <MarkdownCodeLayer value={draft} highlightRef={highlightRef} />
        <textarea
          ref={textareaRef}
          autoFocus
          value={draft}
          placeholder="描述这个 Bot 的身份、能力与说话方式…"
          onChange={(event) => setDraft(event.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          aria-label="编辑人设 System Prompt"
          className="markdown-editor-input"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-2.5 py-1 text-[11px] text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            if (draft !== value) onSave(draft)
            onDone()
          }}
          className="rounded-lg bg-ink px-2.5 py-1 text-[11px] text-white dark:bg-stone-100 dark:text-stone-900"
        >
          完成
        </button>
      </div>
    </div>
  )
}

/** 名称与职责：两个输入框一起提交。 */
function IdentityEditor({
  bot,
  onSave,
  onDone,
}: {
  bot: Bot
  onSave: (patch: { name: string; description: string }) => void
  onDone: () => void
}) {
  const [name, setName] = useState(bot.name)
  const [description, setDescription] = useState(bot.description)
  return (
    <div className="space-y-2">
      <input
        aria-label="Bot 名称"
        className={inputCls}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Bot 名称"
      />
      <input
        aria-label="描述"
        className={inputCls}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="一句话介绍这个 Bot 的职责"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-2.5 py-1 text-[11px] text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700"
        >
          取消
        </button>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            if (name.trim() && (name.trim() !== bot.name || description !== bot.description))
              onSave({ name: name.trim(), description })
            onDone()
          }}
          className="rounded-lg bg-ink px-2.5 py-1 text-[11px] text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
        >
          完成
        </button>
      </div>
    </div>
  )
}

/** 标签：逗号分隔的一行文本。 */
function TagsEditor({
  value,
  onSave,
  onDone,
}: {
  value: string
  onSave: (next: string) => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <div className="space-y-2">
      <input
        aria-label="标签（逗号分隔）"
        className={inputCls}
        value={draft}
        autoFocus
        placeholder="开发,后端"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onSave(draft)
            onDone()
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-2.5 py-1 text-[11px] text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            if (draft !== value) onSave(draft)
            onDone()
          }}
          className="rounded-lg bg-ink px-2.5 py-1 text-[11px] text-white dark:bg-stone-100 dark:text-stone-900"
        >
          完成
        </button>
      </div>
    </div>
  )
}

/** 资料页的一行：标签 + 一行摘要 + 右侧操作或分段控件，点「编辑」就地展开。 */
function ProfileRow({
  id,
  label,
  summary,
  hint,
  leading,
  action,
  editing,
  editLabel = '编辑',
  editAriaLabel,
  onEdit,
  children,
}: {
  id: string
  label: string
  summary?: string
  hint?: string
  leading?: React.ReactNode
  action?: React.ReactNode
  editing?: boolean
  editLabel?: string
  editAriaLabel?: string
  onEdit?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="profile-row" data-profile-row={id}>
      <div className="profile-row-body">
        <div className="profile-row-label">
          {leading}
          {label}
        </div>
        {summary && (
          <div className="profile-row-summary" title={summary}>
            {summary}
          </div>
        )}
        {hint && <div className="profile-row-hint">{hint}</div>}
      </div>
      {editing ? (
        <div className="profile-row-editor">{children}</div>
      ) : (
        <>
          {action}
          {onEdit && (
            <button
              type="button"
              data-profile-edit={id}
              aria-label={editAriaLabel ?? editLabel}
              onClick={onEdit}
              className="profile-row-action shape-rect"
            >
              {editLabel}
              <ChevronRightIcon width={13} height={13} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

const EFFORT_OPTIONS: { value: ReasoningEffort; label: string; hint: string }[] = [
  { value: 'off', label: '关', hint: '关闭 · 最快' },
  { value: 'low', label: '低', hint: '低 · 日常对话' },
  { value: 'medium', label: '中', hint: '中 · 分析任务' },
  { value: 'high', label: '高', hint: '高 · 复杂任务' },
  { value: 'xhigh', label: '极高', hint: '极高 · 最慢' },
]

const DECISION_OPTIONS: {
  value: ResponseDecisionStrategy
  label: string
  hint: string
}[] = [
  { value: 'auto', label: '自动', hint: '自动 · Jev 可用时优先，失败回退当前 LLM' },
  { value: 'llm', label: 'LLM', hint: '传统 LLM · 由当前模型判断是否发言' },
  { value: 'jev', label: 'Jev', hint: 'Jev · 结构化快速判断是否发言' },
]

const AVATAR_KIND_LABEL: Record<string, string> = {
  emoji: '表情头像',
  url: '图片头像',
  none: '首字母占位',
}

type ProfileEdit = 'identity' | 'commands' | 'model' | 'tags' | null

function ProfileTab({
  bot,
  chat,
  providers,
  onOpenTab,
  onEditAvatar,
}: {
  bot: Bot
  chat: ChatSummary
  providers: Provider[]
  onOpenTab: (tab: Tab) => void
  onEditAvatar: () => void
}) {
  const updateBot = useBotsStore((s) => s.updateBot)
  const [editing, setEditing] = useState<ProfileEdit>(null)
  const [temp, setTemp] = useState(bot.temperature)
  const [jevReady, setJevReady] = useState(false)
  const tempTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => setTemp(bot.temperature), [bot.id, bot.temperature])

  const save = (patch: Parameters<typeof updateBot>[1]) => {
    void updateBot(bot.id, patch).catch(() => undefined)
  }

  const provider = providers.find((entry) => entry.id === bot.provider_id)
  const fixedTemperature =
    provider?.kind === 'kimi' && (bot.model || provider.default_model) === 'k3'
  const cli = isCliBackend(bot.backend)
  const decision = DECISION_OPTIONS.find(
    (option) => option.value === bot.response_decision_strategy,
  )
  const effort = EFFORT_OPTIONS.find((option) => option.value === bot.reasoning_effort)
  const instructions = plainSummary(bot.system_prompt)

  // 本地 CLI 的正文由 CLI 生成，但「是否发言」需要 Provider 或 Jev 判断。
  useEffect(() => {
    if (!cli) return
    let active = true
    api
      .getJevConfig()
      .then((config) => {
        if (active) setJevReady(config.has_api_key)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [cli])

  // 判断引擎与主进程同规则：已配置 Jev → Jev；否则显式判断用 Provider，
  // 再否则第一个带 Key 的非 mock Provider；都没有就用 CLI 自身判断。
  const defaultJudge =
    providers.find((entry) => entry.kind !== 'mock' && entry.api_key.trim()) ??
    null
  const judgeProvider =
    (bot.provider_id
      ? providers.find((entry) => entry.id === bot.provider_id)
      : null) ?? defaultJudge
  const judgeEngine: 'jev' | 'provider' | 'cli' =
    jevReady && bot.response_decision_strategy !== 'llm'
      ? 'jev'
      : judgeProvider
        ? 'provider'
        : 'cli'
  const judgeHint =
    judgeEngine === 'jev'
      ? '由 Jev 判断是否发言；判断用 Provider 作为 Jev 不可用时的回退'
      : judgeEngine === 'cli'
        ? '没有可用的 Provider：每条群消息会用 CLI 自身判断，较慢且消耗 CLI 额度'
        : bot.provider_id
          ? `由 ${judgeProvider?.name ?? 'Provider'} 判断是否发言，不影响正文生成`
          : `未单独选择：默认用 ${judgeProvider?.name ?? 'Provider'} 判断是否发言`

  const commitTemp = (value: number) => {
    setTemp(value)
    clearTimeout(tempTimer.current)
    tempTimer.current = setTimeout(() => save({ temperature: value }), 400)
  }

  return (
    <div className="settings-tab-pane profile-rows">
      <ProfileRow
        id="look"
        label="外观"
        summary={AVATAR_KIND_LABEL[avatarSrc(bot.avatar).kind] ?? '自定义头像'}
        leading={<Avatar name={bot.name} avatar={bot.avatar} size={20} className="mr-0.5" />}
        editLabel="更换"
        editAriaLabel="更换外观"
        onEdit={onEditAvatar}
      />

      <ProfileRow
        id="identity"
        label="名称与职责"
        summary={`${bot.name}${bot.description.trim() ? ` · ${bot.description}` : ' · 还没写职责'}`}
        editing={editing === 'identity'}
        onEdit={() => setEditing('identity')}
      >
        <IdentityEditor
          bot={bot}
          onSave={(patch) => save(patch)}
          onDone={() => setEditing(null)}
        />
      </ProfileRow>

      <ProfileRow
        id="commands"
        label="人设指令"
        summary={instructions || '还没有人设，点右侧开始写'}
        editing={editing === 'commands'}
        editAriaLabel="编辑人设"
        onEdit={() => setEditing('commands')}
      >
        <InstructionsEditor
          value={bot.system_prompt}
          onSave={(next) => save({ system_prompt: next })}
          onDone={() => setEditing(null)}
        />
      </ProfileRow>

      <ProfileRow
        id="model"
        label="默认模型"
        summary={describeBotModel(bot.backend, providers, bot.provider_id, bot.model)}
        editing={editing === 'model'}
        editAriaLabel="编辑默认模型"
        onEdit={() => setEditing('model')}
      >
        <div className="space-y-2">
          <ModelPicker
            value={{
              backend: bot.backend,
              providerId: bot.provider_id,
              model: bot.model,
              cliPath: bot.cli_path,
            }}
            botModel={bot.model}
            commitEngineOnBrowse={false}
            onChange={(next) =>
              save({
                backend: next.backend,
                provider_id: next.provider_id,
                model: next.model,
              })
            }
            onCliPath={(path) => save({ cli_path: path })}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg px-2.5 py-1 text-[11px] text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700"
              data-profile-done="model"
            >
              完成
            </button>
          </div>
        </div>
      </ProfileRow>

      {cli && (
        <ProfileRow
          id="access"
          label="文件权限"
          hint="只读可以查看文件；可写允许在该 Bot 工作区内改文件"
          action={
            <CliAccessSegmented
              value={bot.cli_access}
              onChange={(next) => save({ cli_access: next })}
            />
          }
        />
      )}

      {cli && (
        <ProfileRow
          id="judge"
          label="判断用 Provider"
          hint={judgeHint}
          action={
            <select
              aria-label="Provider（判断用，可选）"
              data-judge-engine={judgeEngine}
              className="max-w-[132px] shrink-0 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[12px] text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200"
              value={bot.provider_id ?? ''}
              onChange={(event) => save({ provider_id: event.target.value || null })}
            >
              <option value="">
                {defaultJudge ? `跟随默认（${defaultJudge.name}）` : '未选择'}
              </option>
              {providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          }
        />
      )}

      <ProfileRow
        id="workspace"
        label="在哪工作"
        summary={
          bot.workspace_dir.startsWith('/')
            ? bot.workspace_dir
            : 'Bot 独立工作区目录'
        }
        hint="交付文件只能写进这里；「查看」打开工作区里的文件。"
        editLabel="查看"
        onEdit={() => onOpenTab('workspace')}
      />

      <ProfileRow
        id="notify"
        label="通知"
        summary={bot.notify ? '新消息会提醒' : '只显示角标之外不提醒'}
        action={
          <Toggle
            checked={!!bot.notify}
            label="新消息通知"
            onChange={(value) => save({ notify: value })}
          />
        }
      />

      <ProfileRow
        id="tags"
        label="标签"
        summary={bot.tags || '未设置标签'}
        editing={editing === 'tags'}
        onEdit={() => setEditing('tags')}
      >
        <TagsEditor
          value={bot.tags}
          onSave={(next) => save({ tags: next })}
          onDone={() => setEditing(null)}
        />
      </ProfileRow>

      <div className="profile-section-title">生成参数</div>

      <ProfileRow
        id="effort"
        label="推理强度"
        hint={
          provider?.kind === 'lm-studio'
            ? '同时发送标准参数和本地模型兼容提示；第三方模型是否支持全部档位取决于其模板。'
            : effort?.hint ?? '仅在当前模型支持推理控制时生效。'
        }
        action={
          <div className="segmented" role="group" aria-label="推理强度">
            {EFFORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                data-effort={option.value}
                aria-pressed={bot.reasoning_effort === option.value}
                title={option.hint}
                onClick={() => save({ reasoning_effort: option.value })}
                className={`segmented-item shape-rect${bot.reasoning_effort === option.value ? ' is-selected' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      <ProfileRow
        id="decision"
        label="响应决策"
        hint={
          cli && judgeEngine === 'cli'
            ? '本地 CLI 没有判断用 Provider：发言判断由 CLI 自身完成，只用于首轮。'
            : decision?.hint
        }
        action={
          <div className="segmented" role="group" aria-label="响应决策策略">
            {DECISION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                data-decision={option.value}
                aria-pressed={bot.response_decision_strategy === option.value}
                title={option.hint}
                onClick={() => save({ response_decision_strategy: option.value })}
                className={`segmented-item shape-rect${bot.response_decision_strategy === option.value ? ' is-selected' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      <ProfileRow
        id="tokens"
        label="最大输出 Token"
        hint="新建 Bot 默认 8192；简短聊天可按成本需要调低。"
        action={
          <input
            aria-label="最大输出 Token"
            key={`${bot.id}:${bot.max_tokens}`}
            className="w-[84px] shrink-0 rounded-lg border border-stone-200 bg-white px-2 py-1 text-right text-[12px] tabular-nums text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200"
            type="number"
            min={64}
            max={131072}
            step={64}
            defaultValue={bot.max_tokens}
            onBlur={(event) => {
              const value = Math.max(
                64,
                Math.min(131072, Math.round(Number(event.target.value) || 8192)),
              )
              event.target.value = String(value)
              if (value !== bot.max_tokens) save({ max_tokens: value })
            }}
          />
        }
      />

      <ProfileRow
        id="temperature"
        label="Temperature"
        summary={fixedTemperature ? '1.0 · 模型固定' : temp.toFixed(1)}
        action={
          <input
            aria-label="Temperature"
            className="w-[104px] shrink-0"
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={fixedTemperature ? 1 : temp}
            disabled={fixedTemperature}
            onChange={(event) => commitTemp(Number(event.target.value))}
          />
        }
      />

      {chat.type === 'dm' && (
        <div className="px-4 py-3">
          <ChatBackgroundPicker chat={chat} compact />
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
          className="chat-background-current shape-rect"
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
              className="group-background-option shape-rect"
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
  const providers = useSettingsStore((s) => s.providers)
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
        <div className="selectable mt-3 w-full truncate px-1 text-center text-[16px] font-semibold text-stone-800 dark:text-stone-100">
          {bot.name}
        </div>
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
      <div className="grid grid-cols-6 border-b border-stone-200 px-2 dark:border-stone-800">
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
        {tab === 'settings' && (
          <ProfileTab
            key={bot.id}
            bot={bot}
            chat={chat}
            providers={providers}
            onOpenTab={setTab}
            onEditAvatar={() => setAvatarOpen(true)}
          />
        )}
        {tab === 'memory' && <MemoryPanel botId={bot.id} sceneId={chat.id} />}
        {tab === 'workspace' && <WorkspacePanel botId={bot.id} />}
        {tab === 'scheduled' && <ScheduledTasksPanel bot={bot} chat={chat} />}
        {tab === 'extensions' && <ExtensionsPanel key={bot.id} botId={bot.id} />}
        {tab === 'lifestyle' && <AvatarLifestyle bot={bot} />}
      </div>
    </aside>
  )
}
