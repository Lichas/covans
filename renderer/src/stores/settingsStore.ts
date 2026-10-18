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

/** 窗口透明度：只有 macOS 的原生材质可以调，低层 CSS 通过 data-glass 选择。 */
export type WindowTransparency = 'standard' | 'clear' | 'ultra'

export function applyWindowTransparency(level: string) {
  document.documentElement.dataset.glass =
    level === 'clear' || level === 'ultra' ? level : 'standard'
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
  openObservabilityLogs: () => Promise<void>
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
    theme: 'light',
    settings: {},
    providers: [],
    loaded: false,

    init: async () => {
      try {
        const get = (k: string) => api.getSetting(k).catch(() => '')
        const [
          rawTheme,
          autoReview,
          reviewRules,
          naturalFollowUp,
          localObservability,
          rawGlass,
        ] = await Promise.all([
          get('theme'),
          get('auto_review'),
          get('review_rules'),
          get('natural_follow_up'),
          get('local_observability'),
          get('window_transparency'),
        ])
        const theme = rawTheme === 'dark' || rawTheme === 'system' ? rawTheme : 'light'
        set({
          theme,
          loaded: true,
          settings: {
            theme,
            auto_review: autoReview,
            review_rules: reviewRules,
            natural_follow_up: naturalFollowUp,
            local_observability: localObservability,
            window_transparency: rawGlass || 'standard',
          },
        })
        applyTheme(theme)
        applyWindowTransparency(rawGlass || 'standard')
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
      if (key === 'window_transparency') applyWindowTransparency(value)
      await api.setSetting(key, value)
    },

    openObservabilityLogs: () => api.openObservabilityLogs(),

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
