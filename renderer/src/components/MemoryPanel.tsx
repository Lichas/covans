// components/MemoryPanel.tsx — 右栏「记忆」标签页
import { useEffect, useState } from 'react'
import type { Memory } from '@shared/types'
import { api } from '../lib/api'
import { formatFullTime } from '../lib/format'
import { PlusIcon, TrashIcon } from './icons'

const KIND_LABEL: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  summary: '摘要',
}

export function MemoryPanel({ botId }: { botId: string }) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      setMemories(await api.listMemories(botId))
    } catch {
      /* 静默 */
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId])

  const add = async () => {
    const content = draft.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      await api.addMemory(botId, content, 'fact')
      setDraft('')
      setAdding(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id))
    await api.deleteMemory(id).catch(() => load())
  }

  return (
    <div className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-stone-500 dark:text-stone-400">
          共 {memories.length} 条记忆（自动提取 + 手动添加）
        </span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 rounded-lg border border-stone-300 px-2 py-1 text-[12px] text-stone-600 transition hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          <PlusIcon width={13} height={13} />
          添加
        </button>
      </div>

      {adding && (
        <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            placeholder="例如：用户喜欢喝冰美式，不加糖"
            className="selectable w-full resize-none rounded-lg bg-stone-100 px-2.5 py-2 text-[13px] outline-none placeholder:text-stone-400 dark:bg-stone-700"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg px-3 py-1 text-[12.5px] text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700"
            >
              取消
            </button>
            <button
              onClick={() => void add()}
              disabled={!draft.trim() || busy}
              className="rounded-lg bg-ink px-3 py-1 text-[12.5px] text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
            >
              保存
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {memories.map((m) => (
          <div
            key={m.id}
            className="group flex items-start gap-2 rounded-xl border border-stone-200/70 bg-white px-3 py-2.5 dark:border-stone-700/70 dark:bg-stone-800/70"
          >
            <div className="min-w-0 flex-1">
              <div className="selectable text-[13px] leading-relaxed text-stone-700 dark:text-stone-200">
                {m.content}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-stone-400">
                <span className="rounded-full bg-stone-100 px-1.5 py-px dark:bg-stone-700">
                  {KIND_LABEL[m.kind] ?? m.kind}
                </span>
                <span>{m.source === 'auto' ? '自动' : '手动'}</span>
                <span>{formatFullTime(m.created_at)}</span>
              </div>
            </div>
            <button
              onClick={() => void remove(m.id)}
              className="mt-0.5 shrink-0 rounded-md p-1 text-stone-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-stone-600 dark:hover:bg-red-950/50"
              aria-label="删除记忆"
            >
              <TrashIcon width={14} height={14} />
            </button>
          </div>
        ))}
        {memories.length === 0 && (
          <div className="py-8 text-center text-[12.5px] text-stone-400">还没有记忆，聊几轮后会自动提取</div>
        )}
      </div>
    </div>
  )
}
