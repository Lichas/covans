// main/agentRuntime.ts — pi-mono 封装：provider 解析、agent 流式运行、中断管理（SPEC §8）
import {
  contentText,
  createModels,
  createProvider,
  envApiKeyAuth,
  type AssistantMessage,
  type Message as PiMessage,
  type Model,
  type Api,
  type MutableModels,
} from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { Agent } from '@earendil-works/pi-agent-core'
import type { Bot, Provider } from '../shared/types'
import * as db from './db'
import { mockComplete, mockStream } from './mockProvider'
import { createWorkspaceTools } from './workspace'

export interface AgentCallbacks {
  onDelta(delta: string): void
  onDone(fullText: string): void
  onError(error: string): void
}

export interface RunAgentOptions {
  systemPrompt?: string
  signal?: AbortSignal
}

// ---------- 进行中任务表（SPEC §8）：Map<chatId, Set<AbortController>> ----------

const running = new Map<string, Set<AbortController>>()

function register(chatId: string, ctrl: AbortController): void {
  let set = running.get(chatId)
  if (!set) {
    set = new Set()
    running.set(chatId, set)
  }
  set.add(ctrl)
}

function unregister(chatId: string, ctrl: AbortController): void {
  const set = running.get(chatId)
  if (!set) return
  set.delete(ctrl)
  if (set.size === 0) running.delete(chatId)
}

/** stopChat：逐个 abort 该会话所有进行中的生成 */
export function abortChat(chatId: string): void {
  const set = running.get(chatId)
  if (!set) return
  for (const ctrl of set) {
    try {
      ctrl.abort()
    } catch {
      /* ignore */
    }
  }
}

export function isChatRunning(chatId: string): boolean {
  return (running.get(chatId)?.size ?? 0) > 0
}

// ---------- provider → model 解析 ----------

interface ResolvedModel {
  models: MutableModels
  model: Model<Api>
  provider: Provider
  apiKey: string
}

const KIMI_CODING_OPENAI_BASE_URL = 'https://api.kimi.com/coding/v1'
const ZHIPU_OPENAI_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

function builtinProviderId(kind: Provider['kind']): string {
  switch (kind) {
    case 'openai':
      return 'openai'
    case 'anthropic':
      return 'anthropic'
    case 'google':
      return 'google'
    case 'openrouter':
      return 'openrouter'
    case 'kimi':
      return 'kimi-coding'
    case 'deepseek':
      return 'deepseek'
    default:
      return kind
  }
}

/** 解析 bot 对应的 pi Models + Model；mock kind 由调用方先行拦截 */
export function resolveModel(bot: Bot): ResolvedModel {
  const provider = bot.provider_id ? db.getProvider(bot.provider_id) : null
  if (!provider) throw new Error(`Bot「${bot.name}」未配置 Provider`)
  if (provider.kind === 'mock') throw new Error('mock provider 不走 pi 运行时')

  const models = createModels()
  const apiKey = provider.api_key || ''
  const modelId = bot.model || provider.default_model
  if (!modelId) throw new Error(`Provider「${provider.name}」未配置模型`)

  if (provider.kind === 'kimi') {
    return resolveOpenAICompatibleModel(provider, modelId, KIMI_CODING_OPENAI_BASE_URL, true)
  }
  if (provider.kind === 'openai-compatible' || provider.kind === 'zhipu') {
    const baseUrl = provider.base_url || (provider.kind === 'zhipu' ? ZHIPU_OPENAI_BASE_URL : '')
    if (!baseUrl) throw new Error(`Provider「${provider.name}」缺少 base_url`)
    return resolveOpenAICompatibleModel(provider, modelId, baseUrl, false)
  }

  switch (provider.kind) {
    case 'anthropic':
      models.setProvider(anthropicProvider())
      break
    case 'openai':
      models.setProvider(openaiProvider())
      break
    case 'google':
      models.setProvider(googleProvider())
      break
    case 'openrouter':
      models.setProvider(openrouterProvider())
      break
    case 'deepseek':
      models.setProvider(deepseekProvider())
      break
    default:
      throw new Error(`未知 Provider 类型：${provider.kind}`)
  }
  const pid = builtinProviderId(provider.kind)
  const model = models.getModel(pid, modelId)
  if (!model) {
    const available = models
      .getModels(pid)
      .map((m) => m.id)
      .slice(0, 12)
      .join(', ')
    throw new Error(`Provider「${provider.name}」下找不到模型 ${modelId}（可用：${available || '无'}）`)
  }
  return { models, model, provider, apiKey }
}

function resolveOpenAICompatibleModel(
  provider: Provider,
  modelId: string,
  baseUrl: string,
  reasoning: boolean,
): ResolvedModel {
  const models = createModels()
  const customId = `custom-${provider.id}`
  const custom = createProvider({
    id: customId,
    name: provider.name,
    baseUrl,
    auth: { apiKey: envApiKeyAuth('key', []) }, // key 在调用时显式传
    models: [
      {
        id: modelId,
        name: modelId,
        api: 'openai-completions',
        provider: customId,
        baseUrl,
        reasoning,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: provider.kind === 'kimi' && modelId === 'k3' ? 1048576 : 262144,
        maxTokens: 131072,
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: reasoning },
      },
    ],
    api: openAICompletionsApi(),
  })
  models.setProvider(custom)
  const model = models.getModel(customId, modelId)
  if (!model) throw new Error(`模型 ${modelId} 解析失败`)
  return { models, model, provider, apiKey: provider.api_key || '' }
}

function staticProviderModels(provider: Provider): string[] {
  const models = createModels()
  let providerId: string | null = null
  switch (provider.kind) {
    case 'openai':
      models.setProvider(openaiProvider())
      providerId = 'openai'
      break
    case 'anthropic':
      models.setProvider(anthropicProvider())
      providerId = 'anthropic'
      break
    case 'google':
      models.setProvider(googleProvider())
      providerId = 'google'
      break
    case 'openrouter':
      models.setProvider(openrouterProvider())
      providerId = 'openrouter'
      break
    case 'kimi':
      models.setProvider(kimiCodingProvider())
      providerId = 'kimi-coding'
      break
    case 'deepseek':
      models.setProvider(deepseekProvider())
      providerId = 'deepseek'
      break
    case 'mock':
      return ['mock-default']
    case 'zhipu':
    case 'openai-compatible':
      return []
  }
  return providerId ? models.getModels(providerId).map((model) => model.id) : []
}

function remoteModelsBaseUrl(provider: Provider): string | null {
  switch (provider.kind) {
    case 'kimi':
      return KIMI_CODING_OPENAI_BASE_URL
    case 'zhipu':
      return provider.base_url || ZHIPU_OPENAI_BASE_URL
    case 'openai-compatible':
      return provider.base_url || null
    default:
      return null
  }
}

function extractModelIds(payload: unknown): string[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as { data?: unknown; models?: unknown }).data ?? (payload as { models?: unknown }).models)
      : []
  if (!Array.isArray(list)) return []
  return [...new Set(list.map((item) => (typeof item === 'string' ? item : item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : '')).filter(Boolean))]
}

async function fetchRemoteModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  })
  if (!response.ok) throw new Error(`拉取模型失败：HTTP ${response.status}`)
  const ids = extractModelIds(await response.json())
  if (ids.length === 0) throw new Error('Provider 返回的模型列表为空')
  return ids
}

/** 拉取 Provider 当前账号可用模型；没有动态目录的内置 Provider 使用本地目录兜底。 */
export async function listProviderModels(provider: Provider): Promise<string[]> {
  const fallback = staticProviderModels(provider)
  const baseUrl = remoteModelsBaseUrl(provider)
  if (!baseUrl || !provider.api_key) return fallback
  try {
    return await fetchRemoteModelIds(baseUrl, provider.api_key)
  } catch (error) {
    if (fallback.length > 0) return fallback
    throw error
  }
}

function isMockBot(bot: Bot): boolean {
  const provider = bot.provider_id ? db.getProvider(bot.provider_id) : null
  return provider?.kind === 'mock'
}

// ---------- 流式运行 ----------

/**
 * 运行一个 bot 的 agent：
 * - historyMessages 为完整 pi 历史（最后一条须为 user 消息，供 agent.continue() 接续）。
 * - mock provider 走本地假流式；其余走 pi-agent-core Agent + pi-ai Models。
 */
export async function runAgent(
  chatId: string,
  bot: Bot,
  historyMessages: PiMessage[],
  callbacks: AgentCallbacks,
  opts: RunAgentOptions = {},
): Promise<void> {
  const ctrl = new AbortController()
  register(chatId, ctrl)
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort()
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  try {
    if (isMockBot(bot)) {
      await runMockAgent(bot, historyMessages, callbacks, opts, ctrl.signal)
      return
    }
    await runPiAgent(chatId, bot, historyMessages, callbacks, opts, ctrl.signal)
  } finally {
    unregister(chatId, ctrl)
  }
}

function lastUserText(messages: PiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') return contentText(m.content)
  }
  return ''
}

async function runMockAgent(
  bot: Bot,
  historyMessages: PiMessage[],
  callbacks: AgentCallbacks,
  opts: RunAgentOptions,
  signal: AbortSignal,
): Promise<void> {
  const userText = lastUserText(historyMessages)
  const full = await mockStream(bot, opts.systemPrompt ?? bot.system_prompt, userText, {
    onDelta: callbacks.onDelta,
  }, { signal })
  if (signal.aborted) return // 已停止：消息保持 streaming，由 stopChat 标记 stopped
  callbacks.onDone(full)
}

async function runPiAgent(
  chatId: string,
  bot: Bot,
  historyMessages: PiMessage[],
  callbacks: AgentCallbacks,
  opts: RunAgentOptions,
  signal: AbortSignal,
): Promise<void> {
  const { models, model, apiKey, provider } = resolveModel(bot)
  const agent = new Agent({
    initialState: {
      systemPrompt: opts.systemPrompt ?? bot.system_prompt,
      model,
      tools: createWorkspaceTools(bot.id), // 所有 bot 都挂载工作区工具（SPEC §8）
      thinkingLevel: provider.kind === 'kimi' ? 'high' : 'off',
      messages: historyMessages,
    },
    streamFn: (m, context, options) => models.streamSimple(m, context, options),
    sessionId: `${chatId}:${bot.id}`,
    getApiKey: async () => apiKey || undefined,
  })

  let acc = ''
  const assistants: AssistantMessage[] = []
  let sawError: string | null = null
  const unsub = agent.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      acc += event.assistantMessageEvent.delta
      callbacks.onDelta(event.assistantMessageEvent.delta)
    } else if (event.type === 'message_end') {
      const m = event.message
      if (m.role === 'assistant') assistants.push(m)
    }
  })
  const onAbort = () => agent.abort()
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    if (signal.aborted) return
    await agent.continue()
  } catch (e) {
    sawError = e instanceof Error ? e.message : String(e)
  } finally {
    unsub()
    signal.removeEventListener('abort', onAbort)
  }

  const lastAssistant: AssistantMessage | undefined = assistants.at(-1)
  if (signal.aborted || lastAssistant?.stopReason === 'aborted') return // stopped
  if (sawError) {
    callbacks.onError(sawError)
    return
  }
  if (lastAssistant && lastAssistant.stopReason === 'error') {
    callbacks.onError(lastAssistant.errorMessage || '生成失败')
    return
  }
  const full = acc || (lastAssistant ? contentText(lastAssistant.content) : '')
  callbacks.onDone(full)
}

// ---------- 非流式 completion（协调者决策 / 记忆提取 / testProvider） ----------

export async function completeOnce(bot: Bot, systemPrompt: string, userText: string): Promise<string> {
  if (isMockBot(bot)) return mockComplete(bot, systemPrompt, userText)
  const { models, model, apiKey } = resolveModel(bot)
  const msg = await models.complete(
    model,
    { systemPrompt, messages: [{ role: 'user', content: userText, timestamp: Date.now() }] },
    { apiKey: apiKey || undefined },
  )
  if (msg.stopReason === 'error') throw new Error(msg.errorMessage || '调用失败')
  return contentText(msg.content)
}

/** testProvider：用一次 ping completion 验证连通性 */
export async function testProviderConnection(provider: Provider): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  try {
    if (provider.kind === 'mock') return { ok: true, models: ['mock-default'] }
    const modelIds = await listProviderModels(provider)
    const modelId = provider.default_model || modelIds[0]
    if (!modelId) return { ok: false, error: '未找到可用模型，请先拉取模型或填写模型 ID' }
    const probe: Bot = {
      id: '__probe__', name: provider.name, avatar: '', description: '', tags: '',
      system_prompt: '', provider_id: provider.id, model: modelId,
      temperature: 0.7, max_tokens: 4096, workspace_dir: '', notify: 0,
      is_coordinator: 0, pinned: 0, sort_order: 0, created_at: 0,
    }
    const { models, model, apiKey } = resolveModel(probe)
    const msg = await models.complete(
      model,
      { messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }] },
      { apiKey: apiKey || undefined },
    )
    if (msg.stopReason === 'error') return { ok: false, error: msg.errorMessage || '调用失败', models: modelIds }
    return { ok: true, models: modelIds }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
