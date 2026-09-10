// components/WorkspacePanel.tsx — 右栏「工作区」标签页：文件树（深度2）+ 预览 + 打开文件夹
import { useEffect, useState } from 'react'
import type { WorkspaceFile } from '@shared/types'
import { api } from '../lib/api'
import { formatSize } from '../lib/format'
import { FileIcon, FolderIcon, RefreshIcon } from './icons'

export function WorkspacePanel({ botId }: { botId: string }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setFiles(await api.listWorkspaceFiles(botId))
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    setPreview(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId])

  useEffect(() => {
    return api.onEvent((event) => {
      if (event.type === 'workspace-updated' && event.botId === botId) void load()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId])

  const openFile = async (f: WorkspaceFile) => {
    if (f.isDir) return
    setLoadingPreview(true)
    try {
      const content = await api.readWorkspaceFile(botId, f.relPath)
      setPreview({ path: f.relPath, content })
    } catch (e) {
      setPreview({ path: f.relPath, content: `（无法预览：${String(e)}）` })
    } finally {
      setLoadingPreview(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="text-[12.5px] text-stone-500 dark:text-stone-400">Bot 的专属文件工作区</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => void load()}
            className="rounded-lg border border-stone-300 p-1.5 text-stone-500 transition hover:bg-stone-100 dark:border-stone-600 dark:hover:bg-stone-700"
            title="刷新"
          >
            <RefreshIcon width={13} height={13} />
          </button>
          <button
            onClick={() => void api.openWorkspace(botId)}
            className="flex items-center gap-1 rounded-lg border border-stone-300 px-2 py-1 text-[12px] text-stone-600 transition hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700"
          >
            <FolderIcon width={13} height={13} />
            打开文件夹
          </button>
        </div>
      </div>

      <div className="scroll-thin mt-2 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        {error && <div className="px-1 py-4 text-center text-[12px] text-red-500">{error}</div>}
        {!error && files.length === 0 && (
          <div className="py-8 text-center text-[12.5px] text-stone-400">工作区还是空的</div>
        )}
        {files.map((f) => (
          <div key={f.relPath}>
            <button
              onClick={() => void openFile(f)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${
                preview?.path === f.relPath
                  ? 'bg-stone-200/80 dark:bg-stone-700/70'
                  : 'hover:bg-stone-100 dark:hover:bg-stone-800'
              } ${f.isDir ? 'cursor-default' : ''}`}
            >
              {f.isDir ? (
                <FolderIcon width={15} height={15} className="shrink-0 text-amber-500" />
              ) : (
                <FileIcon width={15} height={15} className="shrink-0 text-stone-400" />
              )}
              <span className="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-200">{f.name}</span>
              {!f.isDir && <span className="shrink-0 text-[10.5px] text-stone-400">{formatSize(f.size)}</span>}
            </button>
            {/* 文件预览 */}
            {preview?.path === f.relPath && (
              <pre className="selectable scroll-thin mx-1 mb-1 mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-100 p-2.5 font-mono text-[11.5px] leading-relaxed text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                {loadingPreview ? '加载中…' : preview.content || '（空文件）'}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
