// components/MemoryPanel.tsx — 右栏「记忆」标签页
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Memory, MemoryLayer, MemorySummaryState } from '@shared/types'
import { api } from '../lib/api'
import { formatFullTime } from '../lib/format'
import { PlusIcon, TrashIcon } from './icons'

const KIND_LABEL: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  summary: '摘要',
}
const LAYER_LABEL: Record<MemoryLayer | 'evidence', string> = {
  short: '短时', episodic: '场景', semantic: '语义', long: '长期', evidence: '原文',
}

export function MemoryPanel({ botId, sceneId }: { botId: string; sceneId?: string }) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [layer, setLayer] = useState<MemoryLayer | 'evidence' | 'all'>('all')
  const [names, setNames] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState(50)
  const [summaryStates, setSummaryStates] = useState<MemorySummaryState[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const request = useRef(0)
  const currentBot = useRef(botId)
  currentBot.current = botId

  const load = useCallback(async () => {
    if (currentBot.current !== botId) return
    const version = ++request.current
    try {
      const result = await api.listMemories(botId)
      if (version === request.current && currentBot.current === botId) setMemories(result)
    } catch {
      /* 静默 */
    }
  }, [botId])

  const loadSummaryStates = useCallback(async () => {
    try { setSummaryStates(await api.listMemorySummaryStates(botId)) } catch { /* 静默 */ }
  }, [botId])

  useEffect(() => {
    setMemories([])
    setDraft('')
    setAdding(false)
    setLayer('all')
    setVisible(50)
    void load()
    void loadSummaryStates()
    let active = true
    void api.listBots().then((bots) => {
      if (active) setNames(Object.fromEntries(bots.map((bot) => [bot.id, bot.name])))
    }).catch(() => {})
    const unsubscribe = api.onEvent((event) => {
      if (event.type === 'memories-updated' && event.botId === botId) void load()
      if (event.type === 'memories-updated' && event.botId === botId) void loadSummaryStates()
    })
    return () => { active = false; request.current++; unsubscribe() }
  }, [botId, load, loadSummaryStates])

  const filtered = memories.filter((memory) => layer === 'all' || memory.layer === layer)
  const summaries = filtered.filter((memory) => memory.representation === 'summary')
  const sceneSummaries = summaries.filter((summary) => !sceneId || summary.scene_id === sceneId)
  const currentSummaries = [
    sceneSummaries.filter((summary) => summary.layer === 'short').sort((a, b) => b.updated_at - a.updated_at)[0],
    sceneSummaries.filter((summary) => summary.layer === 'episodic').sort((a, b) => b.updated_at - a.updated_at)[0],
  ].filter((summary): summary is Memory => !!summary)
  const sceneStates = sceneId ? summaryStates.filter((state) => state.scene_id === sceneId) : summaryStates
  const currentState = sceneStates.find((state) => state.status === 'error') ?? sceneStates.find((state) => state.status === 'running' || state.status === 'pending')

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
          共 {memories.length} 条记忆
        </span>
        <div className="flex items-center gap-1">
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 rounded-lg border border-stone-300 px-2 py-1 text-[12px] text-stone-600 transition hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          <PlusIcon width={13} height={13} />
          添加
        </button>
        <button disabled={refreshing} onClick={() => { setRefreshing(true); void api.refreshMemorySummaries(botId).then(loadSummaryStates).finally(() => setRefreshing(false)) }} className="rounded-lg px-2 py-1 text-[11px] text-stone-500 hover:bg-stone-100 disabled:opacity-50">{refreshing ? '更新中' : '刷新摘要'}</button>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-stone-400">
        每段短时记忆最多包含 10 条消息，且首尾不超过 15 分钟；段内消息会持续更新同一条极短摘要，超过任一边界才开启下一段。原文只作为可追溯证据，场景摘要负责更长脉络。摘要在消息停止约 0.8 秒后更新，失败时保留上一次有效摘要并可重试。
      </p>
      {currentState && <div className={'rounded-lg px-2.5 py-2 text-[11px] ' + (currentState.status === 'error' ? 'bg-red-50 text-red-600' : 'bg-stone-100 text-stone-500')}>
        {currentState.status === 'error' ? currentState.error || '摘要更新失败，可点击刷新摘要重试' : currentState.status === 'running' ? '正在更新摘要…' : '等待摘要更新…'}
      </div>}
      {currentSummaries.length > 0 && <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
        <div className="mb-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">当前短时与场景摘要</div>
        {currentSummaries.map((summary) => <div key={summary.id} className="whitespace-pre-wrap text-[12px] leading-relaxed text-stone-700 dark:text-stone-200">{summary.content}</div>)}
      </div>}
      <div className="flex flex-wrap gap-1" aria-label="记忆分层">
        {(['all', 'short', 'episodic', 'semantic', 'long', 'evidence'] as const).map((value) => (
          <button key={value} aria-pressed={layer === value}
            onClick={() => { setLayer(value); setVisible(50) }}
            className={'rounded-lg px-2 py-1 text-xs ' + (layer === value ? 'bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100' : 'text-stone-500')}>
            {value === 'all' ? '全部' : LAYER_LABEL[value]}
          </button>
        ))}
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
        {filtered.slice(0, visible).map((m) => (
          <div
            key={m.id}
            className="memory-row group flex items-start gap-2 rounded-xl border border-stone-200/70 bg-white px-3 py-2.5 dark:border-stone-700/70 dark:bg-stone-800/70"
          >
            <div className="min-w-0 flex-1">
              <div className="selectable whitespace-pre-wrap break-words text-[13px] leading-relaxed text-stone-700 dark:text-stone-200">
                {m.content}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-stone-400">
                <span className="rounded-full bg-stone-100 px-1.5 py-px dark:bg-stone-700">
                  {m.representation === 'verbatim' ? '原文证据' : LAYER_LABEL[m.layer]} · {KIND_LABEL[m.kind] ?? m.kind}
                </span>
                <span>{m.source === 'auto' ? '自动' : '手动'}</span>
                {m.layer === 'short' && <span>窗口 {m.evidence.length}/10 条</span>}
                <span>{formatFullTime(m.created_at)}</span>
              </div>
              {m.speaker && <div className="mt-1 text-[11px] text-stone-400">
                {m.source_type === 'private' ? 'Bot 私聊' : '聊天'} · {m.speaker === 'user' ? '你' : names[m.speaker] || '已删除的 Bot'}说过
                {' · '}{m.participants.map((id) => id === 'user' ? '你' : names[id] || '已删除的 Bot').join('、')}
              </div>}
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
        {filtered.length > visible && <button onClick={() => setVisible((count) => count + 50)} className="w-full py-2 text-xs text-stone-500">加载更多</button>}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-[12.5px] text-stone-400">这一层还没有记忆，消息送达后会即时记录</div>
        )}
      </div>
    </div>
  )
}
