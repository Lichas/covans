// main/observability.ts — 默认关闭的隐私安全本地观测日志
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as db from './db'

const MAX_LOG_BYTES = 5 * 1024 * 1024
let logDir = ''

export type ObservationValue = string | number | boolean | null
export type ObservationFields = Record<
  string,
  ObservationValue | ObservationValue[]
>

export function initObservability(userData: string): void {
  logDir = path.join(userData, 'logs')
}

export function observabilityDirectory(): string {
  if (!logDir) throw new Error('本地观测尚未初始化')
  fs.mkdirSync(logDir, { recursive: true })
  return logDir
}

export function observabilityLogPath(): string {
  return path.join(observabilityDirectory(), 'observability.jsonl')
}

export function anonymizeId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function safeFields(fields: ObservationFields): ObservationFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'string' && /(?:^|_)(?:chat|bot|message|trace|task|scheduled_task|server|skill)_?id$/i.test(key)
        ? anonymizeId(value)
        : value,
    ]),
  )
}

function rotateIfNeeded(file: string): void {
  try {
    if (fs.statSync(file).size < MAX_LOG_BYTES) return
  } catch {
    return
  }
  const previous = `${file}.1`
  if (fs.existsSync(previous)) fs.unlinkSync(previous)
  fs.renameSync(file, previous)
}

/**
 * 只接受调用方显式提供的结构化元数据。禁止传入 prompt、消息正文、API Key
 * 或完整 provider 错误文本；ID 会在写入前做稳定匿名化。
 */
export function observe(
  event: string,
  fields: ObservationFields = {},
): void {
  if (!logDir || db.getSetting('local_observability') !== '1') return
  try {
    const file = observabilityLogPath()
    rotateIfNeeded(file)
    fs.appendFileSync(
      file,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...safeFields(fields),
      })}\n`,
      'utf8',
    )
  } catch {
    // 观测失败不能影响聊天主流程。
  }
}

export function classifyObservationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/no user query found/i.test(message)) return 'provider_no_user_query'
  if (/jinja|prompt template/i.test(message)) return 'prompt_template_error'
  if (/\b429\b|rate.?limit/i.test(message)) return 'rate_limited'
  if (/\b401\b|\b403\b|unauthoriz|forbidden/i.test(message))
    return 'authentication'
  if (/abort|cancel|已停止/i.test(message)) return 'aborted'
  if (/timeout|timed out/i.test(message)) return 'timeout'
  if (/connection error|fetch failed|network_error|ECONN|ENOTFOUND|EAI_AGAIN|socket|network connection/i.test(message)) return 'network_error'
  if (/未配置|找不到模型|未设置.*模型/i.test(message)) return 'model_configuration'
  if (/\b404\b|model.*(?:not found|does not exist)/i.test(message)) return 'model_not_found'
  if (/output.*(?:token|limit|budget)|(?:输出|推理).*(?:token|上限|预算)|未生成可显示正文/i.test(message)) return 'output_limit'
  if (/empty.response|未返回可显示正文/i.test(message)) return 'empty_response'
  if (/context.*(?:length|limit)|too many tokens/i.test(message)) return 'context_limit'
  if (/\b400\b|\b422\b|unsupported.*(?:parameter|value)|invalid.*(?:parameter|request)/i.test(message)) return 'invalid_request'
  if (/\b50[0234]\b|overloaded|service unavailable/i.test(message)) return 'service_unavailable'
  if (/content_filter/i.test(message)) return 'content_filtered'
  return 'provider_error'
}

export function observationErrorStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/^(?:HTTP\s+)?([45]\d{2})\b/i)
  return match ? Number(match[1]) : null
}
