// main/index.ts — Electron 主进程入口：app 生命周期、窗口创建、模块初始化
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol } from 'electron'
import type { CovanEvent } from '../shared/types'
import { CH } from '../shared/ipcChannels'
import { getDb, initDb } from './db'
import { initWorkspace } from './workspace'
import { initOrchestrator } from './orchestrator'
import { configureWebNetworkAdapter } from './tools/web'
import { renderWebPage } from './tools/browser'
import { registerIpc } from './ipc'
import { chatImagePath } from './chatImages'
import { initObservability } from './observability'
import { startMemorySummaries, stopMemorySummaries } from './memory'
import {
  canReadLifestylePhoto,
  seedDefaultAvatars,
  seedUserPresetAvatars,
} from './avatars'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const legacyUserData = app.getPath('userData')
const configuredUserData = process.env.COVAN_USER_DATA_DIR
const defaultUserData = path.join(os.homedir(), '.covans')

// 测试可覆盖为临时目录；正常运行时应用数据和 Agent 工作区统一位于 ~/.covans。
app.setPath('userData', configuredUserData || defaultUserData)

/**
 * 首次切换到 ~/.covans 时，安全复制旧应用数据，绝不删除旧目录。
 * 只迁移数据库、头像、聊天图片和工作区；不复制 Electron 缓存或其他应用文件。
 * 只有目标目录尚不存在且旧目录中确有数据库时才迁移，避免覆盖用户新建的数据目录。
 */
function prepareUserDataDir(userData: string): void {
  if (
    !configuredUserData &&
    legacyUserData !== userData &&
    !fs.existsSync(path.join(userData, 'legacy.db')) &&
    fs.existsSync(path.join(legacyUserData, 'legacy.db'))
  ) {
    try {
      fs.mkdirSync(userData, { recursive: true })
      for (const name of [
        'legacy.db',
        'legacy.db-wal',
        'legacy.db-shm',
        'avatars',
        'chat-images',
        'workspaces',
      ]) {
        const source = path.join(legacyUserData, name)
        if (fs.existsSync(source))
          fs.cpSync(source, path.join(userData, name), { recursive: true })
      }
      console.info(`已将已有本地数据复制到 ${userData}`)
      return
    } catch (error) {
      console.warn('复制旧本地数据失败，将创建新的 Covan 数据目录', error)
    }
  }
  fs.mkdirSync(userData, { recursive: true })
}

// 自定义头像协议：covan-avatar://local/avatars/<逐段编码的文件路径>
// 必须在 app ready 之前注册特权
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'covan-image',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: 'covan-avatar',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

function registerAvatarProtocol(userData: string): void {
  protocol.handle('covan-image', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'local')
        return new Response('forbidden', { status: 403 })
      const file = chatImagePath(
        decodeURIComponent(url.pathname).replace(/^\/+/, ''),
      )
      return await net.fetch(pathToFileURL(file).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
  protocol.handle('covan-avatar', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'local')
        return new Response('forbidden', { status: 403 })
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const abs = path.resolve(userData, rel)
      if (!abs.startsWith(path.resolve(userData, 'avatars') + path.sep))
        return new Response('forbidden', { status: 403 })
      const relative = path.relative(userData, abs).split(path.sep).join('/')
      if (
        relative.startsWith('avatars/preset/lifestyle/') &&
        !canReadLifestylePhoto(relative)
      )
        return new Response('not found', { status: 404 })
      const response = await net.fetch(pathToFileURL(abs).toString())
      if (relative.startsWith('avatars/preset/lifestyle/'))
        return new Response(response.body, {
          status: response.status,
          headers: {
            'Content-Type':
              response.headers.get('Content-Type') ||
              'application/octet-stream',
            'Cache-Control': 'no-store',
          },
        })
      return response
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

/** 向所有窗口广播 Covan 事件 */
function broadcast(ev: CovanEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(CH.event, ev)
    } catch {
      /* 窗口可能已销毁 */
    }
  }
}

function setDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.png')
    : path.join(app.getAppPath(), 'resources', 'app-icon.png')
  if (fs.existsSync(iconPath)) app.dock.setIcon(iconPath)
}

function createWindow(): void {
  const win = new BrowserWindow({
    title: 'Covan',
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f5f4',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url))
      void import('electron').then(({ shell }) => shell.openExternal(url))
    return { action: 'deny' }
  })

  // 开发模式加载 vite dev server，否则加载构建产物
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url))
        void import('electron').then(({ shell }) => shell.openExternal(url))
    }
  })
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  const userData = app.getPath('userData')
  prepareUserDataDir(userData)
  registerAvatarProtocol(userData)
  initDb(userData)
  startMemorySummaries()
  initObservability(userData)
  // A previous process may have exited during generation.
  // Recovery never resumes a network request automatically.
  getDb()
    .prepare(
      "UPDATE messages SET status = 'stopped' WHERE status = 'streaming'",
    )
    .run()
  initWorkspace(userData)
  configureWebNetworkAdapter({
    fetch: (url, init) =>
      net.fetch(url, { ...init, bypassCustomProtocolHandlers: true }),
    renderPage: renderWebPage,
  })
  seedDefaultAvatars(
    app.isPackaged
      ? path.join(process.resourcesPath, 'default-avatars')
      : path.join(app.getAppPath(), 'resources', 'default-avatars'),
  )
  seedUserPresetAvatars(
    app.isPackaged
      ? path.join(process.resourcesPath, 'user-avatars')
      : path.join(app.getAppPath(), 'resources', 'user-avatars'),
  )
  getDb()
    .prepare("UPDATE agent_threads SET status='stopped' WHERE status='running'")
    .run()
  getDb()
    .prepare(
      "UPDATE agent_private_messages SET status='stopped' WHERE status='streaming'",
    )
    .run()
  initOrchestrator({ emit: broadcast })
  registerIpc()
  setDockIcon()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopMemorySummaries()
})
