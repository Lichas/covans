// components/NewBotDialog.tsx — 新建 Bot 对话框
import { useEffect, useState } from 'react'
import { PERSONA_TEMPLATES } from '../lib/personaTemplates'
import { useBotsStore } from '../stores/botsStore'
import { useChatsStore } from '../stores/chatsStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'
import { Dialog } from './Dialog'
import { Field, btnGhostCls, btnPrimaryCls, inputCls } from './controls'
import { ProviderIcon } from './icons'

export function NewBotDialog() {
  const open = useUiStore((s) => s.newBotOpen)
  const setOpen = useUiStore((s) => s.setNewBotOpen)
  const providers = useSettingsStore((s) => s.providers)
  const createBot = useBotsStore((s) => s.createBot)
  const createDm = useChatsStore((s) => s.createDm)

  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('blank')
  const [prompt, setPrompt] = useState('')
  const [promptTouched, setPromptTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && !providerId && providers.length) setProviderId(providers[0].id)
  }, [open, providers])

  const reset = () => {
    setName('')
    setTemplateId('blank')
    setPrompt('')
    setPromptTouched(false)
    setDescription('')
    setProviderId('')
    setModel('')
    setError('')
  }

  const close = () => {
    setOpen(false)
    reset()
  }

  const pickTemplate = (id: string) => {
    setTemplateId(id)
    if (!promptTouched || id !== 'blank') {
      const t = PERSONA_TEMPLATES.find((t) => t.id === id)
      setPrompt(t?.prompt ?? '')
      setPromptTouched(false)
      if (t && !description && id !== 'blank') setDescription(t.description)
      if (t && !name && id === 'girlfriend') setName('小美女')
    }
  }

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const bot = await createBot({
        name: name.trim(),
        description: description.trim(),
        system_prompt: prompt,
        provider_id: providerId || null,
        model: model.trim(),
      })
      close()
      await createDm(bot.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} title="新建 Bot" onClose={close}>
      <div className="space-y-4 p-5">
        <Field label="名称">
          <input
            className={inputCls}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="给你的 Bot 起个名字"
          />
        </Field>

        <Field label="人设模板">
          <select
            className={inputCls}
            value={templateId}
            onChange={(e) => pickTemplate(e.target.value)}
          >
            {PERSONA_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        {
          <Field label="人设预览（可编辑）">
            <textarea
              placeholder="描述这个 Bot 的身份、能力与说话方式…"
              className={`${inputCls} scroll-thin max-h-44 min-h-[96px] resize-y leading-relaxed`}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setPromptTouched(true)
              }}
            />
          </Field>
        }

        <Field label="描述（可选）">
          <input
            className={inputCls}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话介绍"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider">
            <div className="flex items-center gap-2">
              {providerId ? (
                <ProviderIcon
                  kind={
                    providers.find((p) => p.id === providerId)?.kind ?? 'openai'
                  }
                  width={22}
                  height={22}
                  className="shrink-0"
                />
              ) : (
                <span className="h-[22px] w-[22px] shrink-0 rounded-md border border-dashed border-stone-300 dark:border-stone-600" />
              )}
              <select
                className={`${inputCls} min-w-0 flex-1`}
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value)
                  setModel('')
                }}
              >
                <option value="">稍后配置</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="模型（可选）">
            <input
              className={inputCls}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="留空用默认"
            />
          </Field>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-600 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button className={btnGhostCls} onClick={close}>
            取消
          </button>
          <button
            className={btnPrimaryCls}
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? '创建中…' : '创建并开始聊天'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
