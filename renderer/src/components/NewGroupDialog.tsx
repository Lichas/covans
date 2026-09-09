// components/NewGroupDialog.tsx — 创建群聊对话框
import { useState } from 'react'
import { useBotsStore } from '../stores/botsStore'
import { useChatsStore } from '../stores/chatsStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { Dialog } from './Dialog'
import { Field, btnGhostCls, btnPrimaryCls, inputCls } from './controls'

export function NewGroupDialog() {
  const open = useUiStore((s) => s.newGroupOpen)
  const setOpen = useUiStore((s) => s.setNewGroupOpen)
  const bots = useBotsStore((s) => s.bots)
  const createGroup = useChatsStore((s) => s.createGroup)

  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setName('')
    setSelected(new Set())
    setError('')
  }
  const close = () => {
    setOpen(false)
    reset()
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (!name.trim() || selected.size === 0 || busy) return
    setBusy(true)
    setError('')
    try {
      await createGroup(name.trim(), [...selected])
      close()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} title="创建群聊" onClose={close}>
      <div className="space-y-4 p-5">
        <Field label="群名称">
          <input
            className={inputCls}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="如：产品评审小分队"
          />
        </Field>

        <div>
          <div className="mb-1.5 text-[12px] font-medium text-stone-500 dark:text-stone-400">
            选择成员（{selected.size}）
          </div>
          <div className="scroll-thin max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-stone-200 p-1.5 dark:border-stone-700">
            {bots.map((b) => {
              const checked = selected.has(b.id)
              return (
                <label
                  key={b.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition ${
                    checked ? 'bg-stone-100 dark:bg-stone-700/70' : 'hover:bg-stone-50 dark:hover:bg-stone-800'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(b.id)}
                    className="h-4 w-4 accent-stone-600"
                  />
                  <Avatar name={b.name} avatar={b.avatar} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-stone-700 dark:text-stone-200">{b.name}</span>
                    {b.description && (
                      <span className="block truncate text-[11px] text-stone-400">{b.description}</span>
                    )}
                  </span>
                </label>
              )
            })}
            {bots.length === 0 && (
              <div className="py-6 text-center text-[12.5px] text-stone-400">还没有 Bot，先新建几个吧</div>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-stone-100/80 px-3.5 py-3 text-[11.5px] leading-relaxed text-stone-500 dark:bg-stone-800/60 dark:text-stone-400">
          新群默认使用「顺序回复」。创建后可在群聊右上角设置中切换为「主动回复」。
        </div>

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-600 dark:bg-red-950/50 dark:text-red-300">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button className={btnGhostCls} onClick={close}>
            取消
          </button>
          <button
            className={btnPrimaryCls}
            disabled={!name.trim() || selected.size === 0 || busy}
            onClick={() => void submit()}
          >
            {busy ? '创建中…' : '创建群聊'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
