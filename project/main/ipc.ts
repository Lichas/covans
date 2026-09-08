// main/ipc.ts — 注册 SPEC §4 全部 ipcMain.handle 通道（白名单）
import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  BotInput,
  MemoryKind,
  ProviderInput,
} from '../shared/types'
import { CH } from '../shared/ipcChannels'
import * as db from './db'
import { abortChat, listProviderModels, testProviderConnection } from './agentRuntime'
import { sendUserMessage } from './orchestrator'
import { ensureWorkspace, listWorkspaceFiles, readWorkspaceFile } from './workspace'

// ---------- 参数校验 ----------

function assertStr(v: unknown, name: string, allowEmpty = false): asserts v is string {
  if (typeof v !== 'string' || (!allowEmpty && v.trim() === '')) {
    throw new Error(`参数 ${name} 必须是非空字符串`)
  }
}

function assertStrArray(v: unknown, name: string): asserts v is string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new Error(`参数 ${name} 必须是字符串数组`)
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? new Error(e.message) : new Error(String(e))
}

/** 统一包装：业务错误以 Error(message) 抛回渲染进程 */
function handle<TArgs extends unknown[], TRet>(
  channel: string,
  fn: (...args: TArgs) => TRet | Promise<TRet>,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await fn(...(args as TArgs))
    } catch (e) {
      throw toError(e)
    }
  })
}

// ---------- 注册 ----------

export function registerIpc(): void {
  // providers
  handle(CH.listProviders, () => db.listProviders())
  handle(CH.saveProvider, (p: ProviderInput) => {
    if (!p || typeof p !== 'object') throw new Error('参数必须是 ProviderInput 对象')
    assertStr(p.name, 'name')
    assertStr(p.kind, 'kind')
    return db.saveProvider(p)
  })
  handle(CH.deleteProvider, (id: string) => {
    assertStr(id, 'id')
    db.deleteProvider(id)
  })
  handle(CH.listProviderModels, async (id: string) => {
    assertStr(id, 'id')
    const provider = db.getProvider(id)
    if (!provider) throw new Error('Provider 不存在')
    return listProviderModels(provider)
  })
  handle(CH.testProvider, async (id: string) => {
    assertStr(id, 'id')
    const provider = db.getProvider(id)
    if (!provider) throw new Error('Provider 不存在')
    return testProviderConnection(provider)
  })

  // bots
  handle(CH.listBots, () => db.listBots())
  handle(CH.createBot, (input: BotInput) => {
    if (!input || typeof input !== 'object') throw new Error('参数必须是 BotInput 对象')
    assertStr(input.name, 'name')
    const bot = db.createBot(input)
    ensureWorkspace(bot.id)
    return bot
  })
  handle(CH.updateBot, (id: string, patch: Partial<BotInput>) => {
    assertStr(id, 'id')
    if (!patch || typeof patch !== 'object') throw new Error('参数 patch 必须是对象')
    return db.updateBot(id, patch)
  })
  handle(CH.deleteBot, (id: string) => {
    assertStr(id, 'id')
    db.deleteBot(id)
  })
  handle(CH.pickAvatar, async (botId: string) => {
    assertStr(botId, 'botId')
    const bot = db.getBot(botId)
    if (!bot) throw new Error('Bot 不存在')
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win!, {
      title: '选择头像',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return ''
    const src = result.filePaths[0]
    const avatarsDir = path.join(app.getPath('userData'), 'avatars')
    fs.mkdirSync(avatarsDir, { recursive: true })
    const ext = path.extname(src) || '.png'
    const rel = path.join('avatars', `${botId}${ext}`)
    fs.copyFileSync(src, path.join(app.getPath('userData'), rel))
    db.updateBot(botId, { avatar: rel.split(path.sep).join('/') })
    return rel.split(path.sep).join('/')
  })
  handle(CH.generateAvatar, async (botId: string, _prompt: string) => {
    assertStr(botId, 'botId')
    // 可选实现：当前版本不调用图像生成能力，按约定失败返回 ''
    return ''
  })

  // chats
  handle(CH.listChats, () => db.listChats())
  handle(CH.createDm, (botId: string) => {
    assertStr(botId, 'botId')
    if (!db.getBot(botId)) throw new Error('Bot 不存在')
    return db.createDm(botId)
  })
  handle(CH.createGroup, (name: string, memberBotIds: string[], coordinatorBotId?: string) => {
    assertStr(name, 'name')
    assertStrArray(memberBotIds, 'memberBotIds')
    if (memberBotIds.length === 0) throw new Error('群聊至少需要一个 Bot 成员')
    for (const id of memberBotIds) {
      if (!db.getBot(id)) throw new Error(`Bot 不存在：${id}`)
    }
    if (coordinatorBotId !== undefined && coordinatorBotId !== null) {
      assertStr(coordinatorBotId, 'coordinatorBotId')
      if (!db.getBot(coordinatorBotId)) throw new Error('协调者 Bot 不存在')
    }
    return db.createGroup(name, memberBotIds, coordinatorBotId ?? undefined)
  })
  handle(CH.updateChat, (id: string, patch: { name?: string; coordinatorBotId?: string | null }) => {
    assertStr(id, 'id')
    if (!patch || typeof patch !== 'object') throw new Error('参数 patch 必须是对象')
    db.updateChat(id, patch)
  })
  handle(CH.deleteChat, (id: string) => {
    assertStr(id, 'id')
    abortChat(id)
    db.deleteChat(id)
  })
  handle(CH.markRead, (chatId: string) => {
    assertStr(chatId, 'chatId')
    db.markRead(chatId)
  })

  // messages
  handle(CH.listMessages, (chatId: string, before?: number, limit?: number) => {
    assertStr(chatId, 'chatId')
    if (before !== undefined && typeof before !== 'number') throw new Error('参数 before 必须是数字')
    if (limit !== undefined && (typeof limit !== 'number' || limit <= 0)) throw new Error('参数 limit 必须是正数')
    return db.listMessages(chatId, before, limit)
  })
  handle(CH.sendUserMessage, (chatId: string, content: string, mentions: string[]) => {
    assertStr(chatId, 'chatId')
    assertStr(content, 'content')
    assertStrArray(mentions ?? [], 'mentions')
    if (!db.getChat(chatId)) throw new Error('会话不存在')
    // 生成在后台推进，事件通过 CH.event 推送；这里立即返回
    void sendUserMessage(chatId, content, mentions ?? []).catch((e) => {
      // 编排过程异常：落一条 system 消息告知用户（失败静默兜底）
      try {
        if (db.getChat(chatId)) {
          db.insertMessage({
            chat_id: chatId,
            sender_type: 'system',
            content: `出错了：${e instanceof Error ? e.message : String(e)}`,
          })
        }
      } catch {
        /* ignore */
      }
    })
  })
  handle(CH.stopChat, (chatId: string) => {
    assertStr(chatId, 'chatId')
    abortChat(chatId)
    db.stopStreamingMessages(chatId)
  })

  // memory
  handle(CH.listMemories, (botId: string) => {
    assertStr(botId, 'botId')
    return db.listMemories(botId)
  })
  handle(CH.addMemory, (botId: string, content: string, kind?: MemoryKind) => {
    assertStr(botId, 'botId')
    assertStr(content, 'content')
    if (!db.getBot(botId)) throw new Error('Bot 不存在')
    const k: MemoryKind = kind === 'preference' || kind === 'summary' ? kind : 'fact'
    return db.addMemory(botId, content.trim(), k, 'manual')
  })
  handle(CH.deleteMemory, (id: string) => {
    assertStr(id, 'id')
    db.deleteMemory(id)
  })

  // workspace
  handle(CH.listWorkspaceFiles, (botId: string) => {
    assertStr(botId, 'botId')
    return listWorkspaceFiles(botId)
  })
  handle(CH.openWorkspace, async (botId: string) => {
    assertStr(botId, 'botId')
    const dir = ensureWorkspace(botId)
    const err = await shell.openPath(dir)
    if (err) throw new Error(err)
  })
  handle(CH.readWorkspaceFile, (botId: string, relPath: string) => {
    assertStr(botId, 'botId')
    assertStr(relPath, 'relPath')
    return readWorkspaceFile(botId, relPath)
  })

  // settings
  handle(CH.getSetting, (key: string) => {
    assertStr(key, 'key')
    return db.getSetting(key)
  })
  handle(CH.setSetting, (key: string, value: string) => {
    assertStr(key, 'key')
    if (typeof value !== 'string') throw new Error('参数 value 必须是字符串')
    db.setSetting(key, value)
  })
}
