// components/ModelPicker.tsx — 模型选择器：左侧 Provider / 本地 CLI 轨，右侧模型列表
//
// 借鉴 OpenMausBot 的 SimpleModelPane：Provider 轨只负责切换浏览对象，真正的
// 变更发生在点选某个模型或底部「跟随来源默认」时，因此浏览别家 Provider
// 不会顺手清掉 Bot 已保存的模型。新建 Bot 时还没有已保存状态，轨的点击会直接
// 提交运行方式（commitEngineOnBrowse），与旧的下拉框行为一致。
import { useEffect, useRef, useState } from 'react'
import type {
  BotBackend,
  LocalCliKind,
  LocalCliModelCatalog,
  LocalCliProbe,
  ProviderKind,
} from '@shared/types'
import { api } from '../lib/api'
import { useSettingsStore } from '../stores/settingsStore'
import { CheckIcon, ProviderIcon, RefreshIcon } from './icons'

export interface ModelPickerValue {
  backend: BotBackend
  providerId: string | null
  model: string
  cliPath: string
}

export interface ModelPickerNext {
  backend: BotBackend
  provider_id: string | null
  model: string
}

const CLI_KINDS: { kind: LocalCliKind; label: string }[] = [
  { kind: 'codex-cli', label: 'Codex CLI' },
  { kind: 'claude-cli', label: 'Claude CLI' },
]

/** 这三类 Provider 允许留空 Key（本地服务或假 Provider）。 */
const KEYLESS_KINDS = new Set<ProviderKind>(['mock', 'lm-studio', 'openai-compatible'])

type RailKey = `provider:${string}` | `cli:${LocalCliKind}`

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isCliBackend(backend: BotBackend): backend is LocalCliKind {
  return backend === 'codex-cli' || backend === 'claude-cli'
}

/** Bot 当前模型来源的展示名，用于「默认模型」行的摘要。 */
export function describeBotModel(
  backend: BotBackend,
  providers: { id: string; name: string; kind: ProviderKind; default_model?: string }[],
  providerId: string | null,
  model: string,
): string {
  if (isCliBackend(backend)) {
    const label = CLI_KINDS.find((entry) => entry.kind === backend)?.label ?? backend
    return `${label} · ${model || '跟随 CLI 配置（未指定模型）'}`
  }
  const provider = providers.find((entry) => entry.id === providerId)
  if (!provider) return model || '未选择 Provider'
  return `${provider.name} · ${model || provider.default_model || 'Provider 未设置默认模型'}`
}

export function ModelPicker({
  value,
  disabled,
  botModel,
  commitEngineOnBrowse = true,
  showCliConfig = true,
  onChange,
  onCliPath,
}: {
  value: ModelPickerValue
  disabled?: boolean
  /** Bot 已保存的模型：命中该模型的行走「(Bot 的模型)」标记。 */
  botModel?: string
  /** 点击轨道即提交运行方式（新建 Bot）；Bot 设置里为 false，先浏览后点选。 */
  commitEngineOnBrowse?: boolean
  showCliConfig?: boolean
  onChange: (next: ModelPickerNext) => void
  onCliPath?: (path: string) => void
}) {
  const providers = useSettingsStore((s) => s.providers)
  const cliKind = isCliBackend(value.backend) ? value.backend : null

  // 轨道选择：默认落在 Bot 当前的模型来源上。
  const committedRail: RailKey = cliKind
    ? `cli:${cliKind}`
    : `provider:${value.providerId ?? ''}`
  const [browsedRail, setBrowsedRail] = useState<RailKey | null>(null)
  useEffect(() => {
    setBrowsedRail(null)
  }, [value.backend, value.providerId])
  const rail = browsedRail ?? committedRail
  const railCli: LocalCliKind | null = rail.startsWith('cli:')
    ? (rail.slice(4) as LocalCliKind)
    : null
  const railProvider = rail.startsWith('provider:')
    ? providers.find((entry) => entry.id === rail.slice(9)) ?? null
    : null

  const [probe, setProbe] = useState<LocalCliProbe | null>(null)
  const [probing, setProbing] = useState(false)
  const [catalog, setCatalog] = useState<LocalCliModelCatalog | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [catalogNonce, setCatalogNonce] = useState(0)
  const [loadingModels, setLoadingModels] = useState(false)
  const [refreshingProviders, setRefreshingProviders] = useState(false)
  const providerCache = useRef(new Map<string, { models: string[]; error: string }>())
  const [, bumpProviderCache] = useState(0)
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  // 本地 CLI 探测：只探测当前浏览的 CLI，结果留在缓存里供另一条轨显示。
  const probeCache = useRef(new Map<string, LocalCliProbe>())
  useEffect(() => {
    if (!railCli) {
      setProbe(null)
      setProbing(false)
      return
    }
    const cacheKey = `${railCli}:${value.cliPath.trim()}`
    const cached = probeCache.current.get(cacheKey)
    if (cached) {
      setProbe(cached)
      setProbing(false)
      return
    }
    let active = true
    setProbing(true)
    setProbe(null)
    api
      .probeLocalCli(railCli, value.cliPath.trim())
      .then((result) => {
        probeCache.current.set(cacheKey, result)
        if (active) setProbe(result)
      })
      .catch((error) => {
        const result: LocalCliProbe = {
          kind: railCli,
          available: false,
          path: '',
          version: '',
          error: errorText(error),
        }
        probeCache.current.set(cacheKey, result)
        if (active) setProbe(result)
      })
      .finally(() => {
        if (active) setProbing(false)
      })
    return () => {
      active = false
    }
  }, [railCli, value.cliPath])

  // CLI 模型目录：与探测共用路径，250ms 防抖避免边输入边拉取。
  useEffect(() => {
    setCatalog(null)
    if (!railCli) return
    let active = true
    setLoadingCatalog(true)
    const timer = setTimeout(() => {
      void api
        .listLocalCliModels(railCli, value.cliPath.trim())
        .then((result) => {
          if (active) setCatalog(result)
        })
        .catch(() => {
          if (active)
            setCatalog({
              source: 'cli',
              models: [],
              error: '读取 CLI 模型失败，请刷新重试。',
            })
        })
        .finally(() => {
          if (active) setLoadingCatalog(false)
        })
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [railCli, value.cliPath, catalogNonce])

  // Provider 模型目录：按 Provider 缓存，切换轨道不重复请求。
  useEffect(() => {
    if (railCli || !railProvider) return
    const id = railProvider.id
    if (providerCache.current.has(id) && !refreshingProviders) return
    let active = true
    setLoadingModels(true)
    api
      .listProviderModels(id)
      .then((models) => {
        if (!active) return
        providerCache.current.set(id, { models, error: '' })
        bumpProviderCache((n) => n + 1)
      })
      .catch((error) => {
        if (!active) return
        providerCache.current.set(id, { models: [], error: errorText(error) })
        bumpProviderCache((n) => n + 1)
      })
      .finally(() => {
        if (!active) return
        setLoadingModels(false)
        setRefreshingProviders(false)
      })
    return () => {
      active = false
    }
  }, [railCli, railProvider, refreshingProviders])

  const cachedProvider = railProvider
    ? providerCache.current.get(railProvider.id)
    : undefined
  const apiModels = cachedProvider?.models ?? []
  const apiError = cachedProvider?.error ?? ''
  const cliModels = catalog?.models ?? []
  const cliError = catalog?.error ?? ''

  const engineDefault = railCli
    ? ''
    : (railProvider?.default_model ?? '')
  const recommended = railCli ? cliModels.find((entry) => entry.recommended) : undefined
  const selectedId = value.model

  const models = railCli ? cliModels.map((entry) => entry.id) : apiModels
  // 引擎默认模型置顶：列表可能有几十项，先让「默认」和「CLI 推荐」可见。
  const pinnedId = railCli ? (recommended?.id ?? '') : engineDefault
  const orderedModels =
    pinnedId && models.includes(pinnedId)
      ? [pinnedId, ...models.filter((id) => id !== pinnedId)]
      : models
  const listed = models.includes(selectedId)
  const selectedRail = rail === committedRail
  const effectiveModel = describeBotModel(value.backend, providers, value.providerId, value.model)
  /** 底部按钮只在「当前来源 + 无显式模型」时才算选中。 */
  const usesEngineDefault = !value.model && selectedRail

  const commit = (next: { backend: BotBackend; providerId: string | null; model: string }) => {
    if (disabled) return
    onChange({ backend: next.backend, provider_id: next.providerId, model: next.model })
    setCustom(false)
  }

  const chooseRail = (next: RailKey) => {
    if (disabled) return
    if (next === rail) return
    setBrowsedRail(next)
    setCustom(false)
    if (!commitEngineOnBrowse) return
    if (next.startsWith('cli:')) {
      const kind = next.slice(4) as LocalCliKind
      commit({ backend: kind, providerId: value.providerId, model: '' })
    } else {
      commit({ backend: 'api', providerId: next.slice(9), model: '' })
    }
  }

  const commitModel = (model: string) => {
    if (railCli) commit({ backend: railCli, providerId: value.providerId, model })
    else commit({ backend: 'api', providerId: railProvider?.id ?? null, model })
  }

  /** 使用当前浏览来源的默认模型：Provider 默认 / CLI 默认。 */
  const useEngineDefault = () => commitModel('')

  const railItem = (
    key: RailKey,
    label: string,
    options: { icon?: React.ReactNode; unavailable?: string },
  ) => {
    const selected = rail === key
    return (
      <button
        key={key}
        type="button"
        data-rail={key}
        data-rail-unavailable={options.unavailable ? 'true' : undefined}
        aria-pressed={selected}
        title={options.unavailable ? `${label} · ${options.unavailable}` : label}
        disabled={disabled}
        onClick={() => chooseRail(key)}
        className={`model-rail-item shape-rect${selected ? ' is-selected' : ''}${options.unavailable ? ' is-unavailable' : ''}`}
      >
        {options.icon}
        <span className="model-rail-name">
          {label}
          {options.unavailable && <em className="model-rail-reason">{options.unavailable}</em>}
        </span>
      </button>
    )
  }

  const apiUnavailable = (kind: ProviderKind, apiKey: string): string | undefined =>
    KEYLESS_KINDS.has(kind) || apiKey.trim() ? undefined : '缺 API Key'

  const cliUnavailable = (kind: LocalCliKind): string | undefined => {
    if (railCli !== kind) return undefined
    if (probing) return undefined
    if (!probe) return undefined
    return probe.available ? undefined : '未安装'
  }

  // 只在「浏览的就是 Bot 当前来源」时提示模型不在目录；浏览别家来源时，
  // 当前模型本来就不该出现在这份列表里，改由「当前 Bot 模型」一行说明。
  const unlisted =
    !!selectedId &&
    !listed &&
    selectedRail &&
    (railCli ? cliModels.length > 0 : apiModels.length > 0)

  // 展开时把已选模型滚进列表可视区，避免要手动翻几十项。
  useEffect(() => {
    const node = selectedRef.current
    const list = listRef.current
    if (!node || !list) return
    const nodeRect = node.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()
    if (nodeRect.top < listRect.top || nodeRect.bottom > listRect.bottom) {
      list.scrollTop += nodeRect.top - listRect.top - 8
    }
  }, [selectedId, rail, orderedModels.length])

  return (
    <div className="model-picker" data-model-picker>
      <div className="model-effective" data-effective-model aria-live="polite">
        <strong>本次将使用：{effectiveModel}</strong>
        {cliKind && !value.model && <p>未指定模型，具体模型由 CLI 自身配置决定；目录推荐不会自动生效。选择一个模型即可明确指定。</p>}
        {!cliKind && !value.providerId && <p>选择下方模型来源；也可先创建，稍后配置。</p>}
        {!cliKind && value.providerId && !value.model && <p>跟随当前 Provider 的默认设置。</p>}
      </div>
      <div className={`model-picker-body${railCli ? ' is-cli' : ''}`}>
        <div className="model-rail" role="group" aria-label="模型来源">
          <div className="model-rail-label">Provider</div>
          {providers.map((provider) =>
            railItem(`provider:${provider.id}`, provider.name, {
              icon: <ProviderIcon kind={provider.kind} width={16} height={16} />,
              unavailable: apiUnavailable(provider.kind, provider.api_key),
            }),
          )}
          {providers.length === 0 && <p className="model-rail-empty">还没有配置 Provider</p>}
          <div className="model-rail-label">本地 CLI</div>
          {CLI_KINDS.map((entry) =>
            railItem(`cli:${entry.kind}`, entry.label, {
              unavailable: cliUnavailable(entry.kind),
            }),
          )}
        </div>

        <div className="model-pane">
          <div className="model-pane-head">
            {!selectedRail && <span className="model-pane-title">
              {railCli
                ? (CLI_KINDS.find((entry) => entry.kind === railCli)?.label ?? 'CLI')
                : (railProvider?.name ?? 'Provider')}
            </span>}
            <button
              type="button"
              data-model-refresh
              className="model-refresh shape-rect"
              aria-label="刷新模型"
              title="刷新模型"
              disabled={disabled || (railCli ? loadingCatalog : loadingModels)}
              onClick={() => {
                if (railCli) setCatalogNonce((n) => n + 1)
                else setRefreshingProviders(true)
              }}
            >
              <RefreshIcon width={13} height={13} />
            </button>
          </div>

          {!selectedRail && botModel && (
            <p className="model-pane-note" data-bot-model-current>
              当前 Bot 模型：{botModel}
            </p>
          )}

          <div className="model-list" role="group" aria-label="模型" ref={listRef}>
            {!railCli && !railProvider && (
              <p className="model-pane-note">选择左侧的 Provider 或本地 CLI 查看模型。</p>
            )}
            {railCli && probing && <p className="model-pane-note">正在检测本地 CLI…</p>}
            {railCli && !probing && probe && !probe.available && (
              <p className="model-pane-note" data-cli-unavailable>
                {probe.error || '未检测到该 CLI，请检查可执行文件路径。'}
              </p>
            )}
            {((railCli && loadingCatalog) || (!railCli && loadingModels)) && (
              <p className="model-pane-note">正在读取模型…</p>
            )}
            {!railCli && apiError && (
              <p className="model-pane-note is-error" role="alert">
                读取模型失败：{apiError}
              </p>
            )}
            {railCli && cliError && (
              <p className="model-pane-note is-error" role="alert">
                {cliError}
              </p>
            )}
            {unlisted &&
              (railCli ? (
                <div className="model-item shape-rect is-unavailable" data-model-unlisted role="alert">
                  <span className="model-item-name">{selectedId}</span>
                  <span className="model-item-reason">不在当前 CLI 列表中</span>
                  {recommended && (
                    <button
                      type="button"
                      className="model-item-fix shape-rect"
                      onClick={() => commitModel(recommended.id)}
                    >
                      使用 CLI 推荐模型 {recommended.id}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  data-model-option={selectedId}
                  data-model-unlisted
                  aria-pressed
                  title="不在 Provider 返回的模型列表中，仍会原样发送给 Provider。"
                  onClick={() => commitModel(selectedId)}
                  className="model-item shape-rect is-unavailable is-selected"
                >
                  <span className="model-item-name">{selectedId}</span>
                  <span className="model-item-reason">不在目录中</span>
                  {!!botModel && selectedId === botModel && (
                    <span className="model-item-tag" data-bot-model>
                      (Bot 的模型)
                    </span>
                  )}
                  <CheckIcon width={13} height={13} className="model-item-check" />
                </button>
              ))}
            {orderedModels.map((id) => {
              const selected = id === selectedId
              const isBotModel = !!botModel && id === botModel
              // 同一行不叠两枚标签：Bot 正在用的那一行只显示「(Bot 的模型)」。
              const isDefault =
                !railCli && !!engineDefault && id === engineDefault && !isBotModel
              const isRecommended =
                railCli && id === recommended?.id && !isBotModel
              return (
                <button
                  key={id}
                  type="button"
                  ref={selected ? selectedRef : undefined}
                  data-model-option={id}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => commitModel(id)}
                  className={`model-item shape-rect${selected ? ' is-selected' : ''}`}
                >
                  <span className="model-item-name">{id}</span>
                  {isDefault && (
                    <span className="model-item-tag" data-model-default>
                      默认
                    </span>
                  )}
                  {isRecommended && (
                    <span className="model-item-tag" data-model-recommended>
                      CLI 推荐
                    </span>
                  )}
                  {isBotModel && (
                    <span className="model-item-tag" data-bot-model>
                      (Bot 的模型)
                    </span>
                  )}
                  {selected && <CheckIcon width={13} height={13} className="model-item-check" />}
                </button>
              )
            })}
            {((railCli && !loadingCatalog && !cliError) ||
              (!railCli && !loadingModels && !apiError)) &&
              (custom ? (
                <div className="model-custom">
                  <input
                    autoFocus
                    className="model-custom-input"
                    aria-label={railCli ? '自定义 CLI 模型 ID' : '自定义模型 ID'}
                    value={draft}
                    placeholder={railCli ? '填写当前 CLI 支持的模型 ID' : '填写 Provider 支持的模型 ID'}
                    disabled={disabled}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                      const next = draft.trim()
                      if (next) commitModel(next)
                      else setCustom(false)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') {
                        setDraft('')
                        setCustom(false)
                      }
                    }}
                  />
                  <p className="model-pane-note">自定义 ID 不做可用性保证。</p>
                </div>
              ) : (
                <button
                  type="button"
                  data-model-custom
                  className="model-item shape-rect is-muted"
                  disabled={disabled}
                  onClick={() => {
                    setDraft(listed ? '' : selectedId)
                    setCustom(true)
                  }}
                >
                  <span className="model-item-name">自定义模型…</span>
                </button>
              ))}
          </div>

          {railCli && (
            <div className="model-cli-config">
              <div className="model-cli-status" role="status">
                {probing ? '正在检测 CLI…' : probe?.available ? '已检测到 CLI' : '未检测到 CLI'}
              </div>
              <details className="model-cli-details">
                <summary>运行详情</summary>
              {showCliConfig && <label className="model-cli-field" title="留空时在 PATH 中按命令名查找">
                <span>CLI 可执行文件</span>
                <input
                  className="model-custom-input"
                  value={value.cliPath}
                  disabled={disabled}
                  placeholder={railCli === 'codex-cli' ? 'codex' : 'claude'}
                  onChange={(event) => onCliPath?.(event.target.value)}
                />
              </label>}
                {probe?.available && <p className="model-cli-version">已安装{probe.version ? ` · 版本 ${probe.version}` : ''}</p>}
                {probe?.available && probe.path && <p className="model-cli-path">{probe.path}</p>}
              <p className="model-cli-hint">
                正文由 CLI 自身登录与额度生成；改模型、路径或权限会重建会话。
                目录可能有缓存，可用性以回复为准。
              </p>
              </details>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        data-use-bot-default
        aria-pressed={usesEngineDefault}
        disabled={disabled || (!railCli && !railProvider)}
        onClick={useEngineDefault}
        className={`model-default-action shape-rect${usesEngineDefault ? ' is-selected' : ''}`}
        title={
          railCli ? '跟随 CLI 配置，不指定具体模型' : `跟随 ${railProvider?.name || 'Provider'} 默认：${engineDefault || '尚未配置'}`
        }
      >
        <span className="model-default-text">恢复默认</span>
        {usesEngineDefault && <CheckIcon width={13} height={13} className="model-item-check" />}
      </button>
    </div>
  )
}
