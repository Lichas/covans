// Source validation and printable markup; no Electron or printer dependency.
import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { artifactPreviewKind, type ArtifactPreviewKind } from '../../shared/documentFormats'

export const MAX_PRINT_TEXT = 2 * 1024 * 1024
export const MAX_PRINT_BINARY = 32 * 1024 * 1024

export interface PrintDocument {
  file: string
  root: string
  relative: string
  name: string
  kind: Exclude<ArtifactPreviewKind, 'unsupported'>
  bytes: Buffer
}

export function withinDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function readPrintDocument(file: string, boundary = path.dirname(file)): PrintDocument {
  const root = fs.realpathSync(boundary)
  const real = fs.realpathSync(file)
  if (!withinDirectory(root, real)) throw new Error('文档路径越界，请重新选择文件')
  const stat = fs.statSync(real)
  if (!stat.isFile()) throw new Error('请选择文档文件，不能打印目录')
  const kind = artifactPreviewKind(real)
  if (kind === 'unsupported') throw new Error('暂不支持打印此格式；Office 文档请先导出为 PDF')
  const text = !['image', 'pdf'].includes(kind)
  if (stat.size > (text ? MAX_PRINT_TEXT : MAX_PRINT_BINARY)) {
    throw new Error(text ? '文本文件超过 2MB，无法打印' : '文件超过 32MB，无法打印')
  }
  const bytes = fs.readFileSync(real)
  if (text && bytes.includes(0)) throw new Error('二进制文件不能作为文本打印')
  if (kind === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw new Error('PDF 文件无效，请检查文件内容')
  }
  return { file: real, root, relative: path.relative(root, real).split(path.sep).join('/'), name: path.basename(real), kind, bytes }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export const PRINT_CSS = `
@page { margin: 16mm; }
:root { color-scheme: light; }
html, body { margin: 0; background: white; color: #18181b; }
body { padding: 28px; font: 14px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
h1, h2, h3, h4 { line-height: 1.35; break-after: avoid-page; }
h1 { font-size: 26px; } h2 { font-size: 20px; } h3 { font-size: 16px; }
p, li { orphans: 3; widows: 3; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
thead { display: table-header-group; } tr { break-inside: avoid; }
th, td { border: 1px solid #d4d4d8; padding: 7px 10px; text-align: left; overflow-wrap: anywhere; }
th { background: #f4f4f5; } blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid #d4d4d8; color: #52525b; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #f4f4f5; font-size: 11px; }
code { font-family: ui-monospace, monospace; } img, svg { max-width: 100%; height: auto; }
img { break-inside: avoid; } a { color: inherit; text-decoration: underline; }
input[type=checkbox] { accent-color: #52525b; } .print-image { display: block; margin: 0 auto; max-height: 245mm; object-fit: contain; }
@media print { body { padding: 0; } a { text-decoration: none; } }
`

export function printableHtml(document: PrintDocument, katexCssUrl: string): string {
  const content = document.bytes.toString('utf8')
  let body: string
  if (document.kind === 'markdown') {
    body = renderToStaticMarkup(createElement(ReactMarkdown, {
      children: content,
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [[rehypeKatex, { throwOnError: false, strict: false }]],
      skipHtml: true,
      urlTransform: (url) => url,
    }))
  } else if (document.kind === 'html') {
    body = content
  } else if (document.kind === 'image') {
    body = `<img class="print-image" src="${escapeHtml(encodeURIComponent(path.basename(document.file)))}" alt="${escapeHtml(document.name)}">`
  } else {
    body = `<pre>${escapeHtml(content)}</pre>`
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(document.name)}</title><link rel="stylesheet" href="${escapeHtml(katexCssUrl)}"><style>${PRINT_CSS}</style></head><body>${body}</body></html>`
}

const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
}

/** Every asset read rechecks realpath; HTML cannot read arbitrary local files. */
export function readPrintAsset(root: string, relative: string): { bytes: Buffer; mime: string } {
  if (!relative || path.isAbsolute(relative) || relative.includes('\0')) throw new Error('无效资源路径')
  const file = fs.realpathSync(path.resolve(root, relative))
  if (!withinDirectory(fs.realpathSync(root), file)) throw new Error('打印资源路径越界')
  const mime = ASSET_MIME[path.extname(file).toLowerCase()]
  const stat = fs.statSync(file)
  if (!mime || !stat.isFile() || stat.size > MAX_PRINT_BINARY) throw new Error('打印资源不受支持')
  return { bytes: fs.readFileSync(file), mime }
}
