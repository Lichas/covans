// components/LocalCliFields.tsx — 本地 CLI 的权限分段控件（新建 Bot / Bot 设定共用）
//
// 运行方式、模型目录和可执行文件路径已经并入 ModelPicker 的轨道与列表；这里只保留
// 「文件权限」这一项独立设置，用分段控件直接呈现，不再折叠进下拉框。
import type { CliAccess } from '@shared/types'
import { isCliBackend } from './ModelPicker'

export { isCliBackend }

const ACCESS_OPTIONS: { value: CliAccess; label: string; hint: string }[] = [
  { value: 'read-only', label: '只读', hint: '可以查看文件，不能修改' },
  { value: 'workspace-write', label: '可写', hint: '可在该 Bot 工作区内改文件' },
]

export function CliAccessSegmented({
  value,
  disabled,
  label = '文件权限',
  onChange,
}: {
  value: CliAccess
  disabled?: boolean
  label?: string
  onChange: (next: CliAccess) => void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {ACCESS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          data-cli-access={option.value}
          aria-pressed={value === option.value}
          disabled={disabled}
          title={option.hint}
          onClick={() => onChange(option.value)}
          className={`segmented-item shape-rect${value === option.value ? ' is-selected' : ''}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
