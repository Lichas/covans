import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatSummary } from '@shared/types'
import { useBotsStore } from '../stores/botsStore'
import { useChatsStore } from '../stores/chatsStore'
import { EyeOffIcon, TrashIcon } from './icons'

export function ChatContextMenu({
  chat,
  x,
  y,
  onClose,
}: {
  chat: ChatSummary
  x: number
  y: number
  onClose: () => void
}) {
  const bots = useBotsStore((s) => s.bots)
  const update = useBotsStore((s) => s.updateBot)
  const deleteBot = useBotsStore((s) => s.deleteBot)
  const hideChat = useChatsStore((s) => s.hideChat)
  const clearChatMessages = useChatsStore((s) => s.clearChatMessages)
  const deleteChat = useChatsStore((s) => s.deleteChat)
  const selectChat = useChatsStore((s) => s.selectChat)
  const loadChats = useChatsStore((s) => s.loadChats)
  const bot = bots.find((b) => b.id === chat.bot_id)
  const menu = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const full = bots.filter((b) => b.pinned).length >= 3 && !bot?.pinned
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const down = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) close.current()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') close.current()
    }
    const dismiss = () => close.current()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', dismiss)
    }
  }, [])
  if (chat.type === 'group')
    return createPortal(
      <div
        ref={menu}
        role="menu"
        aria-label="群聊操作"
        className="chat-context-menu"
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 240)),
          top: Math.max(8, Math.min(y, window.innerHeight - 100)),
        }}
      >
        <button
          role="menuitem"
          disabled={busy}
          className="chat-context-danger"
          onClick={async () => {
            if (
              !window.confirm(
                `确定删除群聊「${chat.name || '群聊'}」吗？全部聊天记录和 Agent 私聊记录将永久删除，此操作不可撤销。`,
              )
            )
              return
            setBusy(true)
            try {
              await deleteChat(chat.id)
              onClose()
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <span>删除群聊</span>
          <TrashIcon width={15} height={15} />
        </button>
        {error && <p role="alert">{error}</p>}
      </div>,
      document.body,
    )
  if (!bot) return null
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="单聊操作"
      className="chat-context-menu"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 240)),
        top: Math.max(8, Math.min(y, window.innerHeight - 260)),
      }}
    >
      <button
        role="menuitem"
        disabled={busy}
        aria-disabled={full || busy}
        onClick={async () => {
          if (full) {
            setError('最多置顶 3 个 Bot，请先取消一个置顶')
            return
          }
          setBusy(true)
          try {
            await update(bot.id, { pinned: !bot.pinned })
            onClose()
          } catch (e) {
            setError(String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <span>{bot.pinned ? '取消置顶' : '置顶'}</span>
        <span className="text-[11px] text-stone-400">
          {bot.pinned ? '↓' : '↑'}
        </span>
      </button>
      {full && <p>已置顶 3 个，请先取消一个</p>}
      <div className="chat-context-separator" />
      <button
        role="menuitem"
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              `不再在列表显示与「${bot.name}」的聊天？Bot 和聊天记录都会保留，可在「我的 Bot」中再次打开。`,
            )
          )
            return
          setBusy(true)
          try {
            await hideChat(chat.id)
            onClose()
          } catch (e) {
            setError(String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <span>不显示</span>
        <EyeOffIcon width={15} height={15} />
      </button>
      <button
        role="menuitem"
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              `确定清空与「${bot.name}」的全部聊天记录吗？此操作不可撤销。`,
            )
          )
            return
          setBusy(true)
          try {
            await clearChatMessages(chat.id)
            onClose()
          } catch (e) {
            setError(String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <span>清空聊天记录</span>
        <TrashIcon width={15} height={15} />
      </button>
      <button
        role="menuitem"
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              `确定删除 Bot「${bot.name}」吗？它的单聊和记忆将无法恢复；工作区文件会保留在本机。`,
            )
          )
            return
          setBusy(true)
          try {
            await deleteBot(bot.id)
            await selectChat(null)
            await loadChats()
            onClose()
          } catch (e) {
            setError(String(e))
          } finally {
            setBusy(false)
          }
        }}
        className="chat-context-danger"
      >
        <span>删除 Bot</span>
        <TrashIcon width={15} height={15} />
      </button>
      {error && <p role="alert">{error}</p>}
    </div>,
    document.body,
  )
}
