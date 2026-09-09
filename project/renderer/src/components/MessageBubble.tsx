import { memo } from 'react'
import type { Bot, Message } from '@shared/types'
import { Avatar } from './Avatar'
import { QuoteIcon, RefreshIcon, WarnIcon } from './icons'
import { CopyButton } from './CopyButton'
import { MarkdownContent } from './MarkdownContent'
import { formatFullTime, formatMessageTime } from '../lib/format'

interface Props {
  message: Message
  bot: Bot | null
  isGroup: boolean
  streaming?: boolean
  busy?: boolean
  onInspectBot?: (botId: string) => void
  onRetry?: (message: Message) => void
  onQuote?: (message: Message) => void
}

export const MessageBubble = memo(function MessageBubble({
  message,
  bot,
  streaming,
  busy,
  onInspectBot,
  onRetry,
  onQuote,
}: Props) {
  if (message.sender_type === 'system') {
    if (!message.content) return null
    return (
      <div
        className="system-message selectable"
        title={formatFullTime(message.created_at)}
      >
        {message.content}
      </div>
    )
  }
  const isUser = message.sender_type === 'user'
  const isError = message.status === 'error'
  const name = isUser ? '你' : (bot?.name ?? 'Bot')
  return (
    <article
      className={`message-row ${isUser ? 'message-user' : 'message-bot'}`}
      data-message-id={message.id}
      data-status={message.status}
      aria-label={`${name}的消息`}
    >
      {!isUser && (
        <button
          className="message-avatar"
          onClick={() => bot && onInspectBot?.(bot.id)}
          title={`查看 ${name} 的设置`}
          disabled={!bot}
        >
          <Avatar name={name} avatar={bot?.avatar ?? ''} size={30} />
        </button>
      )}
      <div className="message-body">
        <div className="message-meta">
          <span className="message-author">{name}</span>
          <time
            dateTime={new Date(message.created_at).toISOString()}
            title={formatFullTime(message.created_at)}
          >
            {formatMessageTime(message.created_at)}
          </time>
          {streaming && <span className="generation-label">正在回复</span>}
        </div>
        <div className={`message-surface ${isError ? 'message-error' : ''}`}>
          {isUser ? (
            <div className="selectable msg-content">{message.content}</div>
          ) : message.content ? (
            <MarkdownContent content={message.content} />
          ) : streaming ? (
            <div className="thinking-indicator" role="status">
              <span />
              <span />
              <span />
              <span className="sr-only">正在思考</span>
            </div>
          ) : isError ? (
            <span className="text-stone-500">未能完成这次回复</span>
          ) : null}
        </div>
        {isError && (
          <div className="message-error-info" role="alert">
            <WarnIcon width={14} height={14} />
            <span>{message.error || '生成失败，请重试'}</span>
          </div>
        )}
        {message.status === 'stopped' && (
          <div className="message-stopped">已停止生成 · 已保留现有内容</div>
        )}
        {!streaming && (
          <div className="message-actions">
            {message.content && (
              <>
                <CopyButton text={message.content} compact />
                <button
                  className="message-action"
                  onClick={() => onQuote?.(message)}
                  title="引用回复"
                  aria-label="引用回复"
                >
                  <QuoteIcon width={14} height={14} />
                </button>
              </>
            )}
            {isError && (
              <button
                className="message-action"
                disabled={busy}
                onClick={() => onRetry?.(message)}
              >
                <RefreshIcon width={14} height={14} />
                重试
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
})
