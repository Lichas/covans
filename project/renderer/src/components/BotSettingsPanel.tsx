// components/BotSettingsPanel.tsx — 右栏：Bot 设定 / 记忆 / 工作区
import { useEffect, useRef, useState } from 'react'
import type { Bot, ReasoningEffort } from '@shared/types'
import { useBotsStore } from '../stores/botsStore'
import { useActiveChat } from '../stores/chatsStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { AvatarDialog } from './AvatarSettings'
import { MemoryPanel } from './MemoryPanel'
import { WorkspacePanel } from './WorkspacePanel'
import { Field, Toggle, inputCls } from './controls'
import { PencilIcon, ProviderIcon } from './icons'

type Tab = 'settings' | 'memory' | 'workspace' | 'model'

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

function SettingsTab({ bot }: { bot: Bot }) {
  const updateBot = useBotsStore((s) => s.updateBot)
  const save = (patch: Parameters<typeof updateBot>[1]) => {
    void updateBot(bot.id, patch).catch(() => undefined)
  }
  return (
    <div className="space-y-4 p-4">
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
      <BotField
        label="人设 System Prompt"
        multiline
        value={bot.system_prompt}
        placeholder="描述这个 Bot 的身份、能力与说话方式…"
        onSave={(v) => save({ system_prompt: v })}
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
        <Field label="Provider">
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
                const nextProvider = providers.find((p) => p.id === providerId)
                save({
                  provider_id: providerId,
                  reasoning_effort:
                    nextProvider?.kind === 'kimi'
                      ? 'high'
                      : nextProvider?.kind === 'lm-studio'
                        ? 'off'
                        : bot.reasoning_effort,
                })
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
        <BotField
          label="模型（留空用 Provider 默认）"
          value={bot.model}
          placeholder={
            providers.find((p) => p.id === bot.provider_id)?.default_model ||
            '如 gpt-4o'
          }
          onSave={(v) => save({ model: v })}
        />
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
                Math.min(131072, Math.round(Number(e.target.value) || 4096)),
              )
              e.target.value = String(value)
              if (value !== bot.max_tokens) save({ max_tokens: value })
            }}
          />
          <p className="mt-1.5 text-[11px] text-stone-400">
            日常聊天建议 512–2048；复杂长文再提高。
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

export function BotSettingsPanel() {
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

  if (!bot) {
    return (
      <aside className="flex w-[320px] shrink-0 flex-col items-center justify-center gap-2 border-l border-stone-200 bg-stone-50/60 text-stone-400 dark:border-stone-800 dark:bg-stone-900/40">
        <p className="px-8 text-center text-[13px] leading-relaxed">
          {chat.type === 'group'
            ? '点击群聊中某位成员的头像，即可查看与编辑它的设置'
            : '该会话没有关联 Bot'}
        </p>
      </aside>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'settings', label: '设定' },
    { id: 'memory', label: '记忆' },
    { id: 'workspace', label: '工作区' },
    { id: 'model', label: '模型' },
  ]

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-stone-200 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-900/40">
      {/* 头部：头像 + 名称 */}
      <div className="flex items-center gap-3 border-b border-stone-200 px-4 py-4 dark:border-stone-800">
        <button
          onClick={() => setAvatarOpen(true)}
          className="group relative shrink-0"
          title="设计头像"
          aria-label="设计头像"
        >
          <Avatar name={bot.name} avatar={bot.avatar} size={52} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 text-white opacity-0 transition group-hover:opacity-100">
            <PencilIcon width={16} height={16} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
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
            className="selectable w-full rounded-md bg-transparent px-1 py-0.5 text-[15px] font-semibold text-stone-800 outline-none transition hover:bg-stone-100 focus:bg-white focus:ring-1 focus:ring-stone-300 dark:text-stone-100 dark:hover:bg-stone-800 dark:focus:bg-stone-800"
          />
          <div className="mt-0.5 truncate px-1 text-[11.5px] text-stone-400">
            {bot.description || '暂无描述'}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 text-[12px] text-stone-500">
        <button onClick={() => setAvatarOpen(true)}>生成 / 更换头像 ↗</button>
      </div>
      {error && (
        <p role="alert" className="px-5 pb-2 text-[12px] text-red-500">
          {error}
        </p>
      )}
      <AvatarDialog
        bot={bot}
        open={avatarOpen}
        onClose={() => setAvatarOpen(false)}
      />

      {/* Tabs */}
      <div className="flex border-b border-stone-200 px-3 dark:border-stone-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative px-3.5 py-2.5 text-[13px] transition ${
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

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === 'settings' && <SettingsTab bot={bot} />}
        {tab === 'memory' && <MemoryPanel botId={bot.id} />}
        {tab === 'workspace' && <WorkspacePanel botId={bot.id} />}
        {tab === 'model' && <ModelTab bot={bot} />}
      </div>
    </aside>
  )
}
