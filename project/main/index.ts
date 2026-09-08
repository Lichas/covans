// main/index.ts — Electron 主进程入口：app 生命周期、窗口创建、模块初始化
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol } from 'electron'
import type { CovanEvent } from '../shared/types'
import { CH } from '../shared/ipcChannels'
import { initDb } from './db'
import { initWorkspace } from './workspace'
import { initOrchestrator } from './orchestrator'
import { registerIpc } from './ipc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 自定义头像协议：covan-avatar://<encodeURIComponent(相对 userData 的路径)>
// 必须在 app ready 之前注册特权
protocol.registerSchemesAsPrivileged([
  { scheme: 'covan-avatar', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

function registerAvatarProtocol(userData: string): void {
  protocol.handle('covan-avatar', (request) => {
    try {
      const rel = decodeURIComponent(request.url.slice('covan-avatar://'.length)).replace(/^\/+/, '')
      const abs = path.resolve(userData, rel)
      if (!abs.startsWith(path.resolve(userData) + path.sep)) return new Response('forbidden', { status: 403 })
      return net.fetch(pathToFileURL(abs).toString())
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
    if (url.startsWith('https://')) void import('electron').then(({ shell }) => shell.openExternal(url))
    return { action: 'deny' }
  })

  // 开发模式加载 vite dev server，否则加载构建产物
  const devUrl = process.env['ELECTRON_RENDERER_URL']
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
  initWorkspace(userData)
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
