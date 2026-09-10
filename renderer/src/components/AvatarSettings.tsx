import { useEffect, useState } from 'react'
import type { Bot, BotGender } from '@shared/types'
import { api } from '../lib/api'
import { useSettingsStore } from '../stores/settingsStore'
import { useBotsStore } from '../stores/botsStore'
import { Avatar } from './Avatar'
import {
  GenderPicker,
  PresetAvatarPicker,
  usePresetAvatars,
} from './PresetAvatarPicker'
import { Dialog } from './Dialog'
import { Field, inputCls, btnGhostCls, btnPrimaryCls } from './controls'
import { SparkIcon } from './icons'

export function AvatarSettingsSection() {
  const providers = useSettingsStore((s) => s.providers)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [base, setBase] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => {
    let active = true
    Promise.all(
      ['avatar_provider', 'avatar_model', 'avatar_base_url'].map((k) =>
        api.getSetting(k),
      ),
    )
      .then(([p, m, b]) => {
        if (active) {
          setProvider(p)
          setModel(m)
          setBase(b)
          setLoaded(true)
        }
      })
      .catch((e) => setStatus(String(e)))
    return () => {
      active = false
    }
  }, [])
  return (
    <div className="space-y-5 p-5">
      <div className="rounded-xl bg-emerald-50 p-4 text-[12px] leading-relaxed text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <strong className="block pb-1">两种方式，同一个入口</strong>本地插画无需
        Key，按名称和人设生成。AI 生图可生成真人、动漫等头像，需要支持 Images
        API 的服务，会使用该服务的额度。
        聊天中的「帮我画一张图」也使用这里的生图配置，生成结果直接显示在消息中，不会替换头像。
      </div>
      <Field label="生图 Provider">
        <select
          className={inputCls}
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value)
            setModel('')
            setBase('')
            setModels([])
            setStatus('')
          }}
        >
          <option value="">暂不配置（可使用本地头像）</option>
          {providers
            .filter((p) => p.kind !== 'mock')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </Field>
      <p className="text-[11px] leading-relaxed text-stone-400">
        先在 Provider 页添加服务。聊天模型或 Coding Plan 不一定支持生图。
      </p>
      {providers.find((p) => p.id === provider)?.kind === 'kimi' && !base && (
        <p
          role="status"
          className="rounded-lg bg-amber-50 p-3 text-[12px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          当前选择的是 Kimi Coding Plan。识图与生图是两种能力：聊天中的 k3
          可看图；生成图片需配置支持 /images/generations 的服务和生图模型。
        </p>
      )}
      <Field label="生图模型">
        <input
          className={inputCls}
          list="avatar-models"
          placeholder="选择拉取到的模型，或填入服务支持的模型 ID"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <datalist id="avatar-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      <button
        className={btnGhostCls}
        disabled={!provider || busy}
        onClick={async () => {
          setBusy(true)
          try {
            const list = await api.listProviderModels(provider)
            setModels(list)
            setStatus(`已拉取 ${list.length} 个模型，请选择其中支持生图的模型`)
          } catch (e) {
            setStatus(String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        拉取模型
      </button>
      <Field label="生图 Base URL（可选）">
        <input
          className={inputCls}
          placeholder="留空使用 Provider 的 Base URL"
          value={base}
          onChange={(e) => setBase(e.target.value)}
        />
      </Field>
      <p className="text-[11px] leading-relaxed text-stone-400">
        请求会发送到此地址下的 /images/generations，使用所选 Provider
        的密钥。只填写你信任的服务地址。
      </p>
      <div className="flex justify-end">
        <button
          className={btnPrimaryCls}
          disabled={busy || !loaded}
          onClick={async () => {
            setBusy(true)
            setStatus('')
            try {
              if (provider && !model.trim()) throw new Error('请填写生图模型')
              if (base && !/^https?:\/\//i.test(base))
                throw new Error('Base URL 必须以 http:// 或 https:// 开头')
              for (const [k, v] of [
                ['avatar_provider', provider],
                ['avatar_model', model.trim()],
                ['avatar_base_url', base.trim()],
              ])
                await api.setSetting(k, v)
              setStatus('头像生成设置已保存')
            } catch (e) {
              setStatus(String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          保存生图设置
        </button>
      </div>
      {status && (
        <p
          role="status"
          className="text-[12px] text-stone-500 dark:text-stone-300"
        >
          {status}
        </p>
      )}
    </div>
  )
}

export function AvatarDialog({
  bot,
  open,
  onClose,
}: {
  bot: Bot
  open: boolean
  onClose: () => void
}) {
  const loadBots = useBotsStore((s) => s.loadBots)
  const { presets, error: presetError } = usePresetAvatars()
  const [source, setSource] = useState<'preset' | 'upload' | 'generate'>(
    'preset',
  )
  const [gender, setGender] = useState<BotGender>(bot.gender)
  const [selected, setSelected] = useState(bot.avatar)
  const [mode, setMode] = useState<'local' | 'image'>('image')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (open) {
      setSource('preset')
      setGender(bot.gender)
      setSelected(bot.avatar)
      setMode('image')
      setPrompt('')
      setStatus('')
    }
  }, [open, bot.id])
  const run = async (label: string, work: () => Promise<void>) => {
    if (busy) return
    setBusy(label)
    setStatus('')
    try {
      await work()
      await loadBots()
    } catch (e) {
      setStatus(String(e))
    } finally {
      setBusy('')
    }
  }
  const selection = presets.find((p) => p.avatar === selected)
  return (
    <Dialog
      open={open}
      title="更换头像"
      width="w-[620px]"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="avatar-editor">
        <div className="avatar-editor-preview">
          <Avatar
            name={bot.name}
            avatar={source === 'preset' ? selected : bot.avatar}
            size={88}
          />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{bot.name}</h3>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {source === 'preset' && selected !== bot.avatar
                ? '预览新形象 · 应用后生效'
                : '为你的 Bot 选择一个喜欢的形象'}
            </p>
            {source === 'preset' && selection && (
              <span className="avatar-collection-label">
                {selection.label} · 内置形象
              </span>
            )}
          </div>
        </div>
        <div className="avatar-source-tabs" role="group" aria-label="头像来源">
          {(
            [
              ['preset', '内置头像'],
              ['upload', '自定义上传'],
              ['generate', 'AI 生图'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={!!busy}
              aria-pressed={source === id}
              onClick={() => {
                setSource(id)
                setStatus('')
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="avatar-editor-content">
          {source === 'preset' && (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-xs text-stone-500">精选形象，随时切换</p>
                <GenderPicker
                  value={gender}
                  disabled={!!busy}
                  onChange={(next) => {
                    setGender(next)
                    setSelected(
                      presets.find((p) => p.gender === next)?.avatar || '',
                    )
                    setStatus('')
                  }}
                />
              </div>
              <PresetAvatarPicker
                presets={presets}
                gender={gender}
                value={selected}
                disabled={!!busy}
                onChange={(p) => {
                  setSelected(p.avatar)
                  setStatus('')
                }}
              />
              {presetError && (
                <p role="alert" className="text-xs text-red-500">
                  {presetError}
                </p>
              )}
            </>
          )}
          {source === 'upload' && (
            <div className="avatar-upload-card">
              <span className="avatar-upload-symbol" aria-hidden="true">
                ↑
              </span>
              <h3 className="text-sm font-medium">用你喜欢的照片</h3>
              <p>建议使用清晰的正方形图片，主体居中。</p>
              <p className="text-[11px]">PNG、JPG、GIF、WebP · 最大 16 MB</p>
              <button
                className={btnPrimaryCls}
                disabled={!!busy}
                onClick={() =>
                  void run('正在上传…', async () => {
                    const path = await api.pickAvatar(bot.id)
                    if (path) setStatus('已应用上传的头像')
                  })
                }
              >
                {busy || '选择图片并应用'}
              </button>
            </div>
          )}
          {source === 'generate' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-stone-500">从想象开始，创造新形象</p>
                <select
                  aria-label="生成方式"
                  className={`${inputCls} !w-auto`}
                  value={mode}
                  disabled={!!busy}
                  onChange={(e) => {
                    setMode(e.target.value as 'local' | 'image')
                    setStatus('')
                  }}
                >
                  <option value="image">AI 图片</option>
                  <option value="local">本地插画</option>
                </select>
              </div>
              <Field label="头像画面与风格">
                <textarea
                  rows={4}
                  maxLength={4000}
                  className={inputCls}
                  value={prompt}
                  disabled={!!busy}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述形象、穿着、背景与画风，例如：温暖的动漫设计师，柔和光线，简洁背景。"
                />
              </Field>
              <div className="flex items-center justify-between gap-4">
                <button
                  className={btnGhostCls}
                  disabled={!!busy}
                  onClick={() =>
                    void run('正在扩写…', async () => {
                      const design = await api.expandAvatarPrompt(
                        bot.id,
                        prompt.slice(0, 2000),
                      )
                      setPrompt(design.prompt)
                      setStatus('已根据名称与人设扩写，可继续调整')
                    })
                  }
                >
                  <SparkIcon width={14} height={14} className="mr-1 inline" />
                  根据人设扩写
                </button>
                <p className="text-[11px] text-stone-400">
                  {mode === 'image'
                    ? '需在设置 → 头像生成中配置服务'
                    : '本地风格化插画 · 无需生图服务'}
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="avatar-editor-footer">
          <p
            role="status"
            className="min-w-0 flex-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400"
          >
            {busy ||
              status ||
              (source === 'preset'
                ? selection?.lifestyle.length
                  ? '应用后，可在「生活照」中欣赏配套照片。'
                  : '选择后点击应用，保存新的头像。'
                : source === 'upload'
                  ? '选择文件后直接应用为头像。'
                  : mode === 'image'
                    ? '生成会使用所选服务的额度。'
                    : '按名称与人设生成本地插画。')}
          </p>
          {source === 'preset' && (
            <button
              className={btnPrimaryCls}
              disabled={
                !!busy ||
                !selection ||
                (selected === bot.avatar && gender === bot.gender)
              }
              onClick={() =>
                void run('正在应用…', async () => {
                  await api.updateBot(bot.id, { avatar: selected, gender })
                  setStatus('已应用内置头像')
                })
              }
            >
              {selected === bot.avatar && gender === bot.gender
                ? '当前头像'
                : '应用头像'}
            </button>
          )}
          {source === 'generate' && (
            <button
              className={btnPrimaryCls}
              disabled={!!busy}
              onClick={() =>
                void run(
                  mode === 'local' ? '正在生成…' : '正在生图，请稍候…',
                  async () => {
                    await api.generateAvatar(bot.id, prompt, mode)
                    setStatus(
                      mode === 'local'
                        ? '已生成并应用本地插画头像'
                        : '已生成并应用 AI 图片头像',
                    )
                  },
                )
              }
            >
              生成并应用
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
