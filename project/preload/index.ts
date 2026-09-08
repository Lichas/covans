// preload/index.ts — contextBridge 暴露 window.covan（SPEC §4）
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH } from '../shared/ipcChannels'
import type { BotInput, CovanApi, CovanEvent, MemoryKind, ProviderInput } from '../shared/types'

const api: CovanApi = {
  // providers
  listProviders: () => ipcRenderer.invoke(CH.listProviders),
  saveProvider: (p: ProviderInput) => ipcRenderer.invoke(CH.saveProvider, p),
  deleteProvider: (id: string) => ipcRenderer.invoke(CH.deleteProvider, id),
  listProviderModels: (id: string) => ipcRenderer.invoke(CH.listProviderModels, id),
  testProvider: (id: string) => ipcRenderer.invoke(CH.testProvider, id),

  // bots
  listBots: () => ipcRenderer.invoke(CH.listBots),
  createBot: (input: BotInput) => ipcRenderer.invoke(CH.createBot, input),
  updateBot: (id: string, patch: Partial<BotInput>) => ipcRenderer.invoke(CH.updateBot, id, patch),
  deleteBot: (id: string) => ipcRenderer.invoke(CH.deleteBot, id),
  pickAvatar: (botId: string) => ipcRenderer.invoke(CH.pickAvatar, botId),
  generateAvatar: (botId: string, prompt: string) => ipcRenderer.invoke(CH.generateAvatar, botId, prompt),

  // chats
  listChats: () => ipcRenderer.invoke(CH.listChats),
  createDm: (botId: string) => ipcRenderer.invoke(CH.createDm, botId),
  createGroup: (name: string, memberBotIds: string[], coordinatorBotId?: string) =>
    ipcRenderer.invoke(CH.createGroup, name, memberBotIds, coordinatorBotId),
  updateChat: (id: string, patch: { name?: string; coordinatorBotId?: string | null }) =>
    ipcRenderer.invoke(CH.updateChat, id, patch),
  deleteChat: (id: string) => ipcRenderer.invoke(CH.deleteChat, id),
  markRead: (chatId: string) => ipcRenderer.invoke(CH.markRead, chatId),

  // messages
  listMessages: (chatId: string, before?: number, limit?: number) =>
    ipcRenderer.invoke(CH.listMessages, chatId, before, limit),
  sendUserMessage: (chatId: string, content: string, mentions: string[]) =>
    ipcRenderer.invoke(CH.sendUserMessage, chatId, content, mentions),
  stopChat: (chatId: string) => ipcRenderer.invoke(CH.stopChat, chatId),

  // memory
  listMemories: (botId: string) => ipcRenderer.invoke(CH.listMemories, botId),
  addMemory: (botId: string, content: string, kind?: MemoryKind) =>
    ipcRenderer.invoke(CH.addMemory, botId, content, kind),
  deleteMemory: (id: string) => ipcRenderer.invoke(CH.deleteMemory, id),

  // workspace
  listWorkspaceFiles: (botId: string) => ipcRenderer.invoke(CH.listWorkspaceFiles, botId),
  openWorkspace: (botId: string) => ipcRenderer.invoke(CH.openWorkspace, botId),
  readWorkspaceFile: (botId: string, relPath: string) =>
    ipcRenderer.invoke(CH.readWorkspaceFile, botId, relPath),

  // settings
  getSetting: (key: string) => ipcRenderer.invoke(CH.getSetting, key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke(CH.setSetting, key, value),

  // 事件订阅（返回取消订阅函数）
  onEvent: (cb: (ev: CovanEvent) => void) => {
    const listener = (_e: IpcRendererEvent, ev: CovanEvent) => cb(ev)
    ipcRenderer.on(CH.event, listener)
    return () => {
      ipcRenderer.removeListener(CH.event, listener)
    }
  },
}

contextBridge.exposeInMainWorld('covan', api)
