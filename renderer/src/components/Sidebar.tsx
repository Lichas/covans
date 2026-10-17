// components/Sidebar.tsx — 左栏：+菜单 / 搜索 / 置顶头像 / 会话列表 / 底部导航
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ChatSummary, UserProfile } from '@shared/types'
import { useBotsStore } from '../stores/botsStore'
import { useChatsStore } from '../stores/chatsStore'
import { useUiStore } from '../stores/uiStore'
import { useMessagesStore } from '../stores/messagesStore'
import { Avatar } from './Avatar'
import { ThemeSwitcher } from './ThemeSwitcher'
import { api } from '../lib/api'
import { PinnedBots } from './PinnedBots'
import { ChatContextMenu } from './ChatContextMenu'
import appIcon from '../assets/app-icon.png'
import { formatChatTime } from '../lib/format'
import {
  ChatIcon,
  CloseIcon,
  GearIcon,
  PlusIcon,
  PinIcon,
  PinOffIcon,
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
export function GroupAvatar({ chat }: { chat: ChatSummary }) {
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

function ChatListItem({ chat, onSelect }: { chat: ChatSummary; onSelect: () => void }) {
  const activeChatId = useChatsStore((s) => s.activeChatId)
  const selectChat = useChatsStore((s) => s.selectChat)
  const inspectBot = useUiStore((s) => s.inspectBot)
  const active = chat.id === activeChatId
  const generating = useMessagesStore((s) => !!s.generating[chat.id])
  const name = chatDisplayName(chat)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const bot = useBotsStore((s) => s.bots.find((b) => b.id === chat.bot_id))
  const pinnedCount = useBotsStore((s) => s.bots.filter((b) => b.pinned).length)
  const updateBot = useBotsStore((s) => s.updateBot)
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState('')
  useEffect(() => setPinError(''), [pinnedCount, bot?.pinned])

  return (
    <div className="chat-list-entry">
      <button
        aria-current={active ? 'page' : undefined}
        aria-label={name}
        aria-haspopup="menu"
        onContextMenu={(e) => {
          if (chat.type === 'dm' && !chat.bot_id) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onKeyDown={(e) => {
          if (
            (chat.type === 'group' || chat.bot_id) &&
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
          onSelect()
        }}
        className={`chat-list-item ${active ? 'is-active' : ''}`}
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
            <span className="chat-list-time shrink-0 text-[11px] text-stone-400">
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
      {bot && (
        <button
          className="icon-button chat-pin-button"
          aria-label={`${bot.pinned ? '取消置顶' : '置顶'} ${name}`}
          aria-pressed={!!bot.pinned}
          title={bot.pinned ? '取消置顶' : '置顶到顶部'}
          disabled={pinBusy}
          onClick={async () => {
            if (pinBusy) return
            setPinError('')
            if (!bot.pinned && pinnedCount >= 3) {
              setPinError('最多置顶 3 个 Bot，请先取消一个置顶')
              return
            }
            setPinBusy(true)
            try {
              await updateBot(bot.id, { pinned: !bot.pinned })
            } catch {
              setPinError('置顶未能保存，请重试')
            } finally {
              setPinBusy(false)
            }
          }}
        >
          {bot.pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
        </button>
      )}
      {pinError && <p role="alert" className="px-3 pb-2 text-[11px] text-red-500">{pinError}</p>}
      {menu && (chat.type === 'group' || chat.bot_id) && (
        <ChatContextMenu
          chat={chat}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function PlusMenu({ onClose, trigger }: { onClose: () => void; trigger: RefObject<HTMLButtonElement> }) {
  const setNewBotOpen = useUiStore((s) => s.setNewBotOpen)
  const setNewGroupOpen = useUiStore((s) => s.setNewGroupOpen)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose, trigger])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [])

  const item =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-700'
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="创建菜单"
      onKeyDown={(event) => {
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
        const current = items.indexOf(document.activeElement as HTMLButtonElement)
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          trigger.current?.focus()
        } else if (event.key === 'Tab') onClose()
      }}
      className="sidebar-create-menu absolute right-3 top-full z-40 w-48 animate-fadeIn rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg dark:border-stone-700 dark:bg-stone-800"
    >
      <button
        role="menuitem"
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
        role="menuitem"
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
  const botCount = useBotsStore((s) => s.bots.length)
  const selectChat = useChatsStore((s) => s.selectChat)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const setProfileOpen = useUiStore((s) => s.setProfileOpen)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [profile, setProfile] = useState<UserProfile>({
    avatar: '',
    name: '',
    role: '',
    bio: '',
    preferences: '',
    goals: '',
    boundaries: '',
    accept_mature_content: false,
  })

  useEffect(() => {
    let active = true
    const loadProfile = () =>
      void api
        .getUserProfile()
        .then((next) => {
          if (active) setProfile(next)
        })
        .catch(() => undefined)
    loadProfile()
    const off = api.onEvent((event) => {
      if (event.type === 'user-context-updated') loadProfile()
    })
    return () => {
      active = false
      off()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'k' &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault()
        setMenuOpen(false)
        setSearchOpen(true)
        searchRef.current?.focus()
        searchRef.current?.select()
      }
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }, [searchOpen])

  const closeSearch = () => {
    setQuery('')
    setSearchOpen(false)
  }

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
    <aside className="app-sidebar" aria-label="会话导航">
      {/* 顶部：标题 + 新建 */}
      <div
        className="sidebar-brand-row"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          onClick={() => void selectChat(null)}
          className="sidebar-brand"
          aria-label="Covan 首页"
        >
          <img className="brand-icon" src={appIcon} alt="" />
          Covan
        </button>
        <div className="sidebar-toolbar-actions">
          <button
            ref={searchButtonRef}
            className="icon-button sidebar-toolbar-button"
            aria-label="搜索"
            title="搜索会话 · ⌘K"
            aria-expanded={searchOpen}
            aria-controls="sidebar-search-panel"
            onClick={() => {
              setMenuOpen(false)
              if (searchOpen) closeSearch()
              else setSearchOpen(true)
            }}
          >
            <SearchIcon width={18} height={18} />
          </button>
          <button
            ref={createButtonRef}
            onClick={() => setMenuOpen((v) => !v)}
            className="icon-button sidebar-toolbar-button"
            aria-label="新建"
            title="新建 Bot 或群聊"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <PlusIcon width={20} height={20} />
          </button>
        </div>
        {menuOpen && <PlusMenu onClose={() => setMenuOpen(false)} trigger={createButtonRef} />}
      </div>

      {/* 搜索只在按钮或快捷键触发时展开。 */}
      {searchOpen && <div id="sidebar-search-panel" className="px-3 pb-2">
        <div className="sidebar-search">
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
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Escape') {
                e.stopPropagation()
                closeSearch()
                searchButtonRef.current?.focus()
              }
              if (e.key === 'Enter' && filteredChats[0]) {
                e.preventDefault()
                void selectChat(filteredChats[0].id)
                e.stopPropagation()
                closeSearch()
                searchButtonRef.current?.focus()
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
      </div>}

      {/* 置顶区：横排圆形头像 */}
      <PinnedBots />

      {/* 会话列表 */}
      <div className="sidebar-section-heading">
        <span>{query ? '搜索结果' : '最近对话'} <span className="sidebar-chat-count">{filteredChats.length}</span></span>
        <button className="sidebar-library-button" aria-label={`我的 Bot ${botCount}`} onClick={() => {
          closeSearch()
          void selectChat(null)
        }}><SparkIcon width={14} height={14} />我的 Bot</button>
      </div>
      <div className="sidebar-chats scroll-thin flex-1 space-y-1 overflow-y-auto px-3 py-1">
        {filteredChats.map((c) => (
          <ChatListItem key={c.id} chat={c} onSelect={closeSearch} />
        ))}
        {filteredChats.length === 0 && (
          <div className="px-4 py-10 text-center text-[12.5px] text-stone-400">
            {chats.length === 0
              ? '还没有会话，点击右上角 + 新建一个 Bot 吧'
              : '没有匹配的会话'}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="profile-row">
          <button className="profile-entry" aria-label="关于我" title="我的资料与共同记忆" onClick={() => setProfileOpen(true)}>
            <span className="profile-avatar"><Avatar name={profile.name || '我'} avatar={profile.avatar} size={42} /></span>
            <span className="profile-copy"><strong>{profile.name || '关于我'}</strong></span>
          </button>
          <button className="icon-button profile-settings" onClick={() => setSettingsOpen(true)} aria-label="设置" title="设置 · ⌘ ,"><GearIcon width={19} height={19} /></button>
        </div>
        <ThemeSwitcher compact />
      </div>
    </aside>
  )
}
