import { BrowserWindow, session } from 'electron'
import type { BrowserRenderedPage } from './web'

const SETTLE_MIN_MS = 1_200
const SETTLE_MAX_MS = 5_000
const MAX_EXTRACTED_CHARS = 150_000

const settleScript = `new Promise((resolve) => {
  const started = Date.now()
  let previous = -1
  let stableChecks = 0
  const check = () => {
    const length = document.body?.innerText?.length || 0
    stableChecks = length === previous ? stableChecks + 1 : 0
    previous = length
    const elapsed = Date.now() - started
    if ((elapsed >= ${SETTLE_MIN_MS} && stableChecks >= 3) || elapsed >= ${SETTLE_MAX_MS}) {
      resolve(true)
      return
    }
    setTimeout(check, 250)
  }
  check()
})`

const extractScript = `(() => {
  const preferred = document.querySelector('main, article, [role="main"]')
  const root = preferred || document.body || document.documentElement
  const text = (root?.innerText || '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim()
  const links = Array.from(root?.querySelectorAll?.('a[href]') || [])
    .slice(0, 100)
    .map((link) => ({ label: (link.innerText || '').trim(), url: link.href }))
    .filter((link) => link.label && /^https?:\\/\\//i.test(link.url))
  return {
    finalUrl: location.href,
    title: document.title || '',
    text: text.slice(0, ${MAX_EXTRACTED_CHARS}),
    links,
  }
})()`

/**
 * Render one page in an isolated, hidden Chromium window. The in-memory session
 * shares the OS proxy configuration but not the user's normal browsing login state.
 */
export async function renderWebPage(
  url: string,
  signal?: AbortSignal,
): Promise<BrowserRenderedPage> {
  signal?.throwIfAborted()
  const isolatedSession = session.fromPartition('covan-web-tools')
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      session: isolatedSession,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: true,
      webSecurity: true,
    },
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const abort = () => {
    if (!win.isDestroyed()) {
      win.webContents.stop()
      win.destroy()
    }
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await win.loadURL(url, { userAgent: 'Covan/0.1 (+JavaScript web tool)' })
    signal?.throwIfAborted()
    await win.webContents.executeJavaScript(settleScript, true)
    signal?.throwIfAborted()
    return (await win.webContents.executeJavaScript(
      extractScript,
      true,
    )) as BrowserRenderedPage
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    if (!win.isDestroyed()) win.destroy()
  }
}
