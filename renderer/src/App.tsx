// App.tsx — 三栏布局装配 + 启动加载 + 事件订阅 + 全局快捷键
import { useEffect } from 'react'
import { BotSettingsPanel } from './components/BotSettingsPanel'
import { ChatView } from './components/ChatView'
import { NewBotDialog } from './components/NewBotDialog'
import { NewGroupDialog } from './components/NewGroupDialog'
import { InviteBotsDialog } from './components/InviteBotsDialog'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { useBotsStore } from './stores/botsStore'
import { useChatsStore } from './stores/chatsStore'
import { useMessagesStore } from './stores/messagesStore'
import { useSettingsStore } from './stores/settingsStore'
import { useUiStore } from './stores/uiStore'
import { api } from './lib/api'
import { UserProfileDialog } from './components/UserProfileDialog'

export default function App() {
  const setNewBotOpen = useUiStore((s) => s.setNewBotOpen)
  const setNewGroupOpen = useUiStore((s) => s.setNewGroupOpen)

  // 启动：设置 + bots + chats
  useEffect(() => {
    void useSettingsStore.getState().init()
    void useBotsStore.getState().loadBots()
    void useChatsStore.getState().loadChats()
  }, [])

  // 主进程事件订阅（SPEC §4）
  useEffect(() => {
    const off = api.onEvent((ev) => {
      useMessagesStore.getState().handleEvent(ev)
      switch (ev.type) {
        case 'chat-updated': {
          void useChatsStore.getState().loadChats()
          // 当前会话的已落库消息（如用户消息回写）同步刷新
          const { activeChatId } = useChatsStore.getState()
          if (activeChatId === ev.chatId)
            void useMessagesStore.getState().loadMessages(ev.chatId)
          break
        }
        case 'message-done':
        case 'system-message': {
          // 会话预览/排序变化
          void useChatsStore.getState().loadChats()
          break
        }
        case 'bot-updated': {
          void useBotsStore.getState().refreshBot(ev.botId)
          void useChatsStore.getState().loadChats()
          break
        }
        default:
          break
      }
    })
    return off
  }, [])

  // 全局快捷键：⌘1 新建 Bot / ⌘2 创建群聊（也兼容 Ctrl）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === '1') {
        e.preventDefault()
        setNewBotOpen(true)
      } else if (e.key === '2') {
        e.preventDefault()
        setNewGroupOpen(true)
      } else if (e.key === ',') {
        e.preventDefault()
        useUiStore.getState().setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setNewBotOpen, setNewGroupOpen])

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar />
      <ChatView />
      <BotSettingsPanel />
      <SettingsModal />
      <NewBotDialog />
      <NewGroupDialog />
      <InviteBotsDialog />
      <UserProfileDialog />
    </div>
  )
}
