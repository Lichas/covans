import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Message } from '@shared/types'
import { useBotMap } from '../stores/botsStore'
import { useActiveChat } from '../stores/chatsStore'
import { useMessagesStore } from '../stores/messagesStore'
import { useUiStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useDraftsStore } from '../stores/draftsStore'
import { api } from '../lib/api'
import { formatMessageDay, messageDay } from '../lib/format'
import { groupBackgroundUrl } from '../lib/groupBackground'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { chatDisplayName } from './Sidebar'
import { Avatar } from './Avatar'
import { WelcomeView } from './WelcomeView'
import {
  AgentConversationCard,
  AgentConversationDialog,
  useAgentThreads,
} from './AgentConversations'
import {
  ArrowDownIcon,
  DownloadIcon,
  GearIcon,
  ProviderIcon,
  SparkIcon,
  UserPlusIcon,
  UsersIcon,
} from './icons'

export function ChatView() {
  const chat = useActiveChat()
  const botMap = useBotMap()
  const messagesByChat = useMessagesStore((s) => s.messages)
  const streaming = useMessagesStore((s) => s.streaming)
  const generating = useMessagesStore((s) =>
    chat ? !!s.generating[chat.id] : false,
  )
  const hasOlder = useMessagesStore((s) =>
    chat ? !!s.hasOlder[chat.id] : false,
  )
  const loadingOlder = useMessagesStore((s) =>
    chat ? !!s.loadingOlder[chat.id] : false,
  )
  const loadError = useMessagesStore((s) => (chat ? s.errors[chat.id] : ''))
  const loaded = useMessagesStore((s) =>
    chat ? !!s.loadedChats[chat.id] : false,
  )
  const loadOlder = useMessagesStore((s) => s.loadOlder)
  const retry = useMessagesStore((s) => s.retry)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const setRightPanelOpen = useUiStore((s) => s.setRightPanelOpen)
  const inspectedBotId = useUiStore((s) => s.inspectedBotId)
  const inspectBot = useUiStore((s) => s.inspectBot)
  const providers = useSettingsStore((s) => s.providers)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const historyAnchor = useRef<{
    height: number
    top: number
    chatId: string
  } | null>(null)
  const [showJump, setShowJump] = useState(false)
  const [exportState, setExportState] = useState('')
  const [exporting, setExporting] = useState(false)
  const [privateId, setPrivateId] = useState<string | null>(null)
  const setInviteChatId = useUiStore((s) => s.setInviteChatId)
  const privateThreads = useAgentThreads(chat?.id)
  const messages = useMemo(() => {
    if (!chat) return []
    const final = messagesByChat[chat.id] ?? []
    const ids = new Set(final.map((m) => m.id))
    return [
      ...final,
      ...Object.values(streaming).filter(
        (m) => m.chat_id === chat.id && !ids.has(m.id),
      ),
    ].sort((a, b) => a.created_at - b.created_at)
  }, [chat, messagesByChat, streaming])
  const lastContent = messages.at(-1)?.content
  const bot = chat?.bot_id ? botMap.get(chat.bot_id) : undefined
  const provider = providers.find((p) => p.id === bot?.provider_id)

  useLayoutEffect(() => {
    stickToBottom.current = true
    historyAnchor.current = null
    setShowJump(false)
    setExportState('')
    setPrivateId(null)
    if (chat?.type === 'group') inspectBot(null)
  }, [chat?.id])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const anchor = historyAnchor.current
    if (anchor && anchor.chatId === chat?.id) {
      el.scrollTop = anchor.top + el.scrollHeight - anchor.height
      historyAnchor.current = null
    } else if (stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [
    messages.length,
    lastContent,
    chat?.id,
    generating,
    privateThreads.length,
  ])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === '.' &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault()
        toggleRightPanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleRightPanel])

  const quote = (message: Message) => {
    if (!chat) return
    useDraftsStore.getState().setDraft(chat.id, {
      quote: {
        messageId: message.id,
        author: message.sender_type === 'user' ? '你' : (chat.member_bots.find((b) => b.id === message.sender_bot_id)?.name ?? 'Bot'),
        content: message.content,
      },
    })
    requestAnimationFrame(() =>
      document.getElementById('message-composer')?.focus(),
    )
  }

  const older = async () => {
    if (!chat || !scrollRef.current || loadingOlder) return
    stickToBottom.current = false
    historyAnchor.current = {
      chatId: chat.id,
      height: scrollRef.current.scrollHeight,
      top: scrollRef.current.scrollTop,
    }
    const count = await loadOlder(chat.id)
    if (!count) historyAnchor.current = null
  }

  if (!chat) return <WelcomeView />
  const isGroup = chat.type === 'group'
  const title = chatDisplayName(chat)
  const backgroundUrl =
    chat.background_image ? groupBackgroundUrl(chat.background_image) : ''
  const backgroundStyle = backgroundUrl
    ? ({
        '--group-bg-image': `url("${backgroundUrl}")`,
      } as React.CSSProperties)
    : undefined

  return (
    <section
      className={`chat-view ${backgroundUrl ? 'group-background' : ''}`}
      style={backgroundStyle}
    >
      <header
        className="chat-header"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex min-w-0 items-center gap-3">
          {isGroup ? (
            <span className="header-group-icon">
              <UsersIcon width={19} height={19} />
            </span>
          ) : (
            <Avatar name={title} avatar={bot?.avatar ?? ''} size={34} />
          )}
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold">{title}</h1>
            <div className="chat-subtitle">
              {provider && (
                <ProviderIcon kind={provider.kind} width={12} height={12} />
              )}
              {generating
                ? isGroup
                  ? '成员正在准备回复…'
                  : '正在回复…'
                : isGroup
                  ? `${chat.member_bots.length} 位成员 · 共享上下文`
                  : bot?.model || provider?.default_model || '尚未配置模型'}
            </div>
          </div>
        </div>
        <div
          className="flex shrink-0 items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            className="icon-button"
            aria-label="邀请 Bot"
            title={isGroup ? '邀请 Bot 加入群聊' : '邀请 Bot 组建群聊'}
            onClick={() => setInviteChatId(chat.id)}
          >
            <UserPlusIcon width={17} height={17} />
          </button>
          <button
            className="icon-button"
            aria-label="导出会话"
            title="导出完整会话为 Markdown"
            disabled={!messages.length || generating || exporting}
            onClick={async () => {
              setExporting(true)
              try {
                const path = await api.exportChat(chat.id)
                setExportState(path ? '会话已导出' : '')
              } catch (e) {
                setExportState(String(e))
              } finally {
                setExporting(false)
              }
            }}
          >
            <DownloadIcon width={17} height={17} />
          </button>
          <button
            className={`icon-button ${rightPanelOpen ? 'active' : ''}`}
            onClick={() => {
              if (!isGroup) {
                toggleRightPanel()
                return
              }
              if (rightPanelOpen && !inspectedBotId) {
                setRightPanelOpen(false)
                return
              }
              inspectBot(null)
              setRightPanelOpen(true)
            }}
            aria-label={rightPanelOpen ? '收起设置' : '展开设置'}
            title="Bot 设置 · ⌘."
          >
            <GearIcon width={17} height={17} />
          </button>
        </div>
      </header>
      {exportState && (
        <div className="chat-notice" role="status">
          {exportState}
          <button onClick={() => setExportState('')}>关闭</button>
        </div>
      )}
      <div className="message-scroll-wrap">
        <div
          ref={scrollRef}
          className="message-scroll scroll-thin"
          aria-label="聊天消息"
          onScroll={() => {
            const el = scrollRef.current
            if (!el) return
            const nearBottom =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100
            stickToBottom.current = nearBottom
            setShowJump(!nearBottom)
          }}
        >
          <div className="message-column">
            {hasOlder && (
              <div className="history-button">
                <button disabled={loadingOlder} onClick={() => void older()}>
                  {loadingOlder ? '正在加载…' : '加载更早的消息'}
                </button>
              </div>
            )}
            {loadError && (
              <div role="alert" className="chat-notice">
                {loadError}
                <button
                  onClick={() =>
                    void useMessagesStore.getState().loadMessages(chat.id)
                  }
                >
                  重试
                </button>
              </div>
            )}
            {!loaded && !messages.length && !loadError && (
              <div className="empty-chat">
                <p>正在加载会话…</p>
              </div>
            )}
            {loaded && messages.length === 0 && (
              <div className="empty-chat">
                <SparkIcon width={28} height={28} />
                <h2>和{title}聊点什么？</h2>
                <p>
                  {bot?.description ||
                    (isGroup
                      ? '把不同视角聚在一起，让想法更进一步。'
                      : '一个问题、一个灵感，都可以是开始。')}
                </p>
                <div className="suggestion-list">
                  {[
                    '介绍一下你自己',
                    '帮我梳理一个想法',
                    '我们一起制定一个计划',
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => {
                        useDraftsStore
                          .getState()
                          .setDraft(chat.id, { text: prompt })
                        document.getElementById('message-composer')?.focus()
                      }}
                    >
                      {prompt}
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {privateThreads
              .filter(
                (t) => !messages.some((m) => m.id === t.origin_message_id),
              )
              .map((t) => (
                <AgentConversationCard
                  key={t.id}
                  thread={t}
                  onOpen={() => setPrivateId(t.id)}
                />
              ))}
            {messages.map((m, i) => (
              <Fragment key={m.id}>
                {(i === 0 ||
                  messageDay(messages[i - 1].created_at) !==
                    messageDay(m.created_at)) && (
                  <div className="date-divider">
                    <span>{formatMessageDay(m.created_at)}</span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  bot={
                    m.sender_bot_id
                      ? (botMap.get(m.sender_bot_id) ?? null)
                      : null
                  }
                  isGroup={isGroup}
                  streaming={m.status === 'streaming'}
                  busy={generating}
                  onInspectBot={inspectBot}
                  onRetry={(msg) => void retry(chat.id, msg)}
                  onQuote={quote}
                />
                {privateThreads
                  .filter((t) => t.origin_message_id === m.id)
                  .map((t) => (
                    <AgentConversationCard
                      key={t.id}
                      thread={t}
                      onOpen={() => setPrivateId(t.id)}
                    />
                  ))}
              </Fragment>
            ))}
            {!isGroup &&
              generating &&
              !messages.some((m) => m.status === 'streaming') && (
              <div className="waiting-turn" role="status">
                <span className="status-dot" />
                正在准备回复…
              </div>
            )}
          </div>
        </div>
        {showJump && (
          <button
            className="jump-button"
            aria-label="回到最新消息"
            onClick={() => {
              stickToBottom.current = true
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth',
              })
            }}
          >
            <ArrowDownIcon width={16} height={16} />
            回到最新
          </button>
        )}
      </div>
      <Composer key={chat.id} chat={chat} />
      <AgentConversationDialog
        threadId={privateId}
        onClose={() => setPrivateId(null)}
      />
    </section>
  )
}
