import { create } from 'zustand'
import type { CovanEvent, Message } from '@shared/types'
import { api } from '../lib/api'

interface MessagesState {
  messages: Record<string, Message[]>
  streaming: Record<string, Message>
  generating: Record<string, boolean>
  loadedChats: Record<string, boolean>
  loadingOlder: Record<string, boolean>
  hasOlder: Record<string, boolean>
  errors: Record<string, string>
  loadMessages: (chatId: string) => Promise<void>
  loadOlder: (chatId: string) => Promise<number>
  send: (chatId: string, content: string, mentions: string[]) => Promise<void>
  stop: (chatId: string) => Promise<void>
  retry: (chatId: string, failedMessage: Message) => Promise<void>
  handleEvent: (ev: CovanEvent) => void
}

function sorted(list: Message[]): Message[] {
  return [...list].sort((a, b) => a.created_at - b.created_at)
}
function merge(list: Message[], incoming: Message[]): Message[] {
  const map = new Map(list.map((m) => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return sorted([...map.values()])
}

const loads = new Map<string, Promise<void>>()
const reloads = new Set<string>()
export const useMessagesStore = create<MessagesState>((set, get) => ({
  messages: {},
  streaming: {},
  generating: {},
  loadedChats: {},
  loadingOlder: {},
  hasOlder: {},
  errors: {},
  loadMessages: (chatId) => {
    const pending = loads.get(chatId)
    if (pending) {
      reloads.add(chatId)
      return pending
    }
    const promise = (async () => {
      do {
        reloads.delete(chatId)
        try {
          const list = await api.listMessages(chatId)
          const current = get()
          const streaming = { ...current.streaming }
          const existing = current.messages[chatId] ?? []
          for (const m of list) {
            if (m.status === 'streaming') {
              if (
                !existing.some(
                  (old) => old.id === m.id && old.status !== 'streaming',
                )
              )
                streaming[m.id] = streaming[m.id] ?? m
            } else delete streaming[m.id]
          }
          set({
            streaming,
            generating: {
              ...current.generating,
              [chatId]:
                !!current.generating[chatId] ||
                Object.values(streaming).some((m) => m.chat_id === chatId),
            },
            messages: {
              ...current.messages,
              [chatId]: merge(
                existing.filter((m) => !m.id.startsWith('local-')),
                list.filter((m) => m.status !== 'streaming'),
              ),
            },
            loadedChats: { ...current.loadedChats, [chatId]: true },
            hasOlder: {
              ...current.hasOlder,
              [chatId]: current.hasOlder[chatId] ?? list.length >= 50,
            },
            errors: { ...current.errors, [chatId]: '' },
          })
        } catch (e) {
          set({ errors: { ...get().errors, [chatId]: String(e) } })
        }
      } while (reloads.has(chatId))
    })().finally(() => loads.delete(chatId))
    loads.set(chatId, promise)
    return promise
  },
  loadOlder: async (chatId) => {
    const current = get()
    if (current.loadingOlder[chatId] || current.hasOlder[chatId] === false)
      return 0
    const list = current.messages[chatId] ?? []
    if (!list.length) return 0
    set({ loadingOlder: { ...current.loadingOlder, [chatId]: true } })
    try {
      const older = await api.listMessages(chatId, list[0].created_at, 50)
      set({
        messages: {
          ...get().messages,
          [chatId]: merge(
            get().messages[chatId] ?? [],
            older.filter((m) => m.status !== 'streaming'),
          ),
        },
        hasOlder: { ...get().hasOlder, [chatId]: older.length >= 50 },
        errors: { ...get().errors, [chatId]: '' },
      })
      return older.length
    } catch (e) {
      set({ errors: { ...get().errors, [chatId]: String(e) } })
      return 0
    } finally {
      set({ loadingOlder: { ...get().loadingOlder, [chatId]: false } })
    }
  },
  send: async (chatId, content, mentions) => {
    const text = content.trim()
    if (!text || get().generating[chatId]) return
    set({ generating: { ...get().generating, [chatId]: true } })
    const optimistic: Message = {
      id: `local-${crypto.randomUUID()}`,
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
    set({
      messages: {
        ...get().messages,
        [chatId]: merge(get().messages[chatId] ?? [], [optimistic]),
      },
    })
    try {
      await api.sendUserMessage(chatId, text, mentions)
      await get().loadMessages(chatId)
    } catch (e) {
      set({
        messages: {
          ...get().messages,
          [chatId]: merge(get().messages[chatId] ?? [], [
            { ...optimistic, status: 'error', error: String(e) },
          ]),
        },
        generating: { ...get().generating, [chatId]: false },
      })
    }
  },
  stop: async (chatId) => {
    try {
      await api.stopChat(chatId)
    } catch (e) {
      set({ errors: { ...get().errors, [chatId]: String(e) } })
    }
  },
  retry: async (chatId, failedMessage) => {
    if (get().generating[chatId]) return
    if (failedMessage.sender_type === 'user') {
      set({
        messages: {
          ...get().messages,
          [chatId]: (get().messages[chatId] ?? []).filter(
            (m) => m.id !== failedMessage.id,
          ),
        },
      })
      await get().send(chatId, failedMessage.content, failedMessage.mentions)
      return
    }
    const list = get().messages[chatId] ?? []
    const idx = list.findIndex((m) => m.id === failedMessage.id)
    const lastUser = [...(idx >= 0 ? list.slice(0, idx) : list)]
      .reverse()
      .find((m) => m.sender_type === 'user' && m.status !== 'error')
    if (lastUser) await get().send(chatId, lastUser.content, lastUser.mentions)
  },
  handleEvent: (ev) => {
    const s = get()
    switch (ev.type) {
      case 'generation-state':
        set({ generating: { ...s.generating, [ev.chatId]: ev.generating } })
        break
      case 'message-start':
        set({
          streaming: { ...s.streaming, [ev.message.id]: ev.message },
          generating: { ...s.generating, [ev.chatId]: true },
        })
        break
      case 'message-delta': {
        const previous = s.streaming[ev.messageId]
        if (previous)
          set({
            streaming: {
              ...s.streaming,
              [ev.messageId]: {
                ...previous,
                content: previous.content + ev.delta,
              },
            },
          })
        break
      }
      case 'message-done': {
        const streaming = { ...s.streaming }
        delete streaming[ev.message.id]
        set({
          streaming,
          messages: {
            ...s.messages,
            [ev.chatId]: merge(s.messages[ev.chatId] ?? [], [ev.message]),
          },
        })
        break
      }
      case 'message-error':
        void get().loadMessages(ev.chatId)
        break
      case 'system-message':
        set({
          messages: {
            ...s.messages,
            [ev.chatId]: merge(s.messages[ev.chatId] ?? [], [ev.message]),
          },
        })
        break
    }
  },
}))
