import {
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { api } from '../lib/api'
import { formatSize } from '../lib/format'
import {
  artifactPreviewKind,
  fencedCode,
  languageForPath,
  workspaceFileUrl,
  type ArtifactPreviewKind,
} from '../lib/workspacePreview'
import { useUiStore } from '../stores/uiStore'
import { CloseIcon, FileIcon, FolderIcon, PrinterIcon } from './icons'
import { MarkdownContent } from './MarkdownContent'
import { useDocumentPrinting } from '../lib/useDocumentPrinting'

type TextState =
  | { status: 'idle'; content: string; error: string }
  | { status: 'loading'; content: string; error: string }
  | { status: 'ready'; content: string; error: string }
  | { status: 'error'; content: string; error: string }

function displayKind(kind: ArtifactPreviewKind) {
  switch (kind) {
    case 'markdown':
      return 'Markdown'
    case 'html':
      return 'HTML'
    case 'text':
      return 'TXT'
    case 'code':
      return 'Code'
    case 'image':
      return 'Image'
    case 'pdf':
      return 'PDF'
    default:
      return 'File'
  }
}

function isTextKind(kind: ArtifactPreviewKind) {
  return kind === 'markdown' || kind === 'html' || kind === 'text' || kind === 'code'
}

const MIN_PREVIEW_WIDTH = 360
const MAX_PREVIEW_WIDTH = 1040
const RESIZE_STEP = 32

function clampPreviewWidth(width: number) {
  const viewportMax =
    typeof window === 'undefined'
      ? MAX_PREVIEW_WIDTH
      : Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, window.innerWidth - 420))
  return Math.min(viewportMax, Math.max(MIN_PREVIEW_WIDTH, Math.round(width)))
}

export function ArtifactPreviewPanel() {
  const target = useUiStore((s) => s.artifactPreview)
  const previewWidth = useUiStore((s) => s.artifactPreviewWidth)
  const setArtifactPreview = useUiStore((s) => s.setArtifactPreview)
  const setArtifactPreviewWidth = useUiStore((s) => s.setArtifactPreviewWidth)
  const [text, setText] = useState<TextState>({
    status: 'idle',
    content: '',
    error: '',
  })

  const artifact = target?.artifact
  const printing = useDocumentPrinting(`${target?.botId}/${artifact?.relPath}`)
  const kind = useMemo(
    () => (artifact ? artifactPreviewKind(artifact.relPath) : 'unsupported'),
    [artifact],
  )
  const fileUrl = useMemo(
    () => (target ? workspaceFileUrl(target.botId, target.artifact.relPath) : ''),
    [target],
  )

  useEffect(() => {
    if (!target) {
      setText({ status: 'idle', content: '', error: '' })
      return
    }
    if (!isTextKind(kind)) {
      setText({ status: 'idle', content: '', error: '' })
      return
    }
    let alive = true
    setText({ status: 'loading', content: '', error: '' })
    void api
      .readWorkspaceFile(target.botId, target.artifact.relPath)
      .then((content) => {
        if (alive) setText({ status: 'ready', content, error: '' })
      })
      .catch((error) => {
        if (!alive) return
        setText({
          status: 'error',
          content: '',
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      alive = false
    }
  }, [kind, target])

  if (!target || !artifact) return null

  const emptyText = text.status === 'ready' && !text.content
  const commitWidth = (width: number) => setArtifactPreviewWidth(clampPreviewWidth(width))
  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = clampPreviewWidth(previewWidth)
    const onMove = (moveEvent: PointerEvent) => {
      commitWidth(startWidth + startX - moveEvent.clientX)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('resizing-artifact-preview')
    }
    document.body.classList.add('resizing-artifact-preview')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  return (
    <aside
      className="artifact-preview-panel"
      aria-label="产物预览"
      style={{ width: clampPreviewWidth(previewWidth) }}
    >
      <button
        type="button"
        className="artifact-preview-resizer"
        role="separator"
        aria-label="调整产物预览宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_PREVIEW_WIDTH}
        aria-valuemax={MAX_PREVIEW_WIDTH}
        aria-valuenow={clampPreviewWidth(previewWidth)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            commitWidth(
              useUiStore.getState().artifactPreviewWidth + RESIZE_STEP,
            )
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            commitWidth(
              useUiStore.getState().artifactPreviewWidth - RESIZE_STEP,
            )
          }
        }}
      />
      <header className="artifact-preview-panel-header">
        <span className="artifact-preview-panel-icon" aria-hidden="true">
          <FileIcon width={17} height={17} />
        </span>
        <div className="artifact-preview-panel-title">
          <strong title={artifact.relPath}>{artifact.name}</strong>
          <span>
            {displayKind(kind)} · {formatSize(artifact.size)}
          </span>
        </div>
        <button
          className="artifact-preview-panel-button"
          disabled={printing.busy || kind === 'unsupported'}
          aria-label="打印文档"
          onClick={() => void printing.print(() => api.printWorkspaceFile(target.botId, artifact.relPath))}
          title="打印文档 · 使用系统已添加的打印机"
        >
          <PrinterIcon width={17} height={17} />
        </button>
        <button
          className="artifact-preview-panel-button"
          onClick={() => void api.revealWorkspaceFile(target.botId, artifact.relPath)}
          title="在文件夹中显示"
        >
          <FolderIcon width={17} height={17} />
        </button>
        <button
          className="artifact-preview-panel-button"
          onClick={() => setArtifactPreview(null)}
          title="关闭预览"
        >
          <CloseIcon width={17} height={17} />
        </button>
      </header>
      {printing.message && (
        <p role={printing.failed ? 'alert' : 'status'} className={`px-4 py-2 text-[12px] ${printing.failed ? 'text-red-600' : 'text-stone-500'}`}>
          {printing.message}
        </p>
      )}

      <div className="artifact-preview-panel-body scroll-thin">
        {text.status === 'loading' && (
          <div className="artifact-preview-state">正在载入预览...</div>
        )}
        {text.status === 'error' && (
          <div className="artifact-preview-state artifact-preview-error">
            {text.error || '无法预览这个文件'}
          </div>
        )}
        {emptyText && <div className="artifact-preview-state">空文件</div>}
        {text.status === 'ready' && kind === 'markdown' && text.content && (
          <div className="artifact-preview-markdown">
            <MarkdownContent content={text.content} />
          </div>
        )}
        {text.status === 'ready' && kind === 'html' && (
          <iframe
            className="artifact-preview-frame"
            title={artifact.name}
            sandbox=""
            srcDoc={text.content}
          />
        )}
        {text.status === 'ready' && kind === 'text' && text.content && (
          <pre className="artifact-preview-text selectable">{text.content}</pre>
        )}
        {text.status === 'ready' && kind === 'code' && text.content && (
          <div className="artifact-preview-code">
            <MarkdownContent
              content={fencedCode(
                text.content,
                languageForPath(artifact.relPath),
              )}
            />
          </div>
        )}
        {kind === 'image' && (
          <div className="artifact-preview-image-wrap">
            <img className="artifact-preview-image" src={fileUrl} alt={artifact.name} />
          </div>
        )}
        {kind === 'pdf' && (
          <iframe className="artifact-preview-frame" title={artifact.name} src={fileUrl} />
        )}
        {kind === 'unsupported' && (
          <div className="artifact-preview-state">
            这个文件类型暂不支持预览，请用文件夹打开。
          </div>
        )}
      </div>
    </aside>
  )
}
