import { useEffect, useRef, useState } from 'react'
import { Bug, FolderOpen, RefreshCw, Square } from 'lucide-react'
import type { DiagnosticReport } from '@shared/types'
import { useBotsStore } from '../stores/botsStore'
import { useSettingsStore } from '../stores/settingsStore'
import { api } from '../lib/api'
import { Field, Toggle, inputCls, btnPrimaryCls, btnGhostCls } from './controls'
import { CopyButton } from './CopyButton'
import { MarkdownContent } from './MarkdownContent'

function diagnosticError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^(?:Error:\s*)?Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

export function DebugPanel() {
  const bots = useBotsStore((s) => s.bots)
  const settings = useSettingsStore((s) => s.settings)
  const providers = useSettingsStore((s) => s.providers)
  const setSetting = useSettingsStore((s) => s.setSettingValue)
  const [reference, setReference] = useState('')
  const [botId, setBotId] = useState('')
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [analysis, setAnalysis] = useState('')
  const [eventsOpen, setEventsOpen] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'load' | 'analyze' | null>(null)
  const mounted = useRef(true)
  const analyzing = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; if (analyzing.current) void api.cancelDiagnostic() }
  }, [])
  const load = async () => {
    setBusy('load'); setError(''); setAnalysis('')
    try {
      const next = await api.getDiagnosticReport(reference)
      if (!mounted.current) return
      setReport(next)
      setEventsOpen(true)
      if (!botId) setBotId(bots.find((b) => b.id === next.message.botId && b.provider_id)?.id ?? bots.find((b) => b.provider_id)?.id ?? '')
    } catch (e) { if (mounted.current) { setReport(null); setError(diagnosticError(e)) } }
    finally { if (mounted.current) setBusy(null) }
  }
  const analyze = async () => {
    if (!report || !botId) return
    setBusy('analyze'); analyzing.current = true; setError(''); setAnalysis('')
    try {
      const result = await api.analyzeDiagnostic(report.reference, botId)
      if (mounted.current) { setAnalysis(result); setEventsOpen(false) }
    } catch (e) { if (mounted.current) setError(diagnosticError(e)) }
    finally { analyzing.current = false; if (mounted.current) setBusy(null) }
  }
  return (
    <div className="debug-panel space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">本地观测日志</span>
        <div className="flex items-center gap-3">
          <button className="message-action" title="打开日志目录" aria-label="打开日志目录" onClick={() => void api.openObservabilityLogs().catch((e) => setError(String(e)))}><FolderOpen size={16} /></button>
          <Toggle checked={settings.local_observability === '1'} onChange={(on) => void setSetting('local_observability', on ? '1' : '0').catch((e) => setError(String(e)))} />
        </div>
      </div>
      <Field label="诊断标识 / 消息 ID">
        <div className="flex gap-2">
          <input aria-label="诊断标识" className={`${inputCls} min-w-0 flex-1 font-mono`} value={reference} disabled={!!busy} onChange={(e) => { setReference(e.target.value); setReport(null); setAnalysis('') }} placeholder="covan-debug:v1:…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && reference.trim()) void load() }} />
          <button className={btnGhostCls} disabled={!!busy || !reference.trim()} onClick={() => void load()}><RefreshCw size={14} className="mr-1 inline" />{busy === 'load' ? '加载中' : '加载报告'}</button>
        </div>
      </Field>
      {error && <p role="alert" className="break-words text-xs text-red-500">{error}</p>}
      {report && <>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span>状态：{report.message.status} · {report.runtimeActive ? '运行中' : '无运行任务'} · {report.events.length} 条事件</span>
          <CopyButton text={JSON.stringify(report, null, 2)} label="复制诊断报告" compact />
        </div>
        <p className="break-all text-xs text-stone-500">源回复当前配置：{report.currentModel?.provider} / {report.currentModel?.model || '未配置'} · 已保存 {report.message.outputChars} 字符</p>
        <div className="space-y-1 text-xs text-stone-500 dark:text-stone-400">{report.notes.map((note) => <p key={note}>{note}</p>)}</div>
        <details className="debug-report" open={eventsOpen} onToggle={(e) => setEventsOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer text-sm">执行记录</summary>
          <div className="mt-2 max-h-52 overflow-auto">
            <table className="w-full table-fixed text-left text-xs"><thead><tr><th className="w-20 py-2">时间</th><th className="py-2">阶段 / 元数据</th></tr></thead>
              <tbody>{report.events.map((event, i) => <tr key={i} className="border-t border-stone-200 align-top dark:border-stone-700"><td className="py-2 tabular-nums">{new Date(event.timestamp).toLocaleTimeString()}</td><td className="break-words py-2"><div className="font-mono">{event.event}</div><div className="mt-1 break-all text-stone-500">{Object.entries(event.fields).filter(([key]) => !key.endsWith('_id')).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ')}</div></td></tr>)}</tbody>
            </table>
          </div>
        </details>
        <Field label="诊断 Bot（使用其当前 Provider 和模型）">
          <select aria-label="诊断 Bot" className={inputCls} value={botId} disabled={!!busy} onChange={(e) => { setBotId(e.target.value); setAnalysis(''); setError('') }}><option value="">选择 Bot</option>{bots.filter((b) => b.provider_id).map((bot) => {
            const provider = providers.find((p) => p.id === bot.provider_id)
            return <option key={bot.id} value={bot.id}>{bot.name} · {provider?.kind ?? '未配置'} / {bot.model || provider?.default_model || '未配置模型'} · {bot.reasoning_effort} · {bot.max_tokens} Token</option>
          })}</select>
        </Field>
        <p className="text-xs text-stone-500">分析会将诊断元数据发送给所选模型，消耗该服务额度；不包含聊天正文、工具内容或 API Key。</p>
        <div className="flex justify-end gap-2">
          {busy === 'analyze' && <button className={btnGhostCls} onClick={() => void api.cancelDiagnostic().catch((e) => setError(String(e)))}><Square size={14} className="mr-1 inline" />取消分析</button>}
          <button className={btnPrimaryCls} disabled={!!busy || !botId} onClick={() => void analyze()}><Bug size={14} className="mr-1 inline" />{busy === 'analyze' ? '分析中…' : '分析原因'}</button>
        </div>
        {analysis && <section aria-label="诊断分析" className="border-t border-stone-200 pt-4 text-sm dark:border-stone-700"><MarkdownContent content={analysis} /></section>}
      </>}
    </div>
  )
}
