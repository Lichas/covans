// components/LocalCliFields.tsx — 「运行方式」选择与本地 CLI 探测（新建 Bot / Bot 设置共用）
import { useEffect, useState } from 'react'
import type { BotBackend, CliAccess, LocalCliKind, LocalCliProbe } from '@shared/types'
import { api } from '../lib/api'
import { Field, inputCls } from './controls'

const BACKEND_OPTIONS: { value: BotBackend; label: string }[] = [
  { value: 'api', label: '模型 API（Provider）' },
  { value: 'codex-cli', label: '本地 Codex CLI' },
  { value: 'claude-cli', label: '本地 Claude CLI' },
]

const ACCESS_OPTIONS: { value: CliAccess; label: string }[] = [
  { value: 'read-only', label: '只读：可以查看文件，不能修改' },
  { value: 'workspace-write', label: '可写：可在该 Bot 工作区内改文件' },
]

export function isCliBackend(backend: BotBackend): backend is LocalCliKind {
  return backend === 'codex-cli' || backend === 'claude-cli'
}

export interface LocalCliValue {
  backend: BotBackend
  cliPath: string
  cliAccess: CliAccess
}

export function LocalCliFields({
  value,
  disabled,
  onChange,
}: {
  value: LocalCliValue
  disabled?: boolean
  onChange: (patch: Partial<LocalCliValue>) => void
}) {
  const [probe, setProbe] = useState<LocalCliProbe | null>(null)
  const [probing, setProbing] = useState(false)
  const kind = isCliBackend(value.backend) ? value.backend : null

  useEffect(() => {
    if (!kind) {
      setProbe(null)
      return
    }
    let active = true
    setProbing(true)
    setProbe(null)
    api
      .probeLocalCli(kind, value.cliPath.trim())
      .then((result) => {
        if (active) setProbe(result)
      })
      .catch((e) => {
        if (active)
          setProbe({
            kind,
            available: false,
            path: '',
            version: '',
            error: String(e),
          })
      })
      .finally(() => {
        if (active) setProbing(false)
      })
    return () => {
      active = false
    }
  }, [kind, value.cliPath])

  return (
    <>
      <Field label="运行方式">
        <select
          className={inputCls}
          value={value.backend}
          disabled={disabled}
          onChange={(e) => onChange({ backend: e.target.value as BotBackend })}
        >
          {BACKEND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      {kind && (
        <div className="space-y-3 rounded-lg border border-stone-200 px-3 py-3 dark:border-stone-700">
          <Field label="CLI 可执行文件（留空自动查找）">
            <input
              className={inputCls}
              value={value.cliPath}
              disabled={disabled}
              onChange={(e) => onChange({ cliPath: e.target.value })}
              placeholder={kind === 'codex-cli' ? 'codex' : 'claude'}
            />
          </Field>
          <div
            role="status"
            className="text-[12px] leading-relaxed text-stone-500 dark:text-stone-400"
          >
            {probing
              ? '正在检测…'
              : probe?.available
                ? `已安装${probe.version ? ` · 版本 ${probe.version}` : ''}`
                : probe
                  ? probe.error || '未检测到'
                  : ''}
            {probe?.available && probe.path && (
              <span className="mt-0.5 block truncate opacity-70">
                {probe.path}
              </span>
            )}
          </div>
          <Field label="文件权限">
            <select
              className={inputCls}
              value={value.cliAccess}
              disabled={disabled}
              onChange={(e) =>
                onChange({ cliAccess: e.target.value as CliAccess })
              }
            >
              {ACCESS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
            正文由该 CLI 用它自己的登录与额度生成，Covan 仍会注入人设、记忆和最近对话。首次发言会建立一个
            CLI 会话，之后在同一聊天中续接；清空聊天记录或开始新话题会重新建立会话。
          </p>
        </div>
      )}
    </>
  )
}
