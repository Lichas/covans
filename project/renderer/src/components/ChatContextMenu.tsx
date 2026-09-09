import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBotsStore } from '../stores/botsStore'

export function ChatContextMenu({
  botId,
  x,
  y,
  onClose,
}: {
  botId: string
  x: number
  y: number
  onClose: () => void
}) {
  const bots = useBotsStore((s) => s.bots)
  const update = useBotsStore((s) => s.updateBot)
  const bot = bots.find((b) => b.id === botId)
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
  if (!bot) return null
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="单聊操作"
      className="chat-context-menu"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 240)),
        top: Math.max(8, Math.min(y, window.innerHeight - 140)),
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
      {error && <p role="alert">{error}</p>}
    </div>,
    document.body,
  )
}
