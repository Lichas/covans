import { useEffect, useRef, useState } from 'react'
import type {
  AgentThread,
  AgentPrivateMessage,
  ChatSummary,
} from '@shared/types'
import { api } from '../lib/api'
import { useBotsStore } from '../stores/botsStore'
import { formatFullTime, formatMessageTime } from '../lib/format'
import { Avatar } from './Avatar'
import { Dialog } from './Dialog'
import { MarkdownContent } from './MarkdownContent'
import { Field, inputCls, btnPrimaryCls, btnGhostCls } from './controls'
import { UsersIcon } from './icons'

const statuses = {
  running: '正在交流',
  done: '已完成',
  error: '未完成',
  stopped: '已停止',
}

export function useAgentThreads(chatId?: string) {
  const [threads, setThreads] = useState<AgentThread[]>([])
  useEffect(() => {
    setThreads([])
    if (!chatId) return
    let active = true
    let version = 0
    const load = async () => {
      const current = ++version
      const result = await api.listAgentThreads(chatId)
      if (active && current === version) setThreads(result)
    }
    void load().catch(() => {})
    const off = api.onEvent((ev) => {
      if (ev.type === 'agent-thread-updated' && ev.chatId === chatId)
        void load().catch(() => {})
    })
    return () => {
      active = false
      off()
    }
  }, [chatId])
  return threads.filter((t) => t.parent_chat_id === chatId)
}

export function AgentConversationCard({
  thread,
  onOpen,
}: {
  thread: AgentThread
  onOpen: () => void
}) {
  const bots = useBotsStore((s) => s.bots)
  const from = bots.find((b) => b.id === thread.from_bot_id)
  const to = bots.find((b) => b.id === thread.to_bot_id)
  return (
    <button
      className="agent-conversation-card"
      onClick={onOpen}
      aria-label={`查看私聊：${from?.name || '已删除 Bot'} 与 ${to?.name || '已删除 Bot'}`}
    >
      <span className="peer-avatars">
        <Avatar
          name={from?.name || '?'}
          avatar={from?.avatar || ''}
          size={28}
        />
        <Avatar
          name={to?.name || '?'}
          avatar={to?.avatar || ''}
          size={28}
          activity={thread.status === 'running'}
        />
      </span>
      <span className="min-w-0 flex-1">
        <strong>
          {from?.name || '已删除 Bot'}{' '}
          <span className="px-1 text-stone-400">↔</span>{' '}
          {to?.name || '已删除 Bot'}
          <small>私聊</small>
        </strong>
        <span className="block truncate text-[11px] text-stone-400">
          {thread.subject}
        </span>
      </span>
      <span className={'peer-status ' + thread.status}>
        {thread.status === 'running' && <i className="status-dot" />}
        {statuses[thread.status]}
      </span>
      <span className="text-stone-400">↗</span>
    </button>
  )
}

export function AgentConversationDialog({
  threadId,
  onClose,
}: {
  threadId: string | null
  onClose: () => void
}) {
  const bots = useBotsStore((s) => s.bots)
  const [data, setData] = useState<{
    thread: AgentThread
    messages: AgentPrivateMessage[]
  }>()
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    setData(undefined)
    setError('')
    setStopping(false)
    stick.current = true
    if (!threadId) return
    let active = true
    let version = 0
    const load = async () => {
      const current = ++version
      try {
        const next = await api.getAgentThread(threadId)
        if (active && current === version) setData(next)
      } catch (e) {
        if (active) setError(String(e))
      }
    }
    void load()
    const off = api.onEvent((ev) => {
      if (ev.type === 'agent-thread-updated' && ev.threadId === threadId)
        void load()
    })
    return () => {
      active = false
      off()
    }
  }, [threadId])
  useEffect(() => {
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight
  }, [data])
  return (
    <Dialog
      open={!!threadId}
      title="Agent 私聊"
      width="w-[700px]"
      onClose={onClose}
    >
      {data ? (
        <>
          <div className="peer-dialog-intro">
            <UsersIcon width={17} height={17} />
            <p>这是两位 Bot 的真实交流记录，只在当前会话中展示。</p>
            <span className={'peer-status ' + data.thread.status}>
              {statuses[data.thread.status]}
            </span>
          </div>
          <div
            ref={scroll}
            className="peer-transcript scroll-thin"
            onScroll={() => {
              const el = scroll.current
              if (el)
                stick.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80
            }}
          >
            {data.messages.map((m) => {
              const bot = bots.find((b) => b.id === m.sender_bot_id)
              return (
                <article key={m.id} className="peer-message">
                  <Avatar
                    name={bot?.name || '?'}
                    avatar={bot?.avatar || ''}
                    size={32}
                    activity={m.status === 'streaming'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2 text-[12px]">
                      <strong>{bot?.name || '已删除 Bot'}</strong>
                      <time
                        className="text-[10px] text-stone-400"
                        title={formatFullTime(m.created_at)}
                        dateTime={new Date(m.created_at).toISOString()}
                      >
                        {formatMessageTime(m.created_at)}
                      </time>
                    </div>
                    {m.content && <MarkdownContent content={m.content} />}
                    {m.status === 'streaming' && (
                      <div
                        role="status"
                        className="mt-2 text-[12px] text-emerald-600"
                      >
                        正在思考与回复…
                      </div>
                    )}
                    {m.error && (
                      <p className="mt-3 text-[12px] text-red-500">{m.error}</p>
                    )}
                    {m.status === 'stopped' && (
                      <p className="mt-2 text-[11px] text-stone-400">
                        回复已停止，保留以上内容
                      </p>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
          <div className="flex items-center justify-between border-t border-stone-100 px-6 py-4 dark:border-stone-700">
            <p className="text-[11px] text-stone-400">
              独立保存 · 不离开主对话
            </p>
            {data.thread.status === 'running' ? (
              <button
                className={btnGhostCls}
                disabled={stopping}
                onClick={async () => {
                  setStopping(true)
                  try {
                    await api.stopAgentConversation(data.thread.id)
                  } catch (e) {
                    setError(String(e))
                    setStopping(false)
                  }
                }}
              >
                停止私聊
              </button>
            ) : (
              <button className={btnGhostCls} onClick={onClose}>
                回到对话
              </button>
            )}
          </div>
        </>
      ) : (
        !error && (
          <p className="p-6 text-[13px] text-stone-400">正在读取私聊记录…</p>
        )
      )}
      {error && (
        <p role="alert" className="p-5 text-[12px] text-red-500">
          {error}
        </p>
      )}
    </Dialog>
  )
}

export function StartAgentConversation({
  chat,
  open,
  onClose,
  onStarted,
}: {
  chat: ChatSummary
  open: boolean
  onClose: () => void
  onStarted: (id: string) => void
}) {
  const bots = useBotsStore((s) => s.bots)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setFrom(chat.bot_id || chat.member_bots[0]?.id || '')
      setTo('')
      setMessage('')
      setError('')
    }
  }, [open, chat.id])
  return (
    <Dialog open={open} title="让 Bot 们聊一聊" onClose={onClose}>
      <div className="space-y-5 p-6">
        <p className="text-[12px] leading-relaxed text-stone-500">
          交给另一位伙伴一个具体问题。也可以直接对当前 Bot
          说「请和设计师讨论一下这个方案」。
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="由谁发起">
            <select
              className={inputCls}
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                if (to === e.target.value) setTo('')
              }}
            >
              {chat.member_bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="向谁请教">
            <select
              className={inputCls}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              <option value="">选择另一位 Bot</option>
              {bots
                .filter((b) => b.id !== from)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="讨论什么">
          <textarea
            rows={4}
            className={inputCls}
            maxLength={12000}
            placeholder="只会分享你在这里填写的问题，不会转发整个主会话。"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-[12px] text-red-500">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button
            className={btnPrimaryCls}
            disabled={busy || !from || !to || !message.trim()}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                const id = await api.startAgentConversation(
                  chat.id,
                  from,
                  to,
                  message.trim(),
                )
                onClose()
                onStarted(id)
              } catch (e) {
                setError(String(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? '正在发起…' : '发起私聊'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
