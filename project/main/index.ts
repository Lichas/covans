// main/index.ts — Electron 主进程入口：app 生命周期、窗口创建、模块初始化
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol } from 'electron'
import type { CovanEvent } from '../shared/types'
import { CH } from '../shared/ipcChannels'
import { getDb, initDb } from './db'
import { initWorkspace } from './workspace'
import { initOrchestrator } from './orchestrator'
import { registerIpc } from './ipc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Tests use an isolated data directory; keep the existing default path for installed users.
if (process.env.COVAN_USER_DATA_DIR)
  app.setPath('userData', process.env.COVAN_USER_DATA_DIR)

// 自定义头像协议：covan-avatar://local/avatars/<逐段编码的文件路径>
// 必须在 app ready 之前注册特权
protocol.registerSchemesAsPrivileged([
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
  protocol.handle('covan-avatar', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'local')
        return new Response('forbidden', { status: 403 })
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const abs = path.resolve(userData, rel)
      if (!abs.startsWith(path.resolve(userData, 'avatars') + path.sep))
        return new Response('forbidden', { status: 403 })
      return await net.fetch(pathToFileURL(abs).toString())
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
  registerAvatarProtocol(userData)
  initDb(userData)
  // A previous process may have exited during generation.
  // Recovery never resumes a network request automatically.
  getDb()
    .prepare(
      "UPDATE messages SET status = 'stopped' WHERE status = 'streaming'",
    )
    .run()
  initWorkspace(userData)
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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
