import { useState } from 'react'
import type { WorkspaceArtifact } from '@shared/types'
import { api } from '../lib/api'
import { formatSize } from '../lib/format'
import { ChevronDownIcon, FileIcon, FolderIcon } from './icons'

interface Props {
  artifacts: WorkspaceArtifact[]
  botId: string
  streaming?: boolean
}

export function ArtifactCard({ artifacts, botId, streaming }: Props) {
  const [preview, setPreview] = useState<{
    relPath: string
    content: string
    error: boolean
  } | null>(null)
  const [loadingPath, setLoadingPath] = useState('')

  const togglePreview = async (artifact: WorkspaceArtifact) => {
    if (preview?.relPath === artifact.relPath) {
      setPreview(null)
      return
    }
    setLoadingPath(artifact.relPath)
    try {
      const content = await api.readWorkspaceFile(botId, artifact.relPath)
      setPreview({
        relPath: artifact.relPath,
        content: content || '（空文件）',
        error: false,
      })
    } catch (error) {
      setPreview({
        relPath: artifact.relPath,
        content: `无法预览：${String(error)}`,
        error: true,
      })
    } finally {
      setLoadingPath('')
    }
  }

  return (
    <section className="artifact-card" aria-label="交付文件">
      <header className="artifact-card-header">
        <span className="artifact-card-mark" aria-hidden="true">
          <FileIcon width={17} height={17} />
        </span>
        <div className="artifact-card-title">
          <strong>
            {streaming ? '正在生成' : '已交付'} {artifacts.length} 个文件
          </strong>
          <span>{streaming ? '文件写入工作区后会保留在这里' : '本轮完成的可用产物'}</span>
        </div>
        <button
          className="artifact-card-folder"
          onClick={() => void api.openWorkspace(botId)}
          title="打开工作区文件夹"
        >
          <FolderIcon width={14} height={14} />
          打开文件夹
        </button>
      </header>
      <div className="artifact-file-list">
        {artifacts.map((artifact) => {
          const expanded = preview?.relPath === artifact.relPath
          return (
            <div className="artifact-file" key={artifact.relPath}>
              <div className="artifact-file-row">
                <span className="artifact-file-icon" aria-hidden="true">
                  <FileIcon width={18} height={18} />
                </span>
                <div className="artifact-file-name">
                  <strong title={artifact.relPath}>{artifact.name}</strong>
                  <span>
                    {artifact.operation === 'edit' ? '已更新' : '已生成'} ·{' '}
                    {formatSize(artifact.size)}
                  </span>
                </div>
                <button
                  className="artifact-file-action"
                  onClick={() => void api.revealWorkspaceFile(botId, artifact.relPath)}
                  title="在文件夹中显示"
                >
                  定位
                </button>
                <button
                  className="artifact-file-action artifact-preview-toggle"
                  aria-expanded={expanded}
                  onClick={() => void togglePreview(artifact)}
                >
                  {loadingPath === artifact.relPath ? '加载中' : '预览'}
                  <ChevronDownIcon
                    width={13}
                    height={13}
                    className={expanded ? 'rotate-180' : ''}
                  />
                </button>
              </div>
              {expanded && (
                <pre
                  className={`artifact-preview selectable ${preview.error ? 'artifact-preview-error' : ''}`}
                >
                  {preview.content}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
