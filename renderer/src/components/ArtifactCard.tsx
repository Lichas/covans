import type { WorkspaceArtifact } from '@shared/types'
import { api } from '../lib/api'
import { formatSize } from '../lib/format'
import { useUiStore } from '../stores/uiStore'
import { FileIcon, FolderIcon } from './icons'

interface Props {
  artifacts: WorkspaceArtifact[]
  botId: string
  streaming?: boolean
}

export function ArtifactCard({ artifacts, botId, streaming }: Props) {
  const artifactPreview = useUiStore((s) => s.artifactPreview)
  const setArtifactPreview = useUiStore((s) => s.setArtifactPreview)

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
          const selected =
            artifactPreview?.botId === botId &&
            artifactPreview.artifact.relPath === artifact.relPath
          return (
            <div
              className={`artifact-file ${selected ? 'artifact-file-selected' : ''}`}
              key={artifact.relPath}
            >
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
                  className="artifact-file-action"
                  aria-pressed={selected}
                  onClick={() => setArtifactPreview({ botId, artifact })}
                >
                  预览
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
