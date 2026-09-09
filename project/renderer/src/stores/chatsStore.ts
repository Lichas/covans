// stores/chatsStore.ts — 会话列表与当前选中会话
import { create } from 'zustand'
import type { Chat, ChatSummary } from '@shared/types'
import { api } from '../lib/api'
import { useMessagesStore } from './messagesStore'
import { useDraftsStore } from './draftsStore'

let restored = false

interface ChatsState {
  chats: ChatSummary[]
  activeChatId: string | null
  loadChats: () => Promise<void>
  selectChat: (id: string | null) => Promise<void>
  createDm: (botId: string) => Promise<Chat>
  createGroup: (
    name: string,
    memberBotIds: string[],
    coordinatorBotId?: string,
  ) => Promise<Chat>
  updateChat: (
    id: string,
    patch: { name?: string; coordinatorBotId?: string | null },
  ) => Promise<void>
  addChatMembers: (id: string, botIds: string[]) => Promise<void>
  hideChat: (id: string) => Promise<void>
  clearChatMessages: (id: string) => Promise<void>
  deleteChat: (id: string) => Promise<void>
}

export const useChatsStore = create<ChatsState>((set, get) => ({
  chats: [],
  activeChatId: null,

  loadChats: async () => {
    try {
      const chats = await api.listChats()
      const active = get().activeChatId
      if (active && chats.some((c) => c.id === active && c.unread > 0))
        void api.markRead(active).catch(() => undefined)
      set({
        chats: chats.map((c) => (c.id === active ? { ...c, unread: 0 } : c)),
      })
      if (!restored) {
        restored = true
        const last = localStorage.getItem('covan-active-chat')
        if (last && chats.some((c) => c.id === last))
          await get().selectChat(last)
      }
    } catch {
      /* 主进程未就绪时静默 */
    }
  },

  selectChat: async (id) => {
    set({ activeChatId: id })
    if (id) localStorage.setItem('covan-active-chat', id)
    else localStorage.removeItem('covan-active-chat')
    if (!id) return
    // 乐观清除未读
    set({
      chats: get().chats.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
    })
    void api.markRead(id).catch(() => undefined)
    await useMessagesStore.getState().loadMessages(id)
  },

  createDm: async (botId) => {
    const chat = await api.createDm(botId)
    await get().loadChats()
    await get().selectChat(chat.id)
    return chat
  },

  createGroup: async (name, memberBotIds, coordinatorBotId) => {
    const chat = await api.createGroup(name, memberBotIds, coordinatorBotId)
    await get().loadChats()
    await get().selectChat(chat.id)
    return chat
  },

  updateChat: async (id, patch) => {
    await api.updateChat(id, patch)
    await get().loadChats()
  },

  addChatMembers: async (id, botIds) => {
    await api.addChatMembers(id, botIds)
    await get().loadChats()
  },

  hideChat: async (id) => {
    await api.hideChat(id)
    if (get().activeChatId === id) await get().selectChat(null)
    useDraftsStore.getState().clearDraft(id)
    await get().loadChats()
  },

  clearChatMessages: async (id) => {
    await api.clearChatMessages(id)
    useDraftsStore.getState().clearDraft(id)
    useMessagesStore.setState((state) => ({
      messages: { ...state.messages, [id]: [] },
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(
          ([, message]) => message.chat_id !== id,
        ),
      ),
      generating: { ...state.generating, [id]: false },
      hasOlder: { ...state.hasOlder, [id]: false },
    }))
    await get().loadChats()
  },

  deleteChat: async (id) => {
    await api.deleteChat(id)
    const wasActive = get().activeChatId === id
    if (wasActive) {
      set({ activeChatId: null })
      localStorage.removeItem('covan-active-chat')
    }
    useDraftsStore.getState().clearDraft(id)
    await get().loadChats()
  },
}))

export function useActiveChat(): ChatSummary | null {
  const { chats, activeChatId } = useChatsStore()
  return chats.find((c) => c.id === activeChatId) ?? null
}
