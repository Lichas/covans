import { useBotsStore } from '../stores/botsStore'
import { useChatsStore } from '../stores/chatsStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { PlusIcon, SparkIcon, UsersIcon } from './icons'

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
      <div className="welcome-content">
        <span className="welcome-mark">
          <SparkIcon width={32} height={32} />
        </span>
        <span className="eyebrow">YOUR OWN LITTLE UNIVERSE</span>
        <h1>好想法，从对话开始。</h1>
        <p>
          工作里的搭档，生活里的灵感。
          <br />在 Covan，找到与你合拍的 Bot。
        </p>
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
                  className="welcome-bot-card"
                  onClick={() => void createDm(bot.id)}
                >
                  <Avatar name={bot.name} avatar={bot.avatar} size={36} />
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
        <div className="welcome-shortcuts">
          <span>
            <kbd>⌘ 1</kbd> 新建 Bot
          </span>
          <span>
            <kbd>⌘ K</kbd> 搜索会话
          </span>
          <span>
            <kbd>⌘ ,</kbd> 设置
          </span>
        </div>
      </div>
    </section>
  )
}
