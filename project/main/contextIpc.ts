import { ipcMain } from 'electron'
import { CH } from '../shared/ipcChannels'
import type { MemoryKind, UserProfile } from '../shared/types'
import * as db from './db'
import { expandAvatarPrompt } from './avatars'
import {
  beginAgentConversation,
  stopAgentConversation,
} from './privateConversations'

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(label + '不能为空')
}

export function registerContextIpc(): void {
  ipcMain.handle(CH.getUserProfile, () => db.getUserProfile())
  ipcMain.handle(CH.saveUserProfile, (_e, profile: UserProfile) => {
    if (!profile || typeof profile !== 'object')
      throw new Error('用户资料格式错误')
    return db.saveUserProfile(profile)
  })
  ipcMain.handle(CH.listUserMemories, () => db.listUserMemories())
  ipcMain.handle(
    CH.saveUserMemory,
    (_e, content: string, kind?: MemoryKind, id?: string) => {
      text(content, '记忆')
      if (id !== undefined) text(id, '记忆 ID')
      return db.saveUserMemory(content, kind, 'manual', null, id)
    },
  )
  ipcMain.handle(CH.deleteUserMemory, (_e, id: string) => {
    text(id, '记忆 ID')
    db.deleteUserMemory(id)
  })
  ipcMain.handle(CH.listAgentThreads, (_e, chatId: string) => {
    text(chatId, '会话 ID')
    return db.listAgentThreads(chatId)
  })
  ipcMain.handle(CH.getAgentThread, (_e, id: string) => {
    text(id, '私聊 ID')
    return db.getAgentThread(id)
  })
  ipcMain.handle(
    CH.startAgentConversation,
    (_e, chatId: string, from: string, to: string, message: string) => {
      for (const value of [chatId, from, to, message]) text(value, '私聊参数')
      const { thread, finished } = beginAgentConversation(
        chatId,
        from,
        to,
        message,
      )
      void finished.catch(() => undefined)
      return thread.id
    },
  )
  ipcMain.handle(CH.stopAgentConversation, (_e, id: string) => {
    text(id, '私聊 ID')
    stopAgentConversation(id)
  })
  ipcMain.handle(
    CH.expandAvatarPrompt,
    (_e, botId: string, direction?: string) => {
      text(botId, 'Bot ID')
      if (
        direction !== undefined &&
        (typeof direction !== 'string' || direction.length > 2000)
      )
        throw new Error('头像要求不超过2000字')
      return expandAvatarPrompt(botId, direction)
    },
  )
}
