// components/LocalCliFields.tsx — 「运行方式」选择与本地 CLI 探测（新建 Bot / Bot 设置共用）
import { useEffect, useState } from 'react'
import type { BotBackend, CliAccess, LocalCliKind, LocalCliProbe, LocalCliModelCatalog } from '@shared/types'
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

function CliModelField({
  catalog,
  loading,
  onRefresh,
  model,
  disabled,
  onSave,
}: {
  catalog: LocalCliModelCatalog | null
  loading: boolean
  onRefresh: () => void
  model: string
  disabled?: boolean
  onSave: (model: string) => void
}) {
  const models = catalog?.models ?? []
  const listed = models.some((entry) => entry.id === model)
  const [custom, setCustom] = useState(!!model && !listed)
  const [draft, setDraft] = useState(model)
  useEffect(() => setDraft(model), [model])
  useEffect(() => {
    if (model) setCustom(!listed)
  }, [model, listed])
  const unlisted = !!model && !listed && !loading && !!models.length
  const recommended = models.find((entry) => entry.recommended)

  return (
    <div className="space-y-2">
      <Field label="CLI 模型">
        <select
          aria-label="CLI 模型"
          className={inputCls}
          value={custom || (!!model && !listed) ? 'custom' : model}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value
            setCustom(next === 'custom')
            setDraft('')
            onSave(next === 'custom' ? '' : next)
          }}
        >
          <option value="">使用 CLI 默认模型</option>
          {models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}{entry.recommended ? ' · CLI 推荐' : ''}
            </option>
          ))}
          <option value="custom">自定义模型…</option>
        </select>
      </Field>
      {custom && (
        <Field label="自定义 CLI 模型 ID">
          <input
            className={inputCls}
            value={draft}
            disabled={disabled}
            placeholder="填写当前 CLI 支持的模型 ID"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => onSave(draft.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </Field>
      )}
      <div className="flex items-center justify-between gap-2 text-[12px] text-stone-500 dark:text-stone-400">
        <span>{loading ? '正在读取 CLI 模型…' : catalog?.source === 'aliases' ? 'Claude CLI 模型别名' : '来自本机 Codex CLI'}</span>
        <button type="button" disabled={disabled || loading} onClick={onRefresh} className="shrink-0 underline underline-offset-2 disabled:opacity-40">
          刷新 CLI 模型
        </button>
      </div>
      {catalog?.error && <p role="alert" className="text-[12px] text-amber-700 dark:text-amber-300">{catalog.error}</p>}
      {unlisted && (
        <div role="alert" className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
          已保存的模型 {model} 不在当前 CLI 列表中，请选择列表中的模型或确认自定义 ID。
          {recommended && (
            <button type="button" disabled={disabled} className="mt-1 block underline underline-offset-2" onClick={() => {
              setCustom(false)
              onSave(recommended.id)
            }}>
              使用 CLI 推荐模型 {recommended.id}
            </button>
          )}
        </div>
      )}
      <p className="text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
        CLI 目录可能有缓存，最终可用性以实际回复为准；默认选项沿用 CLI 配置，自定义 ID 不做可用性保证。
      </p>
    </div>
  )
}

export function isCliBackend(backend: BotBackend): backend is LocalCliKind {
  return backend === 'codex-cli' || backend === 'claude-cli'
}

export interface LocalCliValue {
  backend: BotBackend
  cliPath: string
  cliAccess: CliAccess
  model: string
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
  const [catalog, setCatalog] = useState<LocalCliModelCatalog | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelRefresh, setModelRefresh] = useState(0)
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

  useEffect(() => {
    setCatalog(null)
    if (!kind) return
    let active = true
    setLoadingModels(true)
    const timer = setTimeout(() => {
      void api.listLocalCliModels(kind, value.cliPath.trim())
        .then((result) => { if (active) setCatalog(result) })
        .catch(() => {
          if (active) setCatalog({ source: 'cli', models: [], error: '读取 CLI 模型失败，请刷新重试。' })
        })
        .finally(() => { if (active) setLoadingModels(false) })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [kind, value.cliPath, modelRefresh])

  return (
    <>
      <Field label="运行方式">
        <select
          className={inputCls}
          value={value.backend}
          disabled={disabled}
          onChange={(e) =>
            onChange({ backend: e.target.value as BotBackend, model: '' })
          }
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
          <CliModelField
            key={kind}
            catalog={catalog}
            loading={loadingModels}
            onRefresh={() => setModelRefresh((n) => n + 1)}
            model={value.model}
            disabled={disabled}
            onSave={(model) => onChange({ model })}
          />
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
            CLI 会话，之后在同一聊天中续接；清空聊天记录、开始新话题或修改这里的配置都会重新建立会话。
            上方「CLI 模型」会保存到该 Bot，并在首次和后续发言时传给 CLI；修改模型后会重新建立会话。
          </p>
        </div>
      )}
    </>
  )
}
