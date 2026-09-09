// stores/settingsStore.ts — 应用设置与 Provider 管理
import { create } from 'zustand'
import type { Provider, ProviderInput, TestProviderResult } from '@shared/types'
import { api } from '../lib/api'

export type ThemeMode = 'system' | 'light' | 'dark'

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && !!media?.matches)
  document.documentElement.classList.toggle('dark', dark)
}

interface SettingsState {
  theme: ThemeMode
  settings: Record<string, string>
  providers: Provider[]
  loaded: boolean
  init: () => Promise<void>
  setTheme: (t: ThemeMode) => Promise<void>
  getSettingValue: (key: string, fallback?: string) => string
  setSettingValue: (key: string, value: string) => Promise<void>
  loadProviders: () => Promise<void>
  saveProvider: (p: ProviderInput) => Promise<Provider>
  deleteProvider: (id: string) => Promise<void>
  listProviderModels: (id: string) => Promise<string[]>
  testProvider: (id: string) => Promise<TestProviderResult>
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  // 跟随系统：监听系统主题变化
  media?.addEventListener('change', () => {
    if (get().theme === 'system') applyTheme('system')
  })

  return {
    theme: 'system',
    settings: {},
    providers: [],
    loaded: false,

    init: async () => {
      try {
        const get = (k: string) => api.getSetting(k).catch(() => '')
        const [rawTheme, autoReview, reviewRules] = await Promise.all([
          get('theme'),
          get('auto_review'),
          get('review_rules'),
        ])
        const theme = rawTheme === 'light' || rawTheme === 'dark' ? rawTheme : 'system'
        set({
          theme,
          loaded: true,
          settings: { theme, auto_review: autoReview, review_rules: reviewRules },
        })
        applyTheme(theme)
      } catch {
        set({ loaded: true })
        applyTheme('system')
      }
      await get().loadProviders()
    },

    setTheme: async (t) => {
      set({ theme: t, settings: { ...get().settings, theme: t } })
      applyTheme(t)
      await api.setSetting('theme', t)
    },

    getSettingValue: (key, fallback = '') => get().settings[key] ?? fallback,

    setSettingValue: async (key, value) => {
      set({ settings: { ...get().settings, [key]: value } })
      await api.setSetting(key, value)
    },

    loadProviders: async () => {
      try {
        set({ providers: await api.listProviders() })
      } catch {
        /* 主进程未就绪时静默 */
      }
    },

    saveProvider: async (p) => {
      const saved = await api.saveProvider(p)
      await get().loadProviders()
      return saved
    },

    deleteProvider: async (id) => {
      await api.deleteProvider(id)
      await get().loadProviders()
    },

    listProviderModels: (id) => api.listProviderModels(id),

    testProvider: (id) => api.testProvider(id),
  }
})
