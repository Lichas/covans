// components/Sidebar.tsx — 左栏：+菜单 / 搜索 / 置顶头像 / 会话列表 / 底部导航
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatSummary } from '@shared/types'
import { useChatsStore } from '../stores/chatsStore'
import { useUiStore } from '../stores/uiStore'
import { useMessagesStore } from '../stores/messagesStore'
import { Avatar } from './Avatar'
import { PinnedBots } from './PinnedBots'
import { ChatContextMenu } from './ChatContextMenu'
import { formatChatTime } from '../lib/format'
import {
  ChatIcon,
  CloseIcon,
  GearIcon,
  MeIcon,
  PlusIcon,
  SearchIcon,
  SparkIcon,
  UsersIcon,
} from './icons'

/** 会话显示名：群聊用群名，单聊用 bot 名 */
export function chatDisplayName(chat: ChatSummary): string {
  if (chat.type === 'group') return chat.name || '群聊'
  return chat.member_bots[0]?.name || '会话'
}

/** 群聊叠头像 + N 角标 */
function GroupAvatar({ chat }: { chat: ChatSummary }) {
  const members = chat.member_bots.slice(0, 2)
  const extra = chat.member_bots.length
  return (
    <span className="relative inline-block h-10 w-10 shrink-0">
      {members.map((m, i) => (
        <span
          key={m.id}
          className="absolute"
          style={{ left: i * 14, top: i * 8, zIndex: 2 - i }}
        >
          <Avatar name={m.name} avatar={m.avatar} size={26} />
        </span>
      ))}
      {members.length === 0 && (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-300 text-stone-600 dark:bg-stone-600 dark:text-stone-200">
          <UsersIcon width={20} height={20} />
        </span>
      )}
      <span className="absolute -bottom-0.5 -right-0.5 z-10 rounded-full bg-stone-500 px-1 text-[10px] leading-4 text-white">
        {extra}
      </span>
    </span>
  )
}

function ChatListItem({ chat }: { chat: ChatSummary }) {
  const activeChatId = useChatsStore((s) => s.activeChatId)
  const selectChat = useChatsStore((s) => s.selectChat)
  const inspectBot = useUiStore((s) => s.inspectBot)
  const active = chat.id === activeChatId
  const generating = useMessagesStore((s) => !!s.generating[chat.id])
  const name = chatDisplayName(chat)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      <button
        aria-current={active ? 'page' : undefined}
        aria-label={name}
        aria-haspopup={chat.type === 'dm' ? 'menu' : undefined}
        onContextMenu={(e) => {
          if (chat.type !== 'dm' || !chat.bot_id) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onKeyDown={(e) => {
          if (
            chat.type === 'dm' &&
            (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
          ) {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            setMenu({ x: rect.left + 24, y: rect.bottom })
          }
        }}
        onClick={() => {
          void selectChat(chat.id)
          if (chat.type === 'dm' && chat.bot_id) inspectBot(null)
        }}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
          active
            ? 'bg-stone-200/80 dark:bg-stone-700/60'
            : 'hover:bg-stone-200/50 dark:hover:bg-stone-800'
        }`}
      >
        {chat.type === 'group' ? (
          <GroupAvatar chat={chat} />
        ) : (
          <Avatar
            name={name}
            avatar={chat.member_bots[0]?.avatar ?? ''}
            size={40}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[14px] font-medium text-stone-800 dark:text-stone-100">
              {name}
            </span>
            <span className="shrink-0 text-[11px] text-stone-400">
              {formatChatTime(chat.last_message_at)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span
              className={`truncate text-[12px] ${generating ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-500 dark:text-stone-400'}`}
            >
              {generating
                ? '正在回复…'
                : chat.preview
                    .replace(/[#*`>|]/g, '')
                    .replace(/\s+/g, ' ')
                    .slice(0, 100) || '开始一段新对话'}
            </span>
            {chat.unread > 0 && (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500" />
            )}
          </span>
        </span>
      </button>
      {menu && chat.bot_id && (
        <ChatContextMenu
          botId={chat.bot_id}
          chatId={chat.id}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

function PlusMenu({ onClose }: { onClose: () => void }) {
  const setNewBotOpen = useUiStore((s) => s.setNewBotOpen)
  const setNewGroupOpen = useUiStore((s) => s.setNewGroupOpen)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

  const item =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-700'
  return (
    <div
      ref={ref}
      className="absolute left-3 top-12 z-40 w-48 animate-fadeIn rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg dark:border-stone-700 dark:bg-stone-800"
    >
      <button
        className={item}
        onClick={() => {
          onClose()
          setNewBotOpen(true)
        }}
      >
        <ChatIcon width={17} height={17} className="text-stone-400" />
        新建 Bot
        <span className="ml-auto text-[11px] text-stone-400">⌘1</span>
      </button>
      <button
        className={item}
        onClick={() => {
          onClose()
          setNewGroupOpen(true)
        }}
      >
        <UsersIcon width={17} height={17} className="text-stone-400" />
        创建群聊
        <span className="ml-auto text-[11px] text-stone-400">⌘2</span>
      </button>
    </div>
  )
}

export function Sidebar() {
  const chats = useChatsStore((s) => s.chats)
  const selectChat = useChatsStore((s) => s.selectChat)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const setNewGroupOpen = useUiStore((s) => s.setNewGroupOpen)
  const setProfileOpen = useUiStore((s) => s.setProfileOpen)
  const searchRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'k' &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filteredChats = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...chats].sort(
      (a, b) => b.last_message_at - a.last_message_at,
    )
    if (!q) return sorted
    return sorted.filter(
      (c) =>
        chatDisplayName(c).toLowerCase().includes(q) ||
        (c.preview || '').toLowerCase().includes(q),
    )
  }, [chats, query])

  return (
    <aside className="flex h-full w-[256px] shrink-0 flex-col border-r border-stone-200 bg-stone-100/70 dark:border-stone-800 dark:bg-stone-900/60">
      {/* 顶部：标题 + 新建 */}
      <div
        className="relative flex items-center justify-between px-4 pb-3 pt-10"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          onClick={() => void selectChat(null)}
          className="flex items-center gap-2 text-[16px] font-semibold tracking-tight text-stone-700 dark:text-stone-200"
          aria-label="Covan 首页"
        >
          <SparkIcon
            width={19}
            height={19}
            className="text-emerald-800 dark:text-emerald-300"
          />
          Covan
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="rounded-lg p-1.5 text-stone-500 transition hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
          aria-label="新建"
        >
          <PlusIcon />
        </button>
        {menuOpen && <PlusMenu onClose={() => setMenuOpen(false)} />}
      </div>

      {/* 搜索框 */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg bg-stone-200/70 px-2.5 py-1.5 dark:bg-stone-800">
          <SearchIcon
            width={15}
            height={15}
            className="shrink-0 text-stone-400"
          />
          <input
            ref={searchRef}
            aria-label="搜索会话"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('')
                e.currentTarget.blur()
              }
              if (e.key === 'Enter' && filteredChats[0]) {
                void selectChat(filteredChats[0].id)
                setQuery('')
                e.currentTarget.blur()
              }
            }}
            placeholder="搜索会话"
            className="w-full bg-transparent text-[13px] text-stone-700 outline-none placeholder:text-stone-400 dark:text-stone-200"
          />
          {query ? (
            <button
              className="shrink-0"
              onClick={() => {
                setQuery('')
                searchRef.current?.focus()
              }}
              aria-label="清除搜索"
            >
              <CloseIcon width={13} height={13} />
            </button>
          ) : (
            <span className="shrink-0 text-[10px] text-stone-400">⌘ K</span>
          )}
        </div>
      </div>

      {/* 置顶区：横排圆形头像 */}
      <PinnedBots />

      {/* 会话列表 */}
      <div className="flex items-center justify-between px-5 pb-2 pt-4 text-[10px] tracking-wider text-stone-400">
        <span>{query ? '搜索结果' : '最近对话'}</span>
        <span>{filteredChats.length}</span>
      </div>
      <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {filteredChats.map((c) => (
          <ChatListItem key={c.id} chat={c} />
        ))}
        {filteredChats.length === 0 && (
          <div className="px-4 py-10 text-center text-[12.5px] text-stone-400">
            {chats.length === 0
              ? '还没有会话，点击右上角 + 新建一个 Bot 吧'
              : '没有匹配的会话'}
          </div>
        )}
      </div>

      {/* 底部导航占位 */}
      <button className="profile-entry" onClick={() => setProfileOpen(true)}>
        <span>
          <MeIcon width={18} height={18} />
        </span>
        <div>
          <strong>关于我</strong>
          <small>我的资料与共同记忆</small>
        </div>
        <span className="ml-auto">↗</span>
      </button>
      <div className="flex items-center justify-around border-t border-stone-200 px-2 py-2 dark:border-stone-800">
        <button
          onClick={() => selectChat(null)}
          className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-stone-500 transition hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
        >
          <SparkIcon width={19} height={19} />
          <span className="text-[10.5px]">我的 Bot</span>
        </button>
        <button
          onClick={() => setNewGroupOpen(true)}
          className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-stone-500 transition hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
        >
          <UsersIcon width={19} height={19} />
          <span className="text-[10.5px]">新建群聊</span>
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-stone-500 transition hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
          aria-label="设置"
        >
          <GearIcon width={19} height={19} />
          <span className="text-[10.5px]">设置</span>
        </button>
      </div>
    </aside>
  )
}
