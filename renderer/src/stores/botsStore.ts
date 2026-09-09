// stores/botsStore.ts — Bot 列表
import { create } from 'zustand'
import type { Bot, BotInput } from '@shared/types'
import { api } from '../lib/api'

interface BotsState {
  bots: Bot[]
  loadBots: () => Promise<void>
  refreshBot: (id: string) => Promise<void>
  createBot: (input: BotInput) => Promise<Bot>
  updateBot: (id: string, patch: Partial<BotInput>) => Promise<Bot>
  deleteBot: (id: string) => Promise<void>
}

export const useBotsStore = create<BotsState>((set, get) => ({
  bots: [],

  loadBots: async () => {
    try {
      set({ bots: await api.listBots() })
    } catch {
      /* 主进程未就绪时静默 */
    }
  },

  refreshBot: async (id) => {
    // 无单查接口，整体刷新
    await get().loadBots()
    void id
  },

  createBot: async (input) => {
    const bot = await api.createBot(input)
    await get().loadBots()
    return bot
  },

  updateBot: async (id, patch) => {
    const bot = await api.updateBot(id, patch)
    set({ bots: get().bots.map((b) => (b.id === id ? bot : b)) })
    return bot
  },

  deleteBot: async (id) => {
    await api.deleteBot(id)
    set({ bots: get().bots.filter((b) => b.id !== id) })
  },
}))

export function useBotMap(): Map<string, Bot> {
  const bots = useBotsStore((s) => s.bots)
  const map = new Map<string, Bot>()
  for (const b of bots) map.set(b.id, b)
  return map
}
