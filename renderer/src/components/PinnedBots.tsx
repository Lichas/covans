import { useBotsStore } from '../stores/botsStore'
import { useActiveChat, useChatsStore } from '../stores/chatsStore'
import { useState } from 'react'
import { Avatar } from './Avatar'
import { ChatContextMenu } from './ChatContextMenu'
import { StarIcon } from './icons'

export function PinnedBots() {
  const bots = useBotsStore((s) => s.bots)
  const createDm = useChatsStore((s) => s.createDm)
  const chat = useActiveChat()
  const chats = useChatsStore((s) => s.chats)
  const [menu, setMenu] = useState<{ chatId: string; x: number; y: number } | null>(null)
  const menuChat = chats.find((c) => c.id === menu?.chatId)
  const pinned = bots.filter((b) => b.pinned).slice(0, 3)
  if (!pinned.length) return null
  return (
    <div className="pinned-bots" aria-label="置顶 Bot">
      {pinned.map((b) => (
        <button
          key={b.id}
          title={b.name}
          aria-label={'置顶 ' + b.name}
          aria-current={chat?.bot_id === b.id ? 'page' : undefined}
          className={chat?.bot_id === b.id ? 'active' : ''}
          onClick={() => void createDm(b.id)}
          aria-haspopup="menu"
          onContextMenu={(event) => {
            event.preventDefault()
            const dm = chats.find((c) => c.type === 'dm' && c.bot_id === b.id)
            if (dm) setMenu({ chatId: dm.id, x: event.clientX, y: event.clientY })
          }}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              const dm = chats.find((c) => c.type === 'dm' && c.bot_id === b.id)
              if (!dm) return
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              setMenu({ chatId: dm.id, x: rect.left, y: rect.bottom })
            }
          }}
        >
          <span className="pinned-portrait">
            <Avatar name={b.name} avatar={b.avatar} size={58} />
            <span className="pinned-badge" aria-hidden="true"><StarIcon size={9} fill="currentColor" /></span>
          </span>
          <span>{b.name}</span>
        </button>
      ))}
      {menu && menuChat && <ChatContextMenu chat={menuChat} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  )
}
