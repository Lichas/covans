import { useBotsStore } from '../stores/botsStore'
import { useActiveChat, useChatsStore } from '../stores/chatsStore'
import { Avatar } from './Avatar'

export function PinnedBots() {
  const bots = useBotsStore((s) => s.bots)
  const createDm = useChatsStore((s) => s.createDm)
  const chat = useActiveChat()
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
        >
          <Avatar name={b.name} avatar={b.avatar} size={46} />
          <span>{b.name}</span>
        </button>
      ))}
    </div>
  )
}
