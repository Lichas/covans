import { useEffect, useState } from 'react'
import type { Bot } from '@shared/types'
import { api } from '../lib/api'
import { useSettingsStore } from '../stores/settingsStore'
import { useBotsStore } from '../stores/botsStore'
import { Avatar } from './Avatar'
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
  const [mode, setMode] = useState<'local' | 'image'>('local')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (open) {
      setPrompt('')
      setStatus('')
    }
  }, [open, bot.id])
  const run = async (label: string, work: () => Promise<void>) => {
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
  return (
    <Dialog open={open} title="设计头像" onClose={onClose}>
      <div className="space-y-5 p-6">
        <div className="flex items-center gap-4">
          <Avatar name={bot.name} avatar={bot.avatar} size={80} />
          <div>
            <h3 className="text-[15px] font-semibold">{bot.name}</h3>
            <p className="mt-1 text-[12px] text-stone-400">
              让名字、人设和形象，成为一体。
            </p>
          </div>
        </div>
        <div className="avatar-modes">
          {(['local', 'image'] as const).map((m) => (
            <button
              key={m}
              disabled={!!busy}
              className={mode === m ? 'active' : ''}
              onClick={() => {
                setMode(m)
                setStatus('')
              }}
            >
              <strong>{m === 'local' ? '本地插画' : 'AI 生图'}</strong>
              <small>
                {m === 'local'
                  ? '即时生成 · 无需 Key'
                  : '真人 / 动漫 · 需配置服务'}
              </small>
            </button>
          ))}
        </div>
        <Field label="头像画面与风格">
          <textarea
            rows={4}
            maxLength={4000}
            className={inputCls}
            value={prompt}
            disabled={!!busy}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === 'local'
                ? '可留空，自动结合名称与人设。支持人物、机器人、猫咪、抽象风格，以及蓝色、绿色等配色。'
                : '描述你想要的形象，如：温暖的动漫设计师，柔和光线，简洁背景。'
            }
          />
        </Field>
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
        <div className="flex justify-between gap-2">
          <button
            className={btnGhostCls}
            disabled={!!busy}
            onClick={() =>
              void run('正在上传…', async () => {
                const p = await api.pickAvatar(bot.id)
                if (p) setStatus('已应用上传的头像')
              })
            }
          >
            上传图片
          </button>
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
            {busy || '生成并应用'}
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-stone-400">
          也可以在聊天中直接说「改名为小蓝，并生成一个蓝色机器人头像」。AI
          生图配置位于设置 → 头像生成。
        </p>
        {status && (
          <p
            role="status"
            className="text-[12px] leading-relaxed text-stone-500 dark:text-stone-300"
          >
            {status}
          </p>
        )}
      </div>
    </Dialog>
  )
}
