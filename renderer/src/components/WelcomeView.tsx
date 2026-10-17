import { useBotsStore } from '../stores/botsStore'
import { useChatsStore } from '../stores/chatsStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { PlusIcon, UsersIcon } from './icons'

export function WelcomeView() {
  const bots = useBotsStore((s) => s.bots)
  const createDm = useChatsStore((s) => s.createDm)
  const setNewBotOpen = useUiStore((s) => s.setNewBotOpen)
  const setNewGroupOpen = useUiStore((s) => s.setNewGroupOpen)
  return (
    <section className="welcome-view">
      <div
        className="welcome-drag"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="welcome-ribbon" aria-hidden="true">
        <svg viewBox="0 0 900 900" fill="none"><path d="M770 190C370-100 70 340 340 485S940 490 635 765C420 940 100 710 205 530" stroke="currentColor" strokeWidth="110" strokeLinecap="round" /></svg>
      </div>
      <div className="welcome-topline"><span>Covan <span>/</span> 我的空间</span></div>
      <div className="welcome-content">
        <div className="welcome-actions">
          <button
            className="welcome-primary"
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
          <div className="welcome-bots">
            <div className="eyebrow">继续一段对话</div>
            <div className="bot-card-grid">
              {bots.map((bot) => (
                <button
                  key={bot.id}
                  className="welcome-bot-card shape-rect"
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
          </div>
        )}
      </div>
    </section>
  )
}
