import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { escapeHtml, withinDirectory } from './document'

const require = createRequire(import.meta.url)
const pdfJsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'))

// Application-owned module, served only in a print session. PDF JavaScript and
// actions are never evaluated; PDF.js is used solely to render printable pages.
export const PDF_BOOTSTRAP = String.raw`
const base = new URL('./', import.meta.url);
let task;
try {
  // Dynamic import also prevents electron-vite 2's regex-based CJS shim from
  // mistaking an import inside this source string for a main-process import.
  const { getDocument, GlobalWorkerOptions } = await import('./legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = new URL('legacy/build/pdf.worker.mjs', base).href;
  const response = await fetch(new URL('../__source.pdf', base));
  if (!response.ok) throw new Error('无法读取 PDF');
  task = getDocument({
    data: new Uint8Array(await response.arrayBuffer()),
    isEvalSupported: false, useWasm: false,
    useSystemFonts: true, cMapPacked: true,
    cMapUrl: new URL('cmaps/', base).href,
    standardFontDataUrl: new URL('standard_fonts/', base).href,
  });
  task.onPassword = () => {
    document.documentElement.dataset.printError = 'PDF 已加密，请先解锁并另存后打印';
    document.documentElement.dataset.printStatus = 'failed';
    void task.destroy();
  };
  const pdf = await task.promise;
  if (pdf.numPages > 100) throw new Error('PDF 超过 100 页，请拆分后打印');
  let pixels = 0;
  const pageStyles = document.createElement('style');
  document.head.append(pageStyles);
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const physical = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 2 });
    pixels += Math.ceil(viewport.width) * Math.ceil(viewport.height);
    if (pixels > 120000000) throw new Error('PDF 页面总尺寸过大，请拆分后打印');
    const section = document.createElement('section');
    section.className = 'pdf-page';
    section.style.page = 'pdf-page-' + number;
    section.style.width = physical.width + 'pt';
    section.style.height = physical.height + 'pt';
    pageStyles.sheet.insertRule('@page pdf-page-' + number + ' { size: ' + physical.width + 'pt ' + physical.height + 'pt; margin: 0; }');
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    section.append(canvas);
    document.body.append(section);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, intent: 'print', background: 'rgb(255,255,255)' }).promise;
    page.cleanup();
  }
  await document.fonts.ready;
  document.documentElement.dataset.printPages = String(pdf.numPages);
  document.documentElement.dataset.printStatus = 'ready';
  document.querySelector('[role=status]')?.remove();
  await task.destroy();
} catch (error) {
  document.documentElement.dataset.printError ||= error?.name === 'PasswordException'
    ? 'PDF 已加密，请先解锁并另存后打印'
    : /^PDF (超过 100 页|页面总尺寸过大)/.test(error?.message || '') ? error.message
    : 'PDF 无法完成渲染，请检查文件是否有效，或拆分为较小文档后重试';
  document.documentElement.dataset.printStatus = 'failed';
  if (task) await task.destroy().catch(() => {});
}
`

export function printablePdfHtml(name: string, scriptUrl: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(name)}</title><style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; background: white; }
    .pdf-page { break-after: page; break-inside: avoid; overflow: hidden; }
    .pdf-page:last-child { break-after: auto; }
    canvas { display: block; width: 100%; height: 100%; }
    @media screen { body { background: #e4e4e7; } .pdf-page { background: white; margin: 0 auto 12px; } }
  </style></head><body><p role="status">正在准备 PDF…</p><script type="module" src="${escapeHtml(scriptUrl)}"></script></body></html>`
}

export function readPdfJsAsset(relative: string): { bytes: Buffer; mime: string } {
  const allowed = /^(legacy\/build\/(pdf|pdf\.worker)\.mjs|cmaps\/[\w-]+\.bcmap|standard_fonts\/[\w.-]+\.(pfb|ttf))$/
  if (!allowed.test(relative)) throw new Error('不支持的 PDF 资源')
  const file = fs.realpathSync(path.join(pdfJsRoot, relative))
  if (!withinDirectory(pdfJsRoot, file)) throw new Error('PDF 资源路径越界')
  return { bytes: fs.readFileSync(file), mime: relative.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream' }
}
