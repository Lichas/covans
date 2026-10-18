import { useBotsStore } from '../stores/botsStore'
import { useChatsStore } from '../stores/chatsStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { GroupAvatar, chatDisplayName } from './Sidebar'
import { formatChatTime } from '../lib/format'
import { PlusIcon, UsersIcon } from './icons'

export function WelcomeView() {
  const bots = useBotsStore((s) => s.bots)
  const chats = useChatsStore((s) => s.chats)
  const selectChat = useChatsStore((s) => s.selectChat)
  const recent = [...chats].filter((chat) => !chat.hidden).sort((a, b) => (b.last_message_at || b.created_at) - (a.last_message_at || a.created_at)).slice(0, 6)
  const createDm = useChatsStore((s) => s.createDm)
  const setNewBotOpen = useUiStore((s) => s.setNewBotOpen)
  const setNewGroupOpen = useUiStore((s) => s.setNewGroupOpen)
  return (
    <section className="welcome-view">
      <div
        className="welcome-drag"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="welcome-content">
        {recent.length > 0 && <section className="welcome-recent" aria-label="最近对话">
          <h1 className="text-lg font-semibold">继续对话</h1>
          <div className="bot-card-grid mt-4">
            {recent.map((chat) => <button key={chat.id} className="welcome-bot-card welcome-chat-card shape-rect" onClick={() => void selectChat(chat.id)} data-chat-id={chat.id}>
              {chat.type === 'group' ? <GroupAvatar chat={chat} /> : <Avatar name={chatDisplayName(chat)} avatar={chat.member_bots[0]?.avatar || ''} size={42} />}
              <div><strong>{chatDisplayName(chat)}</strong><span>{chat.preview || (chat.type === 'group' ? `${chat.member_bots.length} 位成员 · 开始讨论` : '开始对话')}</span><small>{chat.type === 'group' ? '群聊 · ' : ''}{formatChatTime(chat.last_message_at || chat.created_at)}</small></div>
            </button>)}
          </div>
        </section>}

        <div className="welcome-actions">
          <button
            className={recent.length ? 'welcome-secondary' : 'welcome-primary'}
            onClick={() => setNewBotOpen(true)}
          >
            <PlusIcon width={16} height={16} />
            创建你的 Bot
          </button>
          <button
            className="welcome-secondary"
            onClick={() => setNewGroupOpen(true)}
          >
            <UsersIcon width={16} height={16} />
            发起群聊
          </button>
        </div>
        {bots.length > 0 && (
          <details className="welcome-bots" open={recent.length ? undefined : true}>
            <summary className="cursor-pointer text-sm font-medium">所有 Bot（{bots.length}）</summary>
            <div className="bot-card-grid">
              {bots.map((bot) => (
                <button
                  key={bot.id}
                  className="welcome-bot-card welcome-all-bot-card shape-rect"
                  onClick={() => void createDm(bot.id)}
                >
                  <Avatar name={bot.name} avatar={bot.avatar} size={46} />
                  <div>
                    <strong>{bot.name}</strong>
                    <span>{bot.description || '随时准备和你聊聊'}</span>
                  </div>
                  <span className="card-arrow">↗</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  )
}
