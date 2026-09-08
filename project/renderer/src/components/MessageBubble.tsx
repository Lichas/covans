// components/MessageBubble.tsx — 消息气泡（用户右黑 / bot 左灰 / system 居中胶囊）
import type { Bot, Message } from '@shared/types'
import { Avatar } from './Avatar'
import { RefreshIcon, WarnIcon } from './icons'

interface Props {
  message: Message
  bot: Bot | null
  isGroup: boolean
  streaming?: boolean
  onInspectBot?: (botId: string) => void
  onRetry?: (message: Message) => void
}

export function MessageBubble({ message, bot, isGroup, streaming, onInspectBot, onRetry }: Props) {
  // 系统消息：居中灰色小胶囊
  if (message.sender_type === 'system') {
    if (!message.content) return null
    return (
      <div className="my-2 flex justify-center">
        <span className="selectable max-w-[70%] rounded-full bg-stone-200/80 px-3.5 py-1 text-center text-[12px] text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">
          {message.content}
        </span>
      </div>
    )
  }

  // 用户消息：右侧近黑白字
  if (message.sender_type === 'user') {
    return (
      <div className="my-1.5 flex justify-end px-4">
        <div className="max-w-[72%]">
          <div className="selectable msg-content rounded-bubble rounded-tr-md bg-ink px-4 py-2.5 text-[14px] leading-relaxed text-white dark:bg-stone-100 dark:text-stone-900">
            {message.content}
          </div>
          {message.status === 'error' && (
            <div className="mt-1 flex items-center justify-end gap-1.5 text-[12px] text-red-500">
              <WarnIcon width={13} height={13} />
              发送失败：{message.error || '未知错误'}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Bot 消息：左侧带头像浅灰气泡
  const name = bot?.name ?? 'Bot'
  const isError = message.status === 'error'
  return (
    <div className="my-1.5 flex gap-2.5 px-4">
      <button
        className="mt-0.5 shrink-0 self-start"
        onClick={() => bot && onInspectBot?.(bot.id)}
        title={bot ? `查看 ${name} 的设置` : undefined}
      >
        <Avatar name={name} avatar={bot?.avatar ?? ''} size={34} />
      </button>
      <div className="max-w-[72%]">
        {isGroup && (
          <div className="mb-1 pl-1 text-[12px] text-stone-400">{name}</div>
        )}
        <div
          className={`selectable msg-content rounded-bubble rounded-tl-md px-4 py-2.5 text-[14px] leading-relaxed ${
            isError
              ? 'border border-red-200 bg-red-50 text-stone-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-stone-300'
              : 'bg-bubbleBot text-stone-800 dark:bg-stone-700/70 dark:text-stone-100'
          } ${streaming ? 'stream-cursor' : ''}`}
        >
          {message.content}
          {streaming && !message.content && <span className="text-stone-400">正在输入…</span>}
        </div>
        {isError && (
          <div className="mt-1.5 flex items-center gap-2 pl-1">
            <span className="flex items-center gap-1 text-[12px] text-red-500">
              <WarnIcon width={13} height={13} />
              {message.error || '生成失败'}
            </span>
            <button
              onClick={() => onRetry?.(message)}
              className="flex items-center gap-1 rounded-full border border-stone-300 px-2.5 py-0.5 text-[12px] text-stone-600 transition hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700"
            >
              <RefreshIcon width={12} height={12} />
              重试
            </button>
          </div>
        )}
        {message.status === 'stopped' && (
          <div className="mt-1 pl-1 text-[11.5px] text-stone-400">已停止生成</div>
        )}
      </div>
    </div>
  )
}
