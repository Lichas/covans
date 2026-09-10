// main/ipc.ts — 注册 SPEC §4 全部 ipcMain.handle 通道（白名单）
import { app, clipboard, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  Attachment,
  BotInput,
  MemoryKind,
  ProviderInput,
} from '../shared/types'
import {
  MAX_IMAGE_BYTES,
  chatImagePath,
  storeChatImage,
  validateChatImages,
} from './chatImages'
import { randomUUID } from 'node:crypto'
import { CH } from '../shared/ipcChannels'
import * as db from './db'
import { listProviderModels, testProviderConnection } from './agentRuntime'
import { isTurnRunning, sendUserMessage, stopTurn } from './orchestrator'
import { registerContextIpc } from './contextIpc'
import {
  assignDefaultAvatar,
  listPresetAvatars,
  listUserPresetAvatars,
  generateBotAvatar,
  refreshAutomaticAvatar,
  type AvatarMode,
} from './avatars'
import {
  ensureWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
  resolveWorkspaceFile,
} from './workspace'
import { observabilityDirectory } from './observability'

// ---------- 参数校验 ----------

function assertStr(
  v: unknown,
  name: string,
  allowEmpty = false,
): asserts v is string {
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
  handle(CH.importChatImage, (name: string, bytes: Uint8Array) => {
    assertStr(name, 'name')
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMAGE_BYTES)
      throw new Error('每张图片最多 16MB')
    return storeChatImage(Buffer.from(bytes), name)
  })
  registerContextIpc()
  handle(CH.listUserPresetAvatars, () => listUserPresetAvatars())
  handle(CH.pickUserAvatar, async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win!, {
      title: '选择我的头像',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0)
      return db.getUserProfile()
    const source = result.filePaths[0]
    if (fs.statSync(source).size > 16 * 1024 * 1024)
      throw new Error('头像图片不能超过 16MB')
    const extension = path.extname(source) || '.png'
    const relative = path
      .join('avatars', `user-${randomUUID()}${extension}`)
      .split(path.sep)
      .join('/')
    fs.mkdirSync(path.join(app.getPath('userData'), 'avatars'), {
      recursive: true,
    })
    fs.copyFileSync(source, path.join(app.getPath('userData'), relative))
    return db.saveUserProfile({
      ...db.getUserProfile(),
      avatar: relative,
    })
  })
  handle(CH.writeClipboard, (text: string) => {
    assertStr(text, 'text', true)
    clipboard.writeText(text)
  })
  // providers
  handle(CH.listProviders, () => db.listProviders())
  handle(CH.saveProvider, (p: ProviderInput) => {
    if (!p || typeof p !== 'object')
      throw new Error('参数必须是 ProviderInput 对象')
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
  handle(CH.listPresetAvatars, () => listPresetAvatars())
  handle(CH.listBots, () => db.listBots())
  handle(CH.createBot, (input: BotInput) => {
    if (!input || typeof input !== 'object')
      throw new Error('参数必须是 BotInput 对象')
    assertStr(input.name, 'name')
    const bot = db.createBot(input)
    ensureWorkspace(bot.id)
    return refreshAutomaticAvatar(assignDefaultAvatar(bot))
  })
  handle(CH.updateBot, (id: string, patch: Partial<BotInput>) => {
    assertStr(id, 'id')
    if (!patch || typeof patch !== 'object')
      throw new Error('参数 patch 必须是对象')
    const bot = db.updateBot(id, patch)
    return (patch.name || patch.description || patch.system_prompt) &&
      !patch.avatar
      ? refreshAutomaticAvatar(bot)
      : bot
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
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return ''
    const src = result.filePaths[0]
    const avatarsDir = path.join(app.getPath('userData'), 'avatars')
    fs.mkdirSync(avatarsDir, { recursive: true })
    const ext = path.extname(src) || '.png'
    if (fs.statSync(src).size > 16 * 1024 * 1024)
      throw new Error('头像图片不能超过 16MB')
    const rel = path.join('avatars', `${botId}-${db.newId()}${ext}`)
    fs.copyFileSync(src, path.join(app.getPath('userData'), rel))
    db.updateBot(botId, { avatar: rel.split(path.sep).join('/') })
    return rel.split(path.sep).join('/')
  })
  handle(
    CH.generateAvatar,
    async (botId: string, prompt: string, mode: AvatarMode = 'auto') => {
      assertStr(botId, 'botId')
      assertStr(prompt, 'prompt', true)
      if (prompt.length > 4000) throw new Error('头像提示词不超过4000字')
      if (!['auto', 'local', 'image'].includes(mode))
        throw new Error('未知头像生成方式')
      return (await generateBotAvatar(botId, prompt, mode)).path
    },
  )

  // chats
  handle(CH.listChats, () => db.listChats())
  handle(CH.createDm, (botId: string) => {
    assertStr(botId, 'botId')
    if (!db.getBot(botId)) throw new Error('Bot 不存在')
    return db.createDm(botId)
  })
  handle(
    CH.createGroup,
    (name: string, memberBotIds: string[], coordinatorBotId?: string) => {
      assertStr(name, 'name')
      assertStrArray(memberBotIds, 'memberBotIds')
      if (memberBotIds.length === 0)
        throw new Error('群聊至少需要一个 Bot 成员')
      for (const id of memberBotIds) {
        if (!db.getBot(id)) throw new Error(`Bot 不存在：${id}`)
      }
      if (coordinatorBotId !== undefined && coordinatorBotId !== null) {
        assertStr(coordinatorBotId, 'coordinatorBotId')
        if (!db.getBot(coordinatorBotId)) throw new Error('协调者 Bot 不存在')
      }
      return db.createGroup(name, memberBotIds, coordinatorBotId ?? undefined)
    },
  )
  handle(
    CH.updateChat,
    (
      id: string,
      patch: {
        name?: string
        coordinatorBotId?: string | null
        replyMode?: 'active' | 'sequential'
      },
    ) => {
      assertStr(id, 'id')
      if (!patch || typeof patch !== 'object')
        throw new Error('参数 patch 必须是对象')
      if (patch.replyMode && !['active', 'sequential'].includes(patch.replyMode))
        throw new Error('未知群聊回复机制')
      db.updateChat(id, patch)
    },
  )
  handle(CH.addChatMembers, (chatId: string, botIds: string[]) => {
    assertStr(chatId, 'chatId')
    assertStrArray(botIds, 'botIds')
    if (!botIds.length) throw new Error('请选择至少一个 Bot')
    db.addChatMembers(chatId, botIds)
  })
  handle(CH.hideChat, (chatId: string) => {
    assertStr(chatId, 'chatId')
    stopTurn(chatId)
    db.hideChat(chatId)
  })
  handle(CH.clearChatMessages, (chatId: string) => {
    assertStr(chatId, 'chatId')
    stopTurn(chatId)
    db.clearChatMessages(chatId)
  })
  handle(CH.deleteChat, (id: string) => {
    assertStr(id, 'id')
    stopTurn(id)
    db.deleteChat(id)
  })
  handle(CH.markRead, (chatId: string) => {
    assertStr(chatId, 'chatId')
    db.markRead(chatId)
  })
  handle(CH.exportChat, async (chatId: string) => {
    assertStr(chatId, 'chatId')
    const chat = db.getChat(chatId)
    if (!chat) throw new Error('会话不存在')
    const title =
      chat.name || (chat.bot_id && db.getBot(chat.bot_id)?.name) || '会话'
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win!, {
      title: '导出会话',
      defaultPath: `${title.replace(/[\\/:*?"<>|]/g, '-')}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return null
    const messages = db.listMessages(chatId, undefined, 2147483647)
    const assetName = `covan-images-${randomUUID()}`
    const assetDir = path.join(path.dirname(result.filePath), assetName)
    const text =
      [
        `# ${title}`,
        `从 Covan 导出 · ${new Date().toLocaleString('zh-CN')}`,
        ...messages
          .filter((m) => m.status !== 'streaming')
          .map((m) => {
            const who =
              m.sender_type === 'user'
                ? '你'
                : m.sender_type === 'system'
                  ? '系统'
                  : (m.sender_bot_id && db.getBot(m.sender_bot_id)?.name) ||
                    'Bot'
            const images = m.attachments
              .map((image) => {
                try {
                  const source = chatImagePath(image.path)
                  fs.mkdirSync(assetDir, { recursive: true })
                  fs.copyFileSync(
                    source,
                    path.join(assetDir, path.basename(source)),
                  )
                  return `![${image.name.replace(/[\[\]\\\r\n]/g, '')}](${assetName}/${path.basename(source)})`
                } catch {
                  return '> 图片文件不可用'
                }
              })
              .join('\n\n')
            return `## ${who} · ${new Date(m.created_at).toLocaleString('zh-CN')}\n\n${m.content}${images ? `\n\n${images}` : ''}${m.error ? `\n\n> 生成失败：${m.error}` : ''}${m.status === 'stopped' ? '\n\n> 已停止生成' : ''}`
          }),
      ].join('\n\n') + '\n'
    await fs.promises.writeFile(result.filePath, text, 'utf8')
    return result.filePath
  })

  // messages
  handle(CH.listMessages, (chatId: string, before?: number, limit?: number) => {
    assertStr(chatId, 'chatId')
    if (before !== undefined && typeof before !== 'number')
      throw new Error('参数 before 必须是数字')
    if (limit !== undefined && (typeof limit !== 'number' || limit <= 0))
      throw new Error('参数 limit 必须是正数')
    return db.listMessages(chatId, before, limit)
  })
  handle(
    CH.sendUserMessage,
    (
      chatId: string,
      content: string,
      mentions: string[],
      attachments: Attachment[] = [],
    ) => {
      assertStr(chatId, 'chatId')
      assertStr(content, 'content', true)
      assertStrArray(mentions ?? [], 'mentions')
      const chat = db.getChat(chatId)
      if (!chat) throw new Error('会话不存在')
      if (
        isTurnRunning(chatId) &&
        !(chat.type === 'group' && chat.reply_mode === 'active')
      )
        throw new Error('当前会话正在回复，请稍后再发送')
      const images = validateChatImages(attachments)
      if (!content.trim() && !images.length)
        throw new Error('请填写消息或添加图片')
      // 生成在后台推进，事件通过 CH.event 推送；这里立即返回
      void sendUserMessage(chatId, content, mentions ?? [], images).catch(
        () => undefined,
      )
    },
  )
  handle(CH.stopChat, (chatId: string) => {
    assertStr(chatId, 'chatId')
    stopTurn(chatId)
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
    const k: MemoryKind =
      kind === 'preference' || kind === 'summary' ? kind : 'fact'
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
  handle(CH.revealWorkspaceFile, (botId: string, relPath: string) => {
    assertStr(botId, 'botId')
    assertStr(relPath, 'relPath')
    const file = resolveWorkspaceFile(botId, relPath)
    if (!fs.existsSync(file)) throw new Error('文件不存在或已被移动')
    shell.showItemInFolder(file)
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
  handle(CH.openObservabilityLogs, async () => {
    const err = await shell.openPath(observabilityDirectory())
    if (err) throw new Error(err)
  })
}
