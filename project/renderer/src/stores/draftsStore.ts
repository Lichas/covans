import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Attachment } from '@shared/types'

interface Draft {
  attachments?: Attachment[]
  text: string
  mentionNames: Record<string, string>
}
interface DraftsState {
  drafts: Record<string, Draft>
  setDraft: (chatId: string, patch: Partial<Draft>) => void
  clearDraft: (chatId: string) => void
}

export const useDraftsStore = create<DraftsState>()(
  persist(
    (set, get) => ({
      drafts: {},
      setDraft: (chatId, patch) =>
        set({
          drafts: {
            ...get().drafts,
            [chatId]: {
              ...(get().drafts[chatId] ?? { text: '', mentionNames: {} }),
              ...patch,
            },
          },
        }),
      clearDraft: (chatId) => {
        const drafts = { ...get().drafts }
        delete drafts[chatId]
        set({ drafts })
      },
    }),
    { name: 'covan-chat-drafts', version: 1 },
  ),
)
