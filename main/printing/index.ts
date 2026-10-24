// Native print transport. Document bytes never cross IPC or reach a model.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, session } from 'electron'
import type { PrintResult } from '../../shared/types'
import { PRINT_DOCUMENT_EXTENSIONS } from '../../shared/documentFormats'
import { getBot } from '../db'
import { ensureWorkspace, resolveWorkspaceFile } from '../workspace'
import { printableHtml, readPrintAsset, readPrintDocument, type PrintDocument } from './document'
import { PDF_BOOTSTRAP, printablePdfHtml, readPdfJsAsset } from './pdf'

const require = createRequire(import.meta.url)
const katexRoot = path.dirname(require.resolve('katex/package.json'))
const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' covan-print:; img-src covan-print: data:; font-src covan-print: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
let busy = false

function printError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT') return '文档或资源不存在，请刷新后重试'
  if (code === 'EACCES' || code === 'EPERM') return '没有读取此文档的权限，请重新选择文件'
  if (error instanceof Error && !code) return error.message
  return '无法准备打印文档，请检查文件后重试'
}

async function exclusivePrint(run: () => Promise<PrintResult>): Promise<PrintResult> {
  if (busy) return { status: 'failed', error: '已有打印流程正在进行，请先完成或取消' }
  busy = true
  try { return await run() }
  catch (error) { return { status: 'failed', error: printError(error) } }
  finally { busy = false }
}

export function printWorkspaceFile(owner: BrowserWindow, botId: string, relative: string): Promise<PrintResult> {
  return exclusivePrint(async () => {
    if (!getBot(botId)) throw new Error('Bot 不存在，请刷新后重试')
    const file = resolveWorkspaceFile(botId, relative)
    return printDocument(owner, readPrintDocument(file, ensureWorkspace(botId)))
  })
}

export function pickAndPrintDocument(owner: BrowserWindow): Promise<PrintResult> {
  return exclusivePrint(async () => {
    const selected = await dialog.showOpenDialog(owner, {
      title: '打开文档打印', properties: ['openFile'],
      filters: [{ name: '可打印文档', extensions: PRINT_DOCUMENT_EXTENSIONS }],
    })
    if (selected.canceled || !selected.filePaths.length) return { status: 'cancelled' }
    // Only the native picker may authorize a document outside a Bot workspace.
    const file = fs.realpathSync(selected.filePaths[0])
    return printDocument(owner, readPrintDocument(file))
  })
}

async function printDocument(owner: BrowserWindow, document: PrintDocument): Promise<PrintResult> {
  const id = randomUUID()
  // Serialized jobs reuse one memory-only session, avoiding a retained browser
  // session per click. Each job still has its own unguessable protocol prefix.
  const printSession = session.fromPartition('covan-print')
  const prefix = `/${id}/`
  const encodePath = (relative: string) => relative.split('/').map(encodeURIComponent).join('/')
  const sourceUrl = `covan-print://document${prefix}${encodePath(document.relative)}?document=1`
  const katexUrl = `covan-print://document${prefix}__katex/dist/katex.min.css`
  const pdfJsUrl = `covan-print://document${prefix}__pdfjs/`
  const html = document.kind === 'pdf' ? printablePdfHtml(document.name, `${pdfJsUrl}bootstrap.mjs`) : printableHtml(document, katexUrl)
  const documentCsp = document.kind === 'pdf'
    ? `${CSP.replace("script-src 'none'", `script-src ${pdfJsUrl}`).replace("connect-src 'none'", 'connect-src covan-print:').replace('font-src covan-print: data:', 'font-src covan-print: data: blob:')}; worker-src covan-print:`
    : CSP
  let win: BrowserWindow | undefined
  let readyTimer: ReturnType<typeof setTimeout> | undefined
  let pdfPollTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let rejectPreparation: ((error: Error) => void) | undefined

  printSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  printSession.setPermissionCheckHandler(() => false)
  const preventDownload = (event: Electron.Event) => event.preventDefault()
  printSession.on('will-download', preventDownload)
  printSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url)
    const local = url.protocol === 'covan-print:' && url.hostname === 'document' && url.pathname.startsWith(prefix)
    callback({ cancel: !local && url.protocol !== 'data:' && url.protocol !== 'blob:' })
  })
  printSession.protocol.handle('covan-print', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'document' || !url.pathname.startsWith(prefix)) return new Response('', { status: 403 })
      if (url.href === sourceUrl) {
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': documentCsp } })
      }
      const relative = decodeURIComponent(url.pathname.slice(prefix.length))
      if (document.kind === 'pdf' && relative === '__source.pdf') return new Response(new Uint8Array(document.bytes), { headers: { 'Content-Type': 'application/octet-stream' } })
      if (document.kind === 'pdf' && relative === '__pdfjs/bootstrap.mjs') return new Response(PDF_BOOTSTRAP, { headers: { 'Content-Type': 'text/javascript' } })
      if (document.kind === 'pdf' && relative.startsWith('__pdfjs/')) {
        const asset = readPdfJsAsset(relative.slice('__pdfjs/'.length))
        return new Response(new Uint8Array(asset.bytes), { headers: { 'Content-Type': asset.mime } })
      }
      const asset = relative.startsWith('__katex/')
        ? readPrintAsset(katexRoot, relative.slice('__katex/'.length))
        : readPrintAsset(document.root, relative)
      return new Response(new Uint8Array(asset.bytes), {
        headers: { 'Content-Type': asset.mime, 'Content-Security-Policy': CSP },
      })
    } catch { return new Response('', { status: 404 }) }
  })
  try {
    win = new BrowserWindow({
      parent: owner, show: false, width: 900, height: 760,
      title: `打印 · ${document.name}`, backgroundColor: '#ffffff',
      webPreferences: {
        session: printSession, nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true, plugins: false,
      },
    })
    const contents = win.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => { if (url !== sourceUrl) event.preventDefault() })
    const closedDuringPreparation = () => rejectPreparation?.(new Error('PRINT_WINDOW_CLOSED'))
    win.on('closed', closedDuringPreparation)
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectPreparation = reject
      readyTimer = setTimeout(() => reject(new Error('文档加载超时，请检查图片或文件后重试')), 30_000)
    })
    await Promise.race([
      (async () => {
        await contents.loadURL(sourceUrl)
        if (contents.isLoading()) await new Promise<void>((resolve) => contents.once('did-stop-loading', () => resolve()))
        if (document.kind === 'pdf') {
          await new Promise<void>((resolve, reject) => {
            const check = async () => {
              if (disposed) return
              if (contents.isDestroyed()) { reject(new Error('PRINT_WINDOW_CLOSED')); return }
              try {
                const state = await contents.executeJavaScript("({status: document.documentElement.dataset.printStatus, error: document.documentElement.dataset.printError})")
                if (state.status === 'ready') resolve()
                else if (state.status === 'failed') reject(new Error(state.error))
                else if (!disposed) pdfPollTimer = setTimeout(check, 50)
              } catch (error) { reject(error) }
            }
            check()
          })
        } else {
          // Fixed application-owned code, never JavaScript supplied by a document.
          const imagesReady = await contents.executeJavaScript(`(async () => {
            await document.fonts.ready;
            const images = await Promise.all(Array.from(document.images, image => image.decode().then(() => true, () => false)));
            return images.every(Boolean);
          })()`)
          if (!imagesReady) throw new Error('文档中有图片无法加载；请使用文档目录或工作区内的本地图片')
        }
      })(),
      timeout,
    ])
    clearTimeout(readyTimer)
    win.removeListener('closed', closedDuringPreparation)
    win.show()
    return await new Promise<PrintResult>((resolve) => {
      let completed = false
      const crashed = () => finish({ status: 'failed', error: '打印文档窗口异常退出，请重试' })
      const finish = (result: PrintResult) => {
        if (completed) return
        completed = true
        contents.removeListener('render-process-gone', crashed)
        resolve(result)
      }
      contents.once('render-process-gone', crashed)
      win!.once('closed', () => finish({ status: 'cancelled' }))
      try {
        contents.print({ silent: false, printBackground: true }, (success, reason) => {
          if (success) finish({ status: 'submitted' })
          else if (/cancel/i.test(reason)) finish({ status: 'cancelled' })
          else finish({ status: 'failed', error: '系统未能提交打印任务，请检查打印机连接、驱动与纸张设置后重试' })
        })
      } catch { finish({ status: 'failed', error: '无法打开系统打印对话框，请检查打印服务后重试' }) }
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'PRINT_WINDOW_CLOSED') return { status: 'cancelled' }
    return { status: 'failed', error: printError(error) }
  } finally {
    disposed = true
    clearTimeout(readyTimer)
    clearTimeout(pdfPollTimer)
    if (win && !win.isDestroyed()) win.destroy()
    printSession.webRequest.onBeforeRequest(null)
    printSession.protocol.unhandle('covan-print')
    printSession.removeListener('will-download', preventDownload)
    // Cleanup must not turn an already submitted job into a reported failure.
    await Promise.allSettled([printSession.closeAllConnections(), printSession.clearCache(), printSession.clearStorageData()])
    if (!owner.isDestroyed()) owner.focus()
  }
}
