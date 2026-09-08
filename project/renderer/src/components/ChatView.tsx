// components/ChatView.tsx — 中栏：会话头部 + 消息流 + Composer
import { useEffect, useMemo, useRef } from 'react'
import type { Message } from '@shared/types'
import { useBotMap } from '../stores/botsStore'
import { useActiveChat } from '../stores/chatsStore'
import { useMessagesStore } from '../stores/messagesStore'
import { useUiStore } from '../stores/uiStore'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { chatDisplayName } from './Sidebar'
import { ChatIcon, ExpandIcon, UsersIcon } from './icons'

export function ChatView() {
  const chat = useActiveChat()
  const botMap = useBotMap()
  const messagesByChat = useMessagesStore((s) => s.messages)
  const streaming = useMessagesStore((s) => s.streaming)
  const loadOlder = useMessagesStore((s) => s.loadOlder)
  const retry = useMessagesStore((s) => s.retry)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const inspectBot = useUiStore((s) => s.inspectBot)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const messages: Message[] = useMemo(
    () => (chat ? messagesByChat[chat.id] ?? [] : []),
    [chat, messagesByChat],
  )
  const streamingList = useMemo(
    () =>
      chat
        ? Object.entries(streaming)
            .filter(([, s]) => s.chatId === chat.id)
            .map(([id, s]) => ({ id, content: s.content }))
        : [],
    [chat, streaming],
  )
  const streamSignature = streamingList.map((s) => s.content.length).join(',')

  // 新消息 / 流式增量时贴底滚动
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length, streamSignature, chat?.id])

  // 切换会话后滚到底
  useEffect(() => {
    stickToBottom.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat?.id])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (el.scrollTop < 40 && chat) void loadOlder(chat.id)
  }

  if (!chat) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-stone-400">
        <ChatIcon width={44} height={44} className="text-stone-300 dark:text-stone-600" />
        <p className="text-[14px]">选择一个会话，或点击左上角 + 新建 Bot / 创建群聊</p>
      </section>
    )
  }

  const isGroup = chat.type === 'group'
  const title = chatDisplayName(chat)

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-white/40 dark:bg-stone-900/20">
      {/* 头部 */}
      <header
        className="flex items-center justify-between border-b border-stone-200 px-5 py-3 dark:border-stone-800"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-[15.5px] font-semibold text-stone-800 dark:text-stone-100">{title}</h1>
          {isGroup && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-stone-200/70 px-2 py-0.5 text-[11px] text-stone-500 dark:bg-stone-700/70 dark:text-stone-300">
              <UsersIcon width={12} height={12} />
              {chat.member_bots.length} 个成员
            </span>
          )}
        </div>
        <button
          onClick={toggleRightPanel}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition ${
            rightPanelOpen
              ? 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200'
              : 'text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800'
          }`}
          title={rightPanelOpen ? '收起设置' : '展开设置'}
        >
          <ExpandIcon width={15} height={15} />
          {rightPanelOpen ? '收起设置' : '展开设置'}
        </button>
      </header>

      {/* 消息流 */}
      <div ref={scrollRef} onScroll={onScroll} className="scroll-thin flex-1 overflow-y-auto py-3">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            bot={m.sender_bot_id ? botMap.get(m.sender_bot_id) ?? null : null}
            isGroup={isGroup}
            onInspectBot={(botId) => inspectBot(botId)}
            onRetry={(msg) => chat && void retry(chat.id, msg)}
          />
        ))}
        {streamingList.map((s) => (
          <MessageBubble
            key={s.id}
            streaming
            isGroup={isGroup}
            message={{
              id: s.id,
              chat_id: chat.id,
              sender_type: 'bot',
              sender_bot_id: null,
              content: s.content,
              attachments: [],
              mentions: [],
              status: 'streaming',
              error: '',
              created_at: Date.now(),
            }}
            bot={null}
          />
        ))}
        {messages.length === 0 && streamingList.length === 0 && (
          <div className="mt-24 text-center text-[13px] text-stone-400">
            还没有消息，来说点什么吧
          </div>
        )}
      </div>

      <Composer chat={chat} />
    </section>
  )
}
