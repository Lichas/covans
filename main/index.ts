// main/index.ts — Electron 主进程入口：app 生命周期、窗口创建、模块初始化
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, nativeTheme, net, protocol, safeStorage } from 'electron'
import type { CovanEvent } from '../shared/types'
import { CH } from '../shared/ipcChannels'
import { getDb, getSetting, initDb } from './db'
import { initWorkspace, resolveWorkspaceFile } from './workspace'
import { initialVibrancy, setShellWindow } from './windowShell'
import { initOrchestrator, runScheduledTask } from './orchestrator'
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
import { isGroupBackground } from '../shared/groupBackgrounds'
import { startScheduledTasks, stopScheduledTasks } from './scheduledTasks'
import { initExtensions } from './extensions/store'
import { closeMcpSessions, configureMcpFetch } from './extensions/mcp'
import { initResponseDecisionEngine } from './decisionStrategy'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configuredUserData = process.env.COVAN_USER_DATA_DIR
const defaultUserData = path.join(os.homedir(), '.covans')

// 测试可覆盖为临时目录；正常运行时应用数据和 Agent 工作区统一位于 ~/.covans。
app.setPath('userData', configuredUserData || defaultUserData)

/** 应用数据统一放在 ~/.covans（测试可覆盖为临时目录），不存在时创建。 */
function prepareUserDataDir(userData: string): void {
  fs.mkdirSync(userData, { recursive: true })
}

// 自定义头像协议：covan-avatar://local/avatars/<逐段编码的文件路径>
// 必须在 app ready 之前注册特权
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'covan-print',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
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
  {
    scheme: 'covan-bg',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: 'covan-workspace',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

function workspaceMime(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.avif':
      return 'image/avif'
    case '.gif':
      return 'image/gif'
    case '.htm':
    case '.html':
      return 'text/html; charset=utf-8'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.pdf':
      return 'application/pdf'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.txt':
      return 'text/plain; charset=utf-8'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function groupBackgroundPath(file: string): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'group-backgrounds')
    : path.join(app.getAppPath(), 'resources', 'group-backgrounds')
  return path.join(base, file)
}

function registerImageProtocols(userData: string): void {
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
  protocol.handle('covan-bg', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'builtin')
        return new Response('forbidden', { status: 403 })
      const file = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (!isGroupBackground(file))
        return new Response('forbidden', { status: 403 })
      const response = await net.fetch(
        pathToFileURL(groupBackgroundPath(file)).toString(),
      )
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type':
            response.headers.get('Content-Type') || 'application/octet-stream',
          'Cache-Control': 'no-store',
        },
      })
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
  protocol.handle('covan-workspace', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'file')
        return new Response('forbidden', { status: 403 })
      const parts = decodeURIComponent(url.pathname)
        .replace(/^\/+/, '')
        .split('/')
      const botId = parts.shift()
      const relPath = parts.join('/')
      if (!botId || !relPath) return new Response('not found', { status: 404 })
      const abs = resolveWorkspaceFile(botId, relPath)
      const response = await net.fetch(pathToFileURL(abs).toString())
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': workspaceMime(abs),
          'Cache-Control': 'no-store',
        },
      })
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
  const theme = getSetting('theme')
  nativeTheme.themeSource = theme === 'dark' || theme === 'system' ? theme : 'light'
  const transparency = getSetting('window_transparency')
  const win = new BrowserWindow({
    title: 'Covan',
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    // 先隐藏再在 ready-to-show 显示：透明窗口在渲染完成前会闪一下白色。
    show: false,
    ...(process.platform === 'darwin'
      ? {
          transparent: true,
          backgroundColor: '#00000000',
          vibrancy: initialVibrancy(transparency),
          visualEffectState: 'active' as const,
        }
      : { backgroundColor: '#f5f5f4' }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  })

  setShellWindow(win)
  win.on('closed', () => setShellWindow(null))
  win.once('ready-to-show', () => win.show())

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
  registerImageProtocols(userData)
  initDb(userData)
  startMemorySummaries()
  initObservability(userData)
  initResponseDecisionEngine({
    codec: {
      seal(value) {
        if (
          !safeStorage.isEncryptionAvailable() ||
          (process.platform === 'linux' &&
            safeStorage.getSelectedStorageBackend() === 'basic_text')
        )
          throw new Error('系统凭据加密不可用，无法保存 TypeSafe API Key')
        return safeStorage.encryptString(value).toString('base64')
      },
      unseal: (value) =>
        safeStorage.decryptString(Buffer.from(value, 'base64')),
    },
    fetch: (url, init) =>
      net.fetch(url, { ...init, bypassCustomProtocolHandlers: true }),
  })
  initExtensions(userData, {
    seal(value) {
      if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'))
        throw new Error('系统凭据加密不可用，无法保存 MCP 环境变量或请求头')
      return safeStorage.encryptString(value).toString('base64')
    },
    unseal: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
  })
  configureMcpFetch((input, init) => net.fetch(input instanceof URL ? input.href : input, { ...init, bypassCustomProtocolHandlers: true }))
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
  startScheduledTasks(runScheduledTask)
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

let extensionsClosed = false
app.on('before-quit', (event) => {
  stopMemorySummaries()
  stopScheduledTasks()
  if (!extensionsClosed) {
    event.preventDefault()
    void closeMcpSessions().finally(() => { extensionsClosed = true; app.quit() })
  }
})
