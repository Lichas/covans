// Real Electron renderer and print document rendering; the native print call
// is intercepted in main before any physical printer can receive a job.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-printing-'))
const artifacts = path.join(root, 'artifacts', 'printing')
fs.mkdirSync(artifacts, { recursive: true })
const errors = []
let remoteRequests = 0
const remote = http.createServer((_request, response) => { remoteRequests++; response.end('must not be requested') })
let app, page

try {
  await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve))
  app = await electron.launch({
    args: [root],
    env: {
      PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: os.tmpdir(),
      ELECTRON_RENDERER_URL: '', COVAN_USER_DATA_DIR: profile,
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(20_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByRole('button', { name: '创建你的 Bot' })).toBeVisible()
  const fixture = await page.evaluate(async () => {
    const provider = await window.covan.saveProvider({ name: '打印测试 Mock', kind: 'mock' })
    const bot = await window.covan.createBot({ name: '文档伙伴', provider_id: provider.id })
    const chat = await window.covan.createDm(bot.id)
    return { bot, chat }
  })
  const workspace = path.join(profile, 'workspaces', fixture.bot.workspace_dir)
  fs.mkdirSync(path.join(workspace, 'reports'), { recursive: true })
  const markdown = '# 发布执行单\n\n|任务|负责人|\n|---|---|\n|验证打印|文档伙伴|\n\n- [x] 核对格式\n\n公式：$E=mc^2$\n\n![本地图](chart.svg)\n\n' + Array.from({ length: 60 }, (_, index) => `第 ${index + 1} 项：这是一份多页打印回归文档，保留全部内容与排版。`).join('\n\n')
  fs.writeFileSync(path.join(workspace, 'reports', '发布执行单.md'), markdown)
  fs.writeFileSync(path.join(workspace, 'reports', 'chart.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><rect width="240" height="60" fill="#dae7ff"/><text x="16" y="36">LOCAL CHART</text></svg>')
  fs.writeFileSync(path.join(workspace, 'notes.txt'), 'plain <script>must remain text</script>')
  fs.writeFileSync(path.join(workspace, 'sample.ts'), 'const message = "print code"')
  fs.writeFileSync(path.join(workspace, 'unsafe.html'), `<h1>安全 HTML</h1><script src="http://127.0.0.1:${remote.address().port}/script.js"></script><img src="http://127.0.0.1:${remote.address().port}/secret.png">`)
  fs.writeFileSync(path.join(workspace, 'local.html'), '<html><head><style>h1{color:rgb(0,80,140)}</style></head><body><h1>HTML 打印</h1><script>globalThis.printScriptExecuted=true</script><iframe src="file:///etc/hosts"></iframe><img src="reports/chart.svg" onload="globalThis.printScriptExecuted=true"></body></html>')
  fs.writeFileSync(path.join(workspace, 'unsupported.docx'), 'unsupported')
  fs.symlinkSync(path.join(profile, 'covan.db'), path.join(workspace, 'escape.txt'))

  await app.evaluate(async ({ app, BrowserWindow, dialog }, fixture) => {
    const fs = process.getBuiltinModule('fs')
    const path = process.getBuiltinModule('path')
    const { createRequire } = process.getBuiltinModule('module')
    const req = createRequire(app.getAppPath() + '/package.json')
    const Database = req('better-sqlite3')
    const db = new Database(path.join(app.getPath('userData'), 'covan.db'))
    const relative = 'reports/发布执行单.md'
    const stat = fs.statSync(path.join(fixture.workspace, relative))
    db.prepare('INSERT INTO messages (id, chat_id, sender_type, sender_bot_id, content, artifacts, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'print-fixture', fixture.chat.id, 'bot', fixture.bot.id, '发布执行单已写入工作区，可以预览或打印。',
      JSON.stringify([{ relPath: relative, name: '发布执行单.md', size: stat.size, mtime: stat.mtimeMs, operation: 'write' }]), 'done', Date.now(),
    )
    db.close()
    // Generate a genuine two-page PDF fixture without using a printer.
    const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await pdfWindow.loadURL('data:text/html,' + encodeURIComponent('<style>@page portrait{size:A4}@page landscape{size:A4 landscape}</style><section style="page:portrait"><h1>PDF PAGE ONE</h1></section><section style="page:landscape;break-before:page"><h1>PDF PAGE TWO</h1></section>'))
    fs.writeFileSync(path.join(fixture.workspace, 'two-pages.pdf'), await pdfWindow.webContents.printToPDF({ pageSize: 'A4', preferCSSPageSize: true }))
    await pdfWindow.loadURL('data:text/html,' + encodeURIComponent(Array.from({ length: 101 }, (_, index) => `<p style="break-before:${index ? 'page' : 'auto'}">Page ${index + 1}</p>`).join('')))
    fs.writeFileSync(path.join(fixture.workspace, 'too-many-pages.pdf'), await pdfWindow.webContents.printToPDF({ pageSize: 'A4' }))
    pdfWindow.destroy()

    const harness = { calls: [], mode: 'submitted', selectedFile: '', pickerCancelled: false, pending: null, errors: [], diagnostics: [] }
    globalThis.__printingHarness = harness
    dialog.showOpenDialog = async () => ({ canceled: harness.pickerCancelled, filePaths: harness.selectedFile ? [harness.selectedFile] : [] })
    app.on('web-contents-created', (_event, contents) => {
      contents.on('console-message', (event) => harness.diagnostics.push({ url: contents.getURL(), message: event.message?.slice(0, 600) }))
      contents.print = (options, callback) => {
        void (async () => {
          try {
            const source = contents.getURL()
            const isPdf = source.includes('two-pages.pdf')
            const snapshot = await contents.executeJavaScript(`({
              title: document.title, text: document.body.innerText,
              tables: document.querySelectorAll('table').length,
              formula: document.querySelectorAll('.katex').length,
              imageReady: Array.from(document.images).every(image => image.complete && image.naturalWidth > 0),
              hasBridge: typeof window.covan !== 'undefined',
              hasNode: typeof require !== 'undefined',
              scriptExecuted: !!globalThis.printScriptExecuted,
              pdfPages: document.querySelectorAll('.pdf-page canvas').length,
              pdfSizes: Array.from(document.querySelectorAll('.pdf-page')).map(page => ({ width: parseFloat(page.style.width), height: parseFloat(page.style.height) })),
              pdfStatus: document.documentElement.dataset.printStatus,
              pdfInk: Array.from(document.querySelectorAll('.pdf-page canvas')).every(canvas => {
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                for (let index = 0; index < data.length; index += 40) if (data[index] < 200 && data[index + 3] > 0) return true;
                return false;
              })
            })`)
            const pdf = await contents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
            const entry = { source, options, snapshot, pdfBytes: pdf.length, pageCount: (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length }
            fs.writeFileSync(path.join(fixture.artifacts, `rendered-${harness.calls.length + 1}.pdf`), pdf)
            if (snapshot.tables) fs.writeFileSync(path.join(fixture.artifacts, 'print-document.png'), await contents.capturePage().then((image) => image.toPNG()))
            if (isPdf) {
              fs.writeFileSync(path.join(fixture.artifacts, 'pdf-output.pdf'), pdf)
              fs.writeFileSync(path.join(fixture.artifacts, 'pdf-document.png'), await contents.capturePage().then((image) => image.toPNG()))
            }
            harness.calls.push(entry)
            if (harness.mode === 'hold') harness.pending = callback
            else if (harness.mode === 'cancelled') callback(false, 'Print job canceled')
            else if (harness.mode === 'failed') callback(false, 'Print job failed')
            else callback(true, '')
          } catch (error) { harness.errors.push(String(error)); callback(false, 'fixture failure') }
        })()
      }
    })
  }, { ...fixture, workspace, artifacts })

  await page.reload()
  await page.getByRole('complementary', { name: '会话导航' }).getByRole('button', { name: '文档伙伴', exact: true }).click()
  await page.locator('.artifact-card').getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.locator('.artifact-preview-markdown')).toContainText('发布执行单')
  await page.getByRole('button', { name: '打印文档', exact: true }).click()
  await expect(page.locator('.artifact-preview-panel').getByRole('status')).toHaveText('已提交系统打印队列')
  const first = await app.evaluate(() => globalThis.__printingHarness.calls[0])
  assert.equal(first.options.silent, false)
  assert.equal(first.options.printBackground, true)
  assert.equal(first.snapshot.tables, 1)
  assert.equal(first.snapshot.formula, 1)
  assert.equal(first.snapshot.imageReady, true)
  assert.equal(first.snapshot.hasBridge, false)
  assert.equal(first.snapshot.hasNode, false)
  assert.ok(first.snapshot.text.includes('第 60 项') && !first.snapshot.text.includes('输入消息'))
  assert.ok(first.pdfBytes > 1000)
  await page.screenshot({ path: path.join(artifacts, 'artifact-print-entry.png') })
  console.log('✓ Artifact print entry, full Markdown/table/math/image document, no app chrome or Node bridge, native dialog options')

  // Cancellation and printer failure are distinct, and the same button retries.
  for (const [mode, expected] of [['cancelled', '已取消打印'], ['failed', '系统未能提交打印任务']]) {
    await app.evaluate((_electron, mode) => { globalThis.__printingHarness.mode = mode }, mode)
    await page.getByRole('button', { name: '打印文档', exact: true }).click()
    await expect(page.locator('.artifact-preview-panel')).toContainText(expected)
    await expect(page.getByRole('button', { name: '打印文档', exact: true })).toBeEnabled()
  }

  // A second request cannot open another native sheet while the first is pending.
  await app.evaluate(() => { globalThis.__printingHarness.mode = 'hold' })
  await page.getByRole('button', { name: '打印文档', exact: true }).click()
  await expect.poll(() => app.evaluate(() => !!globalThis.__printingHarness.pending)).toBe(true)
  await expect(page.getByRole('button', { name: '打印文档', exact: true })).toBeDisabled()
  const duplicate = await page.evaluate((id) => window.covan.printWorkspaceFile(id, 'notes.txt'), fixture.bot.id)
  assert.equal(duplicate.status, 'failed')
  assert.match(duplicate.error, /已有打印流程/)
  await app.evaluate(() => {
    const harness = globalThis.__printingHarness
    harness.pending(false, 'Print job canceled'); harness.pending = null; harness.mode = 'submitted'
  })
  await expect(page.locator('.artifact-preview-panel').getByRole('status')).toHaveText('已取消打印')

  await app.evaluate(() => { globalThis.__printingHarness.mode = 'hold' })
  await page.getByRole('button', { name: '打印文档', exact: true }).click()
  await expect.poll(() => app.evaluate(() => !!globalThis.__printingHarness.pending)).toBe(true)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((window) => window.getParentWindow())?.close()
    globalThis.__printingHarness.pending = null
    globalThis.__printingHarness.mode = 'submitted'
  })
  await expect(page.locator('.artifact-preview-panel').getByRole('status')).toHaveText('已取消打印')

  for (const file of ['notes.txt', 'sample.ts', 'local.html', 'reports/chart.svg', 'two-pages.pdf']) {
    const result = await page.evaluate(({ id, file }) => window.covan.printWorkspaceFile(id, file), { id: fixture.bot.id, file })
    assert.equal(result.status, 'submitted', `${file}: ${JSON.stringify(result)}`)
  }
  const pdfCall = await app.evaluate(() => globalThis.__printingHarness.calls.at(-1))
  assert.ok(pdfCall.source.includes('two-pages.pdf'))
  assert.equal(pdfCall.snapshot.pdfStatus, 'ready')
  assert.equal(pdfCall.snapshot.pdfPages, 2)
  assert.equal(pdfCall.snapshot.pdfInk, true, 'PDF 每一页都必须有实际渲染内容')
  assert.equal(pdfCall.pageCount, 2, '打印 PDF 保留原有页数，不增加空白页')
  assert.ok(pdfCall.snapshot.pdfSizes[0].width < pdfCall.snapshot.pdfSizes[0].height)
  assert.ok(pdfCall.snapshot.pdfSizes[1].width > pdfCall.snapshot.pdfSizes[1].height, '保留 PDF 横向页面')
  const htmlCall = await app.evaluate(() => globalThis.__printingHarness.calls.find((call) => call.source.includes('/local.html')))
  assert.equal(htmlCall.snapshot.scriptExecuted, false)
  assert.equal(htmlCall.snapshot.hasBridge, false)
  console.log('✓ Cancel/failure/retry, single-job gate, text/code/HTML/image/PDF transport')

  for (const file of ['../covan.db', '/etc/hosts', 'escape.txt', 'unsupported.docx', 'reports']) {
    const result = await page.evaluate(({ id, file }) => window.covan.printWorkspaceFile(id, file), { id: fixture.bot.id, file })
    assert.equal(result.status, 'failed', file)
  }
  const countBefore = await app.evaluate(() => globalThis.__printingHarness.calls.length)
  const unsafe = await page.evaluate((id) => window.covan.printWorkspaceFile(id, 'unsafe.html'), fixture.bot.id)
  assert.equal(unsafe.status, 'failed')
  assert.equal(await app.evaluate(() => globalThis.__printingHarness.calls.length), countBefore)
  assert.equal(remoteRequests, 0, '打印文档不能向网络发送请求')
  const tooMany = await page.evaluate((id) => window.covan.printWorkspaceFile(id, 'too-many-pages.pdf'), fixture.bot.id)
  assert.equal(tooMany.status, 'failed')
  assert.match(tooMany.error, /超过 100 页/)
  assert.equal(await app.evaluate(() => globalThis.__printingHarness.calls.length), countBefore)
  console.log('✓ Workspace traversal/symlink/unsupported paths rejected; missing external image blocks incomplete printing')

  // Existing workspace previews gain printing; local selection uses the same service.
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await page.getByRole('button', { name: '展开设置', exact: true }).click()
  await page.getByRole('button', { name: '工作区', exact: true }).click()
  await page.getByRole('button', { name: '打印 notes.txt', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('已提交系统打印队列')
  const local = path.join(profile, 'picked-local.md')
  fs.writeFileSync(local, '# 用户选择的本地文档\n\n通过系统选择器授权，随后打印。')
  await app.evaluate((_electron, file) => { globalThis.__printingHarness.selectedFile = file }, local)
  await page.getByRole('button', { name: '打开文档打印', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('已提交系统打印队列')
  await app.evaluate(() => { globalThis.__printingHarness.pickerCancelled = true })
  await page.getByRole('button', { name: '打开文档打印', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('已取消打印')
  await page.screenshot({ path: path.join(artifacts, 'workspace-printing.png') })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  assert.deepEqual(await app.evaluate(() => globalThis.__printingHarness.errors), [])
  assert.deepEqual(errors, [])
  console.log('✓ Workspace and picker UI, cancelled selection, child-window cleanup; no physical jobs sent')
  console.log('Printing Electron regression passed. Artifacts: ' + artifacts)
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  if (app) fs.writeFileSync(path.join(artifacts, 'diagnostics.json'), JSON.stringify(await app.evaluate(() => globalThis.__printingHarness?.diagnostics || []).catch(() => []), null, 2))
  throw error
} finally {
  try { await app?.close() }
  finally {
    remote.closeAllConnections()
    await new Promise((resolve) => remote.close(resolve))
    fs.rmSync(profile, { recursive: true, force: true })
  }
}
