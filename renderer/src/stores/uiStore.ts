// stores/uiStore.ts — 纯 UI 状态（面板开合、弹窗）
import { create } from 'zustand'
import type { WorkspaceArtifact } from '@shared/types'

export interface ArtifactPreviewTarget {
  botId: string
  artifact: WorkspaceArtifact
}

interface UiState {
  rightPanelOpen: boolean
  artifactPreview: ArtifactPreviewTarget | null
  artifactPreviewWidth: number
  /** 群聊中当前查看的成员 botId（单聊时为空，直接用会话 bot） */
  inspectedBotId: string | null
  settingsOpen: boolean
  profileOpen: boolean
  setProfileOpen: (v: boolean) => void
  newBotOpen: boolean
  newGroupOpen: boolean
  inviteChatId: string | null
  toggleRightPanel: () => void
  setRightPanelOpen: (v: boolean) => void
  setArtifactPreview: (target: ArtifactPreviewTarget | null) => void
  setArtifactPreviewWidth: (width: number) => void
  inspectBot: (botId: string | null) => void
  setSettingsOpen: (v: boolean) => void
  setNewBotOpen: (v: boolean) => void
  setNewGroupOpen: (v: boolean) => void
  setInviteChatId: (id: string | null) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  rightPanelOpen: false,
  artifactPreview: null,
  artifactPreviewWidth: 520,
  inspectedBotId: null,
  settingsOpen: false,
  profileOpen: false,
  setProfileOpen: (v) => set({ profileOpen: v }),
  newBotOpen: false,
  newGroupOpen: false,
  inviteChatId: null,
  toggleRightPanel: () => {
    const open = !get().rightPanelOpen
    set({ rightPanelOpen: open, artifactPreview: open ? null : get().artifactPreview })
  },
  setRightPanelOpen: (v) =>
    set({ rightPanelOpen: v, artifactPreview: v ? null : get().artifactPreview }),
  setArtifactPreview: (target) =>
    set({ artifactPreview: target, rightPanelOpen: target ? false : get().rightPanelOpen }),
  setArtifactPreviewWidth: (width) => set({ artifactPreviewWidth: width }),
  inspectBot: (botId) => {
    set({ inspectedBotId: botId, artifactPreview: null })
    if (botId) set({ rightPanelOpen: true })
  },
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setNewBotOpen: (v) => set({ newBotOpen: v }),
  setNewGroupOpen: (v) => set({ newGroupOpen: v }),
  setInviteChatId: (id) => set({ inviteChatId: id }),
}))
