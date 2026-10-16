// components/SettingsModal.tsx — 设置弹窗：通用 / Provider 管理 / Bot
import { useEffect, useState } from 'react'
import type {
  JevConfig,
  Provider,
  ProviderInput,
  ProviderKind,
} from '@shared/types'
import { useSettingsStore, type ThemeMode } from '../stores/settingsStore'
import { useUiStore, type SettingsSection } from '../stores/uiStore'
import { Dialog } from './Dialog'
import { AvatarSettingsSection } from './AvatarSettings'
import { ScheduledTasksPanel } from './ScheduledTasksPanel'
import { DebugPanel } from './DebugPanel'
import { ExtensionsPanel } from './ExtensionsPanel'
import { Field, Toggle, btnGhostCls, btnPrimaryCls, inputCls } from './controls'
import {
  CheckIcon,
  PencilIcon,
  PlusIcon,
  ProviderIcon,
  TrashIcon,
  WarnIcon,
} from './icons'
import { getProviderPreset, PROVIDER_PRESETS } from '../lib/providers'
import { api } from '../lib/api'
import {
  BookOpen,
  Bug,
  Clock3,
  Cpu,
  Palette,
  Plug,
  Settings2,
  Users,
} from 'lucide-react'

const PROVIDER_KINDS = PROVIDER_PRESETS

function GeneralSection() {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const settings = useSettingsStore((s) => s.settings)
  const setSettingValue = useSettingsStore((s) => s.setSettingValue)
  const openObservabilityLogs = useSettingsStore((s) => s.openObservabilityLogs)
  const localObservability = settings['local_observability'] === '1'
  const options: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ]
  return (
    <div className="space-y-5 p-5">
      <div>
        <div className="mb-2 text-[13px] font-medium text-stone-700 dark:text-stone-200">
          外观主题
        </div>
        <div className="flex gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => void setTheme(o.value)}
              className={`rounded-lg border px-4 py-1.5 text-[13px] transition ${
                theme === o.value
                  ? 'border-stone-700 bg-stone-800 text-white dark:border-stone-300 dark:bg-stone-100 dark:text-stone-900'
                  : 'border-stone-300 text-stone-600 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-xl border border-stone-200 px-3.5 py-3 dark:border-stone-700">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] text-stone-700 dark:text-stone-200">
              本地观测日志
            </div>
            <div className="mt-0.5 max-w-[380px] text-[11.5px] leading-relaxed text-stone-400">
              记录模型、角色序列、长度、耗时、续发结果和错误分类；不记录聊天正文、提示词或
              API Key。默认关闭。
            </div>
          </div>
          <Toggle
            checked={localObservability}
            onChange={(value) =>
              void setSettingValue('local_observability', value ? '1' : '0')
            }
          />
        </div>
        <button
          className={btnGhostCls}
          onClick={() => void openObservabilityLogs()}
        >
          打开日志目录
        </button>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium text-stone-700 dark:text-stone-200">
          语言
        </div>
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[13px] text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400">
          跟随系统（当前：中文）
        </div>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium text-stone-700 dark:text-stone-200">
          关于 Covan
        </div>
        <div className="rounded-lg border border-dashed border-stone-300 px-3 py-3 text-[12.5px] text-stone-400 dark:border-stone-600">
          会话、Bot 设定和草稿保存在这台设备上。模型服务由你配置的 Provider
          提供。
        </div>
      </div>
      <div className="space-y-2 text-[12px] text-stone-500 dark:text-stone-400">
        <div className="mb-3 font-medium text-stone-700 dark:text-stone-200">
          键盘快捷键
        </div>
        {[
          ['搜索会话', '⌘ K'],
          ['新建 Bot', '⌘ 1'],
          ['创建群聊', '⌘ 2'],
          ['打开设置', '⌘ ,'],
          ['切换 Bot 面板', '⌘ .'],
          ['消息换行', 'Shift + Enter'],
        ].map(([name, key]) => (
          <div key={name} className="flex justify-between">
            <span>{name}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProviderForm({
  editing,
  onDone,
}: {
  editing: Provider | null
  onDone: () => void
}) {
  const saveProvider = useSettingsStore((s) => s.saveProvider)
  const listProviderModels = useSettingsStore((s) => s.listProviderModels)
  const testProvider = useSettingsStore((s) => s.testProvider)
  const [providerId, setProviderId] = useState(editing?.id)
  const [form, setForm] = useState<ProviderInput>({
    name: editing?.name ?? '',
    kind: editing?.kind ?? 'openai',
    api_key: editing?.api_key ?? '',
    base_url: editing?.base_url ?? '',
    default_model: editing?.default_model ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    text: string
  } | null>(null)
  const [testing, setTesting] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])

  const set = (patch: Partial<ProviderInput>) =>
    setForm((f) => ({ ...f, ...patch }))
  const needBaseUrl =
    form.kind === 'openai-compatible' || form.kind === 'lm-studio'
  const selectedPreset = getProviderPreset(form.kind)

  const changeKind = (kind: ProviderKind) => {
    const previousPreset = getProviderPreset(form.kind)
    setModelOptions([])
    set({
      kind,
      base_url:
        !form.base_url || form.base_url === previousPreset.baseUrl
          ? getProviderPreset(kind).baseUrl
          : form.base_url,
      default_model:
        !form.default_model ||
        form.default_model === previousPreset.defaultModel
          ? getProviderPreset(kind).defaultModel
          : form.default_model,
    })
  }

  const save = async (): Promise<Provider | null> => {
    if (!form.name.trim()) return null
    setSaving(true)
    try {
      const saved = await saveProvider({
        ...form,
        id: providerId ?? editing?.id,
      })
      setProviderId(saved.id)
      return saved
    } finally {
      setSaving(false)
    }
  }

  const applyModels = async (saved: Provider, models: string[]) => {
    setModelOptions(models)
    const current = form.default_model?.trim() ?? ''
    const next =
      current && models.includes(current) ? current : (models[0] ?? current)
    if (next && next !== current) {
      const nextForm = { ...form, id: saved.id, default_model: next }
      setForm(nextForm)
      await saveProvider(nextForm)
    }
  }

  const onFetchModels = async () => {
    setLoadingModels(true)
    setTestResult(null)
    try {
      const saved = await save()
      if (!saved) {
        setTestResult({ ok: false, text: '请先填写名称' })
        return
      }
      const models = await listProviderModels(saved.id)
      await applyModels(saved, models)
      setTestResult({
        ok: true,
        text: `已拉取 ${models.length} 个可用模型，请选择默认模型`,
      })
    } catch (e) {
      setTestResult({ ok: false, text: String(e) })
    } finally {
      setLoadingModels(false)
    }
  }

  const onTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const saved = await save()
      if (!saved) {
        setTestResult({ ok: false, text: '请先填写名称' })
        return
      }
      const r = await testProvider(saved.id)
      if (r.models?.length) await applyModels(saved, r.models)
      setTestResult(
        r.ok
          ? {
              ok: true,
              text: `连接成功${r.models?.length ? `（${r.models.length} 个可用模型）` : ''}`,
            }
          : { ok: false, text: r.error || '连接失败' },
      )
    } catch (e) {
      setTestResult({ ok: false, text: String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-800/60">
      <div className="text-[13px] font-medium text-stone-700 dark:text-stone-200">
        {editing ? '编辑 Provider' : '新增 Provider'}
      </div>
      <Field label="名称">
        <input
          className={inputCls}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="如：OpenAI 主账号"
        />
      </Field>
      <Field label="类型">
        <div className="flex items-center gap-2">
          <ProviderIcon
            kind={form.kind}
            width={22}
            height={22}
            className="shrink-0"
          />
          <select
            className={`${inputCls} min-w-0 flex-1`}
            value={form.kind}
            onChange={(e) => changeKind(e.target.value as ProviderKind)}
          >
            {PROVIDER_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </Field>
      {form.kind !== 'mock' && form.kind !== 'lm-studio' && (
        <Field
          label={`API Key${form.kind === 'openai-compatible' ? '（本地服务可留空）' : ''}`}
        >
          <input
            className={inputCls}
            type="password"
            value={form.api_key ?? ''}
            onChange={(e) => set({ api_key: e.target.value })}
            placeholder={
              form.kind === 'openai-compatible'
                ? '本地无鉴权服务留空'
                : 'sk-…（仅保存在本地）'
            }
          />
        </Field>
      )}
      <Field label={`Base URL${needBaseUrl ? '（必填）' : '（可选）'}`}>
        <input
          className={inputCls}
          value={form.base_url ?? ''}
          onChange={(e) => set({ base_url: e.target.value })}
          placeholder={
            selectedPreset.baseUrl ||
            (needBaseUrl ? 'http://localhost:11434/v1' : '留空使用官方地址')
          }
        />
      </Field>
      {form.kind === 'lm-studio' && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2.5 text-[11.5px] leading-relaxed text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300">
          <strong className="block">本地模型 · 无需 API Key</strong>
          启动 LM Studio Local Server 后拉取模型。推理强度、温度和输出上限在每个
          Bot 的模型配置中设置。
        </div>
      )}
      <Field label="默认模型">
        <div className="flex gap-2">
          {modelOptions.length > 0 ? (
            <select
              className={`${inputCls} min-w-0 flex-1`}
              value={form.default_model ?? ''}
              onChange={(e) => set({ default_model: e.target.value })}
            >
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={`${inputCls} min-w-0 flex-1`}
              value={form.default_model ?? ''}
              onChange={(e) => set({ default_model: e.target.value })}
              placeholder={
                form.kind === 'kimi'
                  ? '先点击「拉取模型」'
                  : selectedPreset.defaultModel || '如 gpt-4o / claude-sonnet-4'
              }
            />
          )}
          <button
            className={btnGhostCls}
            disabled={loadingModels || testing || saving || !form.name.trim()}
            onClick={() => void onFetchModels()}
          >
            {loadingModels ? '拉取中…' : '拉取模型'}
          </button>
        </div>
        {modelOptions.length > 0 && (
          <div className="mt-1 text-[11.5px] text-stone-400">
            模型列表来自 Provider 当前账号
          </div>
        )}
      </Field>

      {testResult && (
        <div
          className={`flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[12.5px] ${
            testResult.ok
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300'
          }`}
        >
          {testResult.ok ? (
            <CheckIcon width={14} height={14} className="mt-0.5 shrink-0" />
          ) : (
            <WarnIcon width={14} height={14} className="mt-0.5 shrink-0" />
          )}
          <span className="selectable break-all">{testResult.text}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button className={btnGhostCls} onClick={onDone}>
          取消
        </button>
        <button
          className={btnGhostCls}
          disabled={testing || loadingModels || saving}
          onClick={() => void onTest()}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button
          className={btnPrimaryCls}
          disabled={saving || !form.name.trim()}
          onClick={() => {
            void save()
              .then((p) => p && onDone())
              .catch((e) => setTestResult({ ok: false, text: String(e) }))
          }}
        >
          保存
        </button>
      </div>
    </div>
  )
}

function ProvidersSection() {
  const providers = useSettingsStore((s) => s.providers)
  const deleteProvider = useSettingsStore((s) => s.deleteProvider)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [adding, setAdding] = useState(false)

  const closeForm = () => {
    setEditing(null)
    setAdding(false)
  }

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-stone-500 dark:text-stone-400">
          已配置 {providers.length} 个 Provider
        </span>
        <button
          className={btnGhostCls + ' flex items-center gap-1'}
          onClick={() => setAdding(true)}
        >
          <PlusIcon width={14} height={14} />
          新增
        </button>
      </div>

      {providers.map((p) =>
        editing?.id === p.id ? (
          <ProviderForm key={p.id} editing={p} onDone={closeForm} />
        ) : (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3.5 py-3 dark:border-stone-700 dark:bg-stone-800"
          >
            <ProviderIcon
              kind={p.kind}
              width={32}
              height={32}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium text-stone-800 dark:text-stone-100">
                {p.name}
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-stone-400">
                {PROVIDER_KINDS.find((k) => k.value === p.kind)?.label ??
                  p.kind}
                {p.default_model ? ` · 默认模型 ${p.default_model}` : ''}
              </div>
            </div>
            <button
              className="rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-700"
              onClick={() => {
                setAdding(false)
                setEditing(p)
              }}
              aria-label="编辑"
            >
              <PencilIcon width={15} height={15} />
            </button>
            <button
              className="rounded-md p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50"
              onClick={() => {
                if (window.confirm(`确定删除 Provider「${p.name}」吗？`))
                  void deleteProvider(p.id)
              }}
              aria-label="删除"
            >
              <TrashIcon width={15} height={15} />
            </button>
          </div>
        ),
      )}

      {adding && <ProviderForm editing={null} onDone={closeForm} />}
      {providers.length === 0 && !adding && (
        <div className="py-10 text-center text-[12.5px] text-stone-400">
          还没有 Provider，点击「新增」配置一个 LLM 服务
        </div>
      )}
    </div>
  )
}

function BotSection() {
  const settings = useSettingsStore((s) => s.settings)
  const setSettingValue = useSettingsStore((s) => s.setSettingValue)
  const autoReview = settings['auto_review'] === '1'
  const naturalFollowUp = settings['natural_follow_up'] !== '0'
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '未知'

  return (
    <div className="space-y-5 p-5">
      <div className="flex items-center justify-between rounded-xl border border-stone-200 px-3.5 py-3 dark:border-stone-700">
        <span className="text-[13px] text-stone-700 dark:text-stone-200">
          时区
        </span>
        <span className="text-[13px] text-stone-500 dark:text-stone-400">
          {timezone}（自动检测）
        </span>
      </div>
      <div className="space-y-3 rounded-xl border border-stone-200 px-3.5 py-3 dark:border-stone-700">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-stone-700 dark:text-stone-200">
              群聊发言自动审核
            </div>
            <div className="mt-0.5 text-[11.5px] text-stone-400">
              每位成员判断与回复时都会遵守
            </div>
          </div>
          <Toggle
            checked={autoReview}
            onChange={(v) => void setSettingValue('auto_review', v ? '1' : '0')}
          />
        </div>
        {autoReview && (
          <textarea
            key="review-rules"
            defaultValue={settings['review_rules'] ?? ''}
            onBlur={(e) => void setSettingValue('review_rules', e.target.value)}
            rows={4}
            placeholder="用自然语言描述审核规则，例如：不允许讨论工作以外的话题；每条发言不超过 200 字…"
            className={`${inputCls} resize-y leading-relaxed`}
          />
        )}
      </div>
      <div className="flex items-center justify-between rounded-xl border border-stone-200 px-3.5 py-3 dark:border-stone-700">
        <div>
          <div className="text-[13px] text-stone-700 dark:text-stone-200">
            自然追问
          </div>
          <div className="mt-0.5 max-w-[350px] text-[11.5px] leading-relaxed text-stone-400">
            较长回复可按聊天节奏分成最多 3 条；内容已完整时不会重复续发。
          </div>
        </div>
        <Toggle
          checked={naturalFollowUp}
          onChange={(v) =>
            void setSettingValue('natural_follow_up', v ? '1' : '0')
          }
        />
      </div>
      <JevConfigSection />
    </div>
  )
}

function JevConfigSection() {
  const [config, setConfig] = useState<JevConfig | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  )

  useEffect(() => {
    void api
      .getJevConfig()
      .then(setConfig)
      .catch((error) => setResult({ ok: false, text: String(error) }))
  }, [])

  const save = async () => {
    if (!config) return null
    const saved = await api.saveJevConfig({
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      model: config.model,
      confidence_threshold: config.confidence_threshold,
    })
    setApiKey('')
    setConfig(saved)
    return saved
  }

  const onSave = async () => {
    setBusy(true)
    setResult(null)
    try {
      await save()
      setResult({ ok: true, text: 'Jev 配置已保存' })
    } catch (error) {
      setResult({ ok: false, text: String(error) })
    } finally {
      setBusy(false)
    }
  }

  const onTest = async () => {
    setBusy(true)
    setResult(null)
    try {
      await save()
      const tested = await api.testJev()
      setResult({
        ok: tested.ok,
        text: tested.ok
          ? `连接成功 · ${tested.model ?? 'Jev'} · ${tested.latency_ms ?? 0}ms`
          : tested.error ?? '连接失败',
      })
    } catch (error) {
      setResult({ ok: false, text: String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 border-t border-stone-200 pt-5 dark:border-stone-700">
      <div>
        <h4 className="text-[13px] font-medium text-stone-700 dark:text-stone-200">
          Jev 决策引擎
        </h4>
        <p className="mt-1 max-w-[520px] text-[11.5px] leading-relaxed text-stone-400">
          用于选择 Jev 策略的 Bot 判断是否发言和是否续发。Jev
          只做结构化判断，正文仍由 Bot 当前模型生成；低置信度或服务不可用时回退传统
          LLM。
        </p>
      </div>
      {!config ? (
        <div className="text-[12px] text-stone-400">正在读取配置…</div>
      ) : (
        <div className="space-y-3">
          <Field label="TypeSafe API Key">
            <div className="flex gap-2">
              <input
                aria-label="TypeSafe API Key"
                className={`${inputCls} min-w-0 flex-1`}
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  config.has_api_key
                    ? '已安全保存；留空保持不变'
                    : '输入 TypeSafe API Key'
                }
              />
              {config.has_api_key && (
                <button
                  type="button"
                  className={btnGhostCls}
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    setResult(null)
                    void api
                      .saveJevConfig({ api_key: '' })
                      .then((saved) => {
                        setConfig(saved)
                        setApiKey('')
                        setResult({ ok: true, text: 'API Key 已清除' })
                      })
                      .catch((error) =>
                        setResult({ ok: false, text: String(error) }),
                      )
                      .finally(() => setBusy(false))
                  }}
                >
                  清除
                </button>
              )}
            </div>
          </Field>
          <Field label="Jev 模型">
            <input
              aria-label="Jev 模型"
              className={inputCls}
              value={config.model}
              onChange={(event) =>
                setConfig({ ...config, model: event.target.value })
              }
              placeholder="jev-latest"
            />
          </Field>
          <Field label={`低置信度回退阈值 · ${config.confidence_threshold.toFixed(2)}`}>
            <input
              aria-label="Jev 置信度阈值"
              className="w-full accent-emerald-600"
              type="range"
              min={0.5}
              max={0.95}
              step={0.05}
              value={config.confidence_threshold}
              onChange={(event) =>
                setConfig({
                  ...config,
                  confidence_threshold: Number(event.target.value),
                })
              }
            />
          </Field>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={btnPrimaryCls}
              disabled={busy}
              onClick={() => void onSave()}
            >
              {busy ? '处理中…' : '保存'}
            </button>
            <button
              type="button"
              className={btnGhostCls}
              disabled={busy}
              onClick={() => void onTest()}
            >
              测试连接
            </button>
          </div>
          {result && (
            <p
              role={result.ok ? 'status' : 'alert'}
              className={`text-[12px] ${result.ok ? 'text-emerald-600' : 'text-red-500'}`}
            >
              {result.text}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-stone-400">
            API Key 使用系统凭据加密，仅保存在本机；测试连接会发送一次小型请求并消耗服务额度。中文对话可用，但应按实际群聊校准阈值。
          </p>
        </div>
      )}
    </section>
  )
}

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen)
  const setOpen = useUiStore((s) => s.setSettingsOpen)
  const section = useUiStore((s) => s.settingsSection)
  const setSection = useUiStore((s) => s.setSettingsSection)

  const groups: {
    label: string
    items: {
      id: SettingsSection
      label: string
      description: string
      icon: typeof Settings2
    }[]
  }[] = [
    {
      label: '个人与应用',
      items: [
        {
          id: 'general',
          label: '通用',
          description: '外观、日志和应用偏好',
          icon: Settings2,
        },
        {
          id: 'providers',
          label: 'Provider',
          description: '模型服务与连接配置',
          icon: Cpu,
        },
        {
          id: 'bot',
          label: 'Bot',
          description: 'Bot 默认行为与对话策略',
          icon: Users,
        },
        {
          id: 'scheduled',
          label: '定时任务',
          description: '查看所有 Bot 的自动任务',
          icon: Clock3,
        },
        {
          id: 'avatars',
          label: '头像生成',
          description: '头像生成服务与偏好',
          icon: Palette,
        },
      ],
    },
    {
      label: '能力',
      items: [
        {
          id: 'mcp',
          label: 'MCP',
          description: '安装和管理 MCP 工具服务',
          icon: Plug,
        },
        {
          id: 'skills',
          label: 'Skills',
          description: '安装和管理 Agent Skills',
          icon: BookOpen,
        },
        {
          id: 'debug',
          label: 'Debug',
          description: '查看本地观测与诊断报告',
          icon: Bug,
        },
      ],
    },
  ]
  const current =
    groups
      .flatMap((group) => group.items)
      .find((item) => item.id === section) ?? groups[0].items[0]

  return (
    <Dialog
      open={open}
      title="设置"
      width="w-[900px]"
      bodyClassName="overflow-hidden"
      onClose={() => setOpen(false)}
    >
      <div className="flex h-[min(72vh,640px)] min-h-0">
        <aside className="scroll-thin w-[190px] shrink-0 overflow-y-auto border-r border-stone-200 bg-stone-50/70 p-3 dark:border-stone-700 dark:bg-stone-900/30">
          <nav aria-label="设置分类" className="space-y-5">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="mb-1 px-2 text-[10px] font-medium tracking-wide text-stone-400">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const selected = section === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={selected ? 'page' : undefined}
                        title={item.description}
                        onClick={() => setSection(item.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                          selected
                            ? 'bg-white font-medium text-stone-800 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                            : 'text-stone-500 hover:bg-white/70 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200'
                        }`}
                      >
                        <Icon size={15} strokeWidth={selected ? 2 : 1.8} />
                        <span className="min-w-0 truncate">{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>
        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          <div className="border-b border-stone-200 px-7 py-5 dark:border-stone-700">
            <h3 className="text-xl font-semibold tracking-tight text-stone-800 dark:text-stone-100">
              {current.label}
            </h3>
            <p className="mt-1 text-xs text-stone-400">{current.description}</p>
          </div>
          {section === 'general' && <GeneralSection />}
          {section === 'providers' && <ProvidersSection />}
          {section === 'bot' && <BotSection />}
          {section === 'scheduled' && <ScheduledTasksPanel global />}
          {section === 'avatars' && <AvatarSettingsSection />}
          {section === 'mcp' && <ExtensionsPanel section="mcp" />}
          {section === 'skills' && <ExtensionsPanel section="skills" />}
          {section === 'debug' && <DebugPanel />}
        </main>
      </div>
    </Dialog>
  )
}
