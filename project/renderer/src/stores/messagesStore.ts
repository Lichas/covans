// stores/messagesStore.ts — 消息、流式状态与发送
import { create } from 'zustand'
import type { CovanEvent, Message } from '@shared/types'
import { api } from '../lib/api'

interface StreamingMsg {
  chatId: string
  content: string
}

interface MessagesState {
  /** chatId -> 已定稿消息（含历史，升序） */
  messages: Record<string, Message[]>
  /** messageId -> 进行中的流式消息 */
  streaming: Record<string, StreamingMsg>
  /** 正在生成中的会话 */
  generating: Record<string, boolean>
  loadedChats: Record<string, boolean>

  loadMessages: (chatId: string) => Promise<void>
  loadOlder: (chatId: string) => Promise<void>
  send: (chatId: string, content: string, mentions: string[]) => Promise<void>
  stop: (chatId: string) => Promise<void>
  retry: (chatId: string, failedMessage: Message) => Promise<void>
  handleEvent: (ev: CovanEvent) => void
}

function sortMessages(list: Message[]): Message[] {
  return [...list].sort((a, b) => a.created_at - b.created_at)
}

function upsert(list: Message[], msg: Message): Message[] {
  const idx = list.findIndex((m) => m.id === msg.id)
  if (idx >= 0) {
    const next = [...list]
    next[idx] = msg
    return sortMessages(next)
  }
  return sortMessages([...list, msg])
}

export const useMessagesStore = create<MessagesState>((set, get) => {
  /** message-done 后延迟清除生成标记：群聊里多个 bot 串行发言，避免停止按钮闪烁 */
  const genTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const clearGenerating = (chatId: string) => {
    const t = genTimers.get(chatId)
    if (t) clearTimeout(t)
    genTimers.set(
      chatId,
      setTimeout(() => {
        genTimers.delete(chatId)
        set({ generating: { ...get().generating, [chatId]: false } })
      }, 600),
    )
  }
  const markGenerating = (chatId: string) => {
    const t = genTimers.get(chatId)
    if (t) {
      clearTimeout(t)
      genTimers.delete(chatId)
    }
    if (!get().generating[chatId]) set({ generating: { ...get().generating, [chatId]: true } })
  }

  return {
    messages: {},
    streaming: {},
    generating: {},
    loadedChats: {},

    loadMessages: async (chatId) => {
      try {
        const list = await api.listMessages(chatId)
        set({
          messages: { ...get().messages, [chatId]: sortMessages(list) },
          loadedChats: { ...get().loadedChats, [chatId]: true },
        })
      } catch {
        /* 静默 */
      }
    },

    loadOlder: async (chatId) => {
      const current = get().messages[chatId] ?? []
      if (current.length === 0) return
      const before = current[0].created_at
      try {
        const older = await api.listMessages(chatId, before, 50)
        if (older.length === 0) return
        const ids = new Set(current.map((m) => m.id))
        const merged = [...older.filter((m) => !ids.has(m.id)), ...current]
        set({ messages: { ...get().messages, [chatId]: sortMessages(merged) } })
      } catch {
        /* 静默 */
      }
    },

    send: async (chatId, content, mentions) => {
      const text = content.trim()
      if (!text) return
      markGenerating(chatId)
      // 乐观插入用户消息（主进程落库后通过 chat-updated / loadMessages 对齐）
      const optimistic: Message = {
        id: `local-${Date.now()}`,
        chat_id: chatId,
        sender_type: 'user',
        sender_bot_id: null,
        content: text,
        attachments: [],
        mentions,
        status: 'done',
        error: '',
        created_at: Date.now(),
      }
      const list = get().messages[chatId] ?? []
      set({ messages: { ...get().messages, [chatId]: upsert(list, optimistic) } })
      try {
        await api.sendUserMessage(chatId, text, mentions)
        // 用户消息已在主进程落库，重新拉取以替换乐观消息
        await get().loadMessages(chatId)
      } catch (e) {
        set({
          messages: {
            ...get().messages,
            [chatId]: (get().messages[chatId] ?? []).map((m) =>
              m.id === optimistic.id ? { ...m, status: 'error', error: String(e) } : m,
            ),
          },
        })
        clearGenerating(chatId)
      }
    },

    stop: async (chatId) => {
      try {
        await api.stopChat(chatId)
      } catch {
        /* 静默 */
      }
      clearGenerating(chatId)
    },

    retry: async (chatId, failedMessage) => {
      // 没有单独的重发 IPC：找到失败 bot 消息之前最近一条用户消息并重新发送
      const list = get().messages[chatId] ?? []
      const idx = list.findIndex((m) => m.id === failedMessage.id)
      const before = idx >= 0 ? list.slice(0, idx) : list
      const lastUser = [...before].reverse().find((m) => m.sender_type === 'user' && m.status !== 'error')
      const content = lastUser?.content ?? failedMessage.content
      const mentions = lastUser?.mentions ?? []
      if (content) await get().send(chatId, content, mentions)
    },

    handleEvent: (ev) => {
      const s = get()
      switch (ev.type) {
        case 'message-delta': {
          markGenerating(ev.chatId)
          const prev = s.streaming[ev.messageId]
          set({
            streaming: {
              ...s.streaming,
              [ev.messageId]: { chatId: ev.chatId, content: (prev?.content ?? '') + ev.delta },
            },
          })
          break
        }
        case 'message-done': {
          const streaming = { ...s.streaming }
          delete streaming[ev.message.id]
          const list = s.messages[ev.chatId] ?? []
          set({
            streaming,
            messages: { ...s.messages, [ev.chatId]: upsert(list, ev.message) },
          })
          clearGenerating(ev.chatId)
          break
        }
        case 'message-error': {
          const stream = s.streaming[ev.messageId]
          const streaming = { ...s.streaming }
          delete streaming[ev.messageId]
          set({ streaming })
          // 把进行中的流式消息定稿为错误气泡
          if (stream) {
            const errMsg: Message = {
              id: ev.messageId,
              chat_id: ev.chatId,
              sender_type: 'bot',
              sender_bot_id: null,
              content: stream.content,
              attachments: [],
              mentions: [],
              status: 'error',
              error: ev.error,
              created_at: Date.now(),
            }
            const list = get().messages[ev.chatId] ?? []
            set({ messages: { ...get().messages, [ev.chatId]: upsert(list, errMsg) } })
          } else {
            // 错误消息可能已由主进程落库，刷新列表
            void get().loadMessages(ev.chatId)
          }
          clearGenerating(ev.chatId)
          break
        }
        case 'system-message': {
          const list = s.messages[ev.chatId] ?? []
          set({ messages: { ...s.messages, [ev.chatId]: upsert(list, ev.message) } })
          break
        }
        case 'chat-updated':
        case 'bot-updated':
          break
      }
    },
  }
})
