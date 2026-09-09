// stores/uiStore.ts — 纯 UI 状态（面板开合、弹窗）
import { create } from 'zustand'

interface UiState {
  rightPanelOpen: boolean
  /** 群聊中当前查看的成员 botId（单聊时为空，直接用会话 bot） */
  inspectedBotId: string | null
  settingsOpen: boolean
  profileOpen: boolean
  setProfileOpen: (v: boolean) => void
  newBotOpen: boolean
  newGroupOpen: boolean
  toggleRightPanel: () => void
  setRightPanelOpen: (v: boolean) => void
  inspectBot: (botId: string | null) => void
  setSettingsOpen: (v: boolean) => void
  setNewBotOpen: (v: boolean) => void
  setNewGroupOpen: (v: boolean) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  rightPanelOpen: false,
  inspectedBotId: null,
  settingsOpen: false,
  profileOpen: false,
  setProfileOpen: (v) => set({ profileOpen: v }),
  newBotOpen: false,
  newGroupOpen: false,
  toggleRightPanel: () => set({ rightPanelOpen: !get().rightPanelOpen }),
  setRightPanelOpen: (v) => set({ rightPanelOpen: v }),
  inspectBot: (botId) => {
    set({ inspectedBotId: botId })
    if (botId) set({ rightPanelOpen: true })
  },
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setNewBotOpen: (v) => set({ newBotOpen: v }),
  setNewGroupOpen: (v) => set({ newGroupOpen: v }),
}))
