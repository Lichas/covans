import fs from 'node:fs'
import path from 'node:path'

export function runPrintingRegression(printing, tmp, assert) {
  const root = path.join(tmp, 'printing')
  fs.mkdirSync(root)
  const file = path.join(root, 'report.md')
  fs.writeFileSync(file, '# 发布计划\n\n|任务|负责人|\n|---|---|\n|检查|伙伴|\n\n- [x] 已确认\n\n$x^2$\n\n<script>globalThis.bad=true</script>')
  const doc = printing.readPrintDocument(file, root)
  const html = printing.printableHtml(doc, 'covan-print://document/test/__katex/dist/katex.min.css')
  assert(html.includes('<table>') && html.includes('type="checkbox"') && html.includes('class="katex"'), '打印 Markdown 保留表格、任务列表和公式')
  assert(!html.includes('<script>') && html.includes('@page') && !html.includes('message-composer'), '打印使用纯文档分页样式，Markdown 不执行 HTML')
  const rejects = (label, action) => {
    let rejected = false
    try { action() } catch { rejected = true }
    assert(rejected, label)
  }
  fs.writeFileSync(path.join(root, 'code.ts'), '<script>bad()</script>')
  assert(printing.printableHtml(printing.readPrintDocument(path.join(root, 'code.ts')), '').includes('&lt;script&gt;'), '打印代码和文本进行 HTML 转义')
  fs.writeFileSync(path.join(root, 'binary.txt'), Buffer.from([65, 0, 66]))
  fs.writeFileSync(path.join(root, 'bad.pdf'), 'not a PDF')
  fs.writeFileSync(path.join(root, 'office.docx'), 'unsupported')
  fs.writeFileSync(path.join(root, 'huge.txt'), Buffer.alloc(printing.MAX_PRINT_TEXT + 1))
  rejects('打印拒绝二进制伪装文本', () => printing.readPrintDocument(path.join(root, 'binary.txt')))
  rejects('打印拒绝无效 PDF', () => printing.readPrintDocument(path.join(root, 'bad.pdf')))
  rejects('打印明确拒绝尚未转换的 Office 文件', () => printing.readPrintDocument(path.join(root, 'office.docx')))
  rejects('打印限制文本大小', () => printing.readPrintDocument(path.join(root, 'huge.txt')))
  rejects('打印拒绝目录', () => printing.readPrintDocument(root))
  const outside = path.join(tmp, 'private.css')
  fs.writeFileSync(outside, 'body{}')
  fs.symlinkSync(outside, path.join(root, 'escape.css'))
  rejects('打印资源拒绝符号链接逃逸', () => printing.readPrintAsset(root, 'escape.css'))
  rejects('打印资源拒绝相对路径越界', () => printing.readPrintAsset(root, '../private.css'))
  rejects('打印资源拒绝绝对路径', () => printing.readPrintAsset(root, outside))
  rejects('打印资源不能读取普通文本文档', () => printing.readPrintAsset(root, 'report.md'))
  rejects('打印源文件拒绝边界外路径', () => printing.readPrintDocument(outside, root))
  fs.writeFileSync(path.join(root, 'local.css'), 'body{color:black}')
  assert(printing.readPrintAsset(root, 'local.css').mime === 'text/css', '打印允许边界内样式资源')
}
