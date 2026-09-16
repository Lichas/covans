// main/agentRuntime.ts — pi-mono 封装：provider 解析、agent 流式运行、中断管理（SPEC §8）
import {
  contentText,
  createModels,
  createProvider,
  envApiKeyAuth,
  type ApiKeyAuth,
  type AssistantMessage,
  type Message as PiMessage,
  type Model,
  type Api,
  type MutableModels,
  type ModelThinkingLevel,
} from '@earendil-works/pi-ai'
import { randomUUID } from 'node:crypto'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { Agent } from '@earendil-works/pi-agent-core'
import type {
  Attachment,
  Bot,
  Provider,
  ReasoningEffort,
  WorkspaceArtifact,
} from '../shared/types'
import * as db from './db'
import { mockComplete, mockStream } from './mockProvider'
import { appendToolGuidance, createAgentToolset } from './tools/toolset'
import { describeWorkspaceArtifact } from './workspace'
import {
  classifyObservationError,
  observationErrorStatus,
  observe,
  type ObservationFields,
} from './observability'

export interface AgentCallbacks {
  onImages?(images: Attachment[]): void
  onArtifact?(artifact: WorkspaceArtifact): void
  onWorkspaceChanged?(): void
  onDelta(delta: string): void
  onDone(fullText: string): void
  onError(error: string): void
}

export interface RunAgentOptions {
  messageId?: string
  traceId?: string
  taskId?: string
  systemPrompt?: string
  signal?: AbortSignal
  privateConversation?: boolean
}

// ---------- 进行中任务表（SPEC §8）：Map<chatId, Set<AbortController>> ----------

const running = new Map<string, Set<AbortController>>()
const runningMessages = new Set<string>()
export function isMessageRunning(messageId: string): boolean { return runningMessages.has(messageId) }

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

/** pi 要求每个 Provider 声明鉴权语义；本地服务可明确声明为无需鉴权。 */
function keylessApiAuth(): ApiKeyAuth {
  return {
    name: '无需鉴权',
    check: async () => ({ type: 'api_key', source: '无需鉴权' }),
    resolve: async ({ signal }) => {
      signal.throwIfAborted()
      return { auth: {}, source: '无需鉴权' }
    },
  }
}

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
    return resolveOpenAICompatibleModel(
      provider,
      modelId,
      KIMI_CODING_OPENAI_BASE_URL,
      true,
    )
  }
  if (
    provider.kind === 'openai-compatible' ||
    provider.kind === 'lm-studio' ||
    provider.kind === 'zhipu'
  ) {
    const baseUrl =
      provider.base_url ||
      (provider.kind === 'zhipu' ? ZHIPU_OPENAI_BASE_URL : '')
    if (!baseUrl) throw new Error(`Provider「${provider.name}」缺少 base_url`)
    return resolveOpenAICompatibleModel(
      provider,
      modelId,
      baseUrl,
      provider.kind === 'lm-studio',
    )
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
    throw new Error(
      `Provider「${provider.name}」下找不到模型 ${modelId}（可用：${available || '无'}）`,
    )
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
    auth: {
      apiKey: provider.api_key
        ? envApiKeyAuth('API Key', [])
        : keylessApiAuth(),
    }, // Key 在调用时显式传；本地服务允许无鉴权
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
        contextWindow:
          provider.kind === 'kimi' && modelId === 'k3' ? 1048576 : 262144,
        maxTokens: 131072,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: reasoning,
          maxTokensField: 'max_tokens',
          ...(provider.kind === 'lm-studio'
            ? { thinkingFormat: lmStudioThinkingFormat(modelId) }
            : {}),
        },
      },
    ],
    api: openAICompletionsApi(),
  })
  models.setProvider(custom)
  const model = models.getModel(customId, modelId)
  if (!model) throw new Error(`模型 ${modelId} 解析失败`)
  // pi-agent-core requires a non-empty value from getApiKey even when the
  // endpoint itself is keyless. This local placeholder is not stored and has
  // no authority; LM Studio accepts it like its documented `lm-studio` value.
  return {
    models,
    model,
    provider,
    apiKey:
      provider.api_key ||
      (provider.kind === 'openai-compatible' || provider.kind === 'lm-studio'
        ? 'covan-local'
        : ''),
  }
}

function lmStudioThinkingFormat(
  modelId: string,
): 'qwen' | 'deepseek' | 'openai' {
  const id = modelId.toLowerCase()
  if (id.includes('qwen')) return 'qwen'
  if (id.includes('deepseek')) return 'deepseek'
  return 'openai'
}

function reasoningLevel(value: ReasoningEffort): ModelThinkingLevel {
  return value
}

/**
 * 部分导入到 LM Studio 的模型没有声明 reasoning capability，服务端会忽略
 * reasoning 参数。系统提示是兼容兜底；标准模型仍优先使用协议参数。
 */
function applyLmStudioReasoningHint(
  provider: Provider,
  systemPrompt: string,
  effort: ReasoningEffort,
): string {
  if (provider.kind !== 'lm-studio') return systemPrompt
  const hints: Record<ReasoningEffort, string> = {
    off: '/no_think\n直接回答，不要展开内部推理过程。',
    low: '忽略模型模板中的更高推理要求；只做简短、必要的思考后直接回答。',
    medium: '使用中等推理强度：检查关键事实，但避免不必要的展开。',
    high: '使用较高推理强度，认真验证关键假设后回答。',
    xhigh: '使用最高推理强度，充分验证关键假设和备选方案。',
  }
  return `${hints[effort]}\n\n${systemPrompt}`
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
    case 'lm-studio':
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
    case 'lm-studio':
      return provider.base_url || 'http://localhost:1234/v1'
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
      ? ((payload as { data?: unknown; models?: unknown }).data ??
        (payload as { models?: unknown }).models)
      : []
  if (!Array.isArray(list)) return []
  return [
    ...new Set(
      list
        .map((item) =>
          typeof item === 'string'
            ? item
            : item &&
                typeof item === 'object' &&
                typeof (item as { id?: unknown }).id === 'string'
              ? (item as { id: string }).id
              : '',
        )
        .filter(Boolean),
    ),
  ]
}

async function fetchRemoteModelIds(
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  })
  if (!response.ok) throw new Error(`拉取模型失败：HTTP ${response.status}`)
  const ids = extractModelIds(await response.json())
  if (ids.length === 0) throw new Error('Provider 返回的模型列表为空')
  return ids
}

/** 拉取 Provider 当前账号可用模型；没有动态目录的内置 Provider 使用本地目录兜底。 */
export async function listProviderModels(
  provider: Provider,
): Promise<string[]> {
  const fallback = staticProviderModels(provider)
  const baseUrl = remoteModelsBaseUrl(provider)
  if (!baseUrl) return fallback
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
  const dispatchStartedAt = Date.now()
  const onParentAbort = () => ctrl.abort()
  register(chatId, ctrl)
  if (opts.messageId) runningMessages.add(opts.messageId)
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort()
    else opts.signal.addEventListener('abort', onParentAbort, { once: true })
  }
  try {
    observe('agent.dispatch.started', { chat_id: chatId, bot_id: bot.id, message_id: opts.messageId ?? '', ...(opts.traceId ? { trace_id: opts.traceId } : {}), ...(opts.taskId ? { scheduled_task_id: opts.taskId } : {}), max_tokens: bot.max_tokens, reasoning: bot.reasoning_effort })
    if (isMockBot(bot)) {
      await runMockAgent(bot, historyMessages, callbacks, opts, ctrl.signal)
      return
    }
    await runPiAgent(chatId, bot, historyMessages, callbacks, opts, ctrl.signal)
  } catch (e) {
    observe('agent.dispatch.failed', { chat_id: chatId, bot_id: bot.id, message_id: opts.messageId ?? '', ...(opts.traceId ? { trace_id: opts.traceId } : {}), ...(opts.taskId ? { scheduled_task_id: opts.taskId } : {}), error_code: classifyObservationError(e), error_status: observationErrorStatus(e), duration_ms: Date.now() - dispatchStartedAt })
    if (!ctrl.signal.aborted)
      callbacks.onError(e instanceof Error ? e.message : String(e))
  } finally {
    observe(ctrl.signal.aborted ? 'agent.dispatch.aborted' : 'agent.dispatch.ended', { chat_id: chatId, bot_id: bot.id, message_id: opts.messageId ?? '', ...(opts.traceId ? { trace_id: opts.traceId } : {}), ...(opts.taskId ? { scheduled_task_id: opts.taskId } : {}), duration_ms: Date.now() - dispatchStartedAt })
    opts.signal?.removeEventListener('abort', onParentAbort)
    unregister(chatId, ctrl)
    if (opts.messageId) runningMessages.delete(opts.messageId)
  }
}

function lastUserText(messages: PiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') return contentText(m.content)
  }
  return ''
}

function piContentLength(message: PiMessage): number {
  if (typeof message.content === 'string') return message.content.length
  return message.content.reduce((total, part) => {
    if (part.type === 'text') return total + part.text.length
    if (part.type === 'thinking') return total + part.thinking.length
    return total
  }, 0)
}

function historyObservation(messages: PiMessage[]): ObservationFields {
  const roles = messages.map((message) => message.role)
  return {
    message_count: messages.length,
    roles,
    text_lengths: messages.map(piContentLength),
    last_role: roles.at(-1) ?? 'none',
    last_user_index: roles.lastIndexOf('user'),
  }
}

function payloadObservation(payload: unknown): ObservationFields {
  if (!payload || typeof payload !== 'object')
    return { payload_kind: typeof payload }
  const value = payload as Record<string, unknown>
  const messages = Array.isArray(value.messages) ? value.messages : []
  const roles = messages.map((message) => {
    if (!message || typeof message !== 'object') return 'invalid'
    const role = (message as Record<string, unknown>).role
    return typeof role === 'string' ? role : 'missing'
  })
  return {
    payload_message_count: messages.length,
    payload_roles: roles,
    payload_last_role: roles.at(-1) ?? 'none',
    payload_last_user_index: roles.lastIndexOf('user'),
    payload_tool_count: Array.isArray(value.tools) ? value.tools.length : 0,
  }
}

async function runMockAgent(
  bot: Bot,
  historyMessages: PiMessage[],
  callbacks: AgentCallbacks,
  opts: RunAgentOptions,
  signal: AbortSignal,
): Promise<void> {
  const userText = lastUserText(historyMessages)
  const full = await mockStream(
    bot,
    opts.systemPrompt ?? bot.system_prompt,
    userText,
    {
      onDelta: callbacks.onDelta,
    },
    { signal },
  )
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
  const startedAt = Date.now()
  const observeRun = (event: string, fields: ObservationFields = {}) => observe(event, { chat_id: chatId, bot_id: bot.id, message_id: opts.messageId ?? '', ...(opts.traceId ? { trace_id: opts.traceId } : {}), ...(opts.taskId ? { scheduled_task_id: opts.taskId } : {}), ...fields })
  let requestIndex = 0
  let requestStartedAt = startedAt
  if (
    !model.input.includes('image') &&
    historyMessages.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === 'image'),
    )
  )
    throw new Error(
      '当前模型不支持图片输入，请在 Bot 设置中切换到支持视觉的模型',
    )
  const effort = reasoningLevel(bot.reasoning_effort)
  const tools = createAgentToolset({
    botId: bot.id,
    chatId,
    signal,
    privateConversation: opts.privateConversation,
    onImages: callbacks.onImages,
  })
  const systemPrompt = appendToolGuidance(
    applyLmStudioReasoningHint(
      provider,
      opts.systemPrompt ?? bot.system_prompt,
      bot.reasoning_effort,
    ),
    tools,
  )
  const promptMessage = historyMessages.at(-1)
  if (!promptMessage || promptMessage.role === 'assistant')
    throw new Error('生成历史最后一条必须是 user 或 toolResult 消息')
  observeRun('agent.run.started', {
    chat_id: chatId,
    bot_id: bot.id,
    provider_kind: provider.kind,
    model: model.id,
    ...historyObservation(historyMessages),
  })
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: effort,
      // 把最后一条用户输入作为本轮显式 prompt，而不是依赖 provider
      // 从预填历史中推断 query；部分 LM Studio Jinja 模板不支持后者。
      messages: historyMessages.slice(0, -1),
    },
    streamFn: (m, context, options) =>
      models.streamSimple(m, context, {
        ...options,
        // Kimi k3 rejects any explicit temperature other than 1.
        temperature:
          provider.kind === 'kimi' && m.id === 'k3' ? 1 : bot.temperature,
        maxTokens: bot.max_tokens,
      }),
    sessionId: `${chatId}:${bot.id}`,
    getApiKey: async () => apiKey || undefined,
    onPayload: (payload) => {
      requestStartedAt = Date.now()
      observeRun('provider.payload.ready', {
        request_index: ++requestIndex,
        chat_id: chatId,
        bot_id: bot.id,
        provider_kind: provider.kind,
        model: model.id,
        ...payloadObservation(payload),
      })
      return undefined
    },
    onResponse: (response) => {
      observeRun('provider.response.received', {
        request_index: requestIndex,
        chat_id: chatId,
        bot_id: bot.id,
        provider_kind: provider.kind,
        model: model.id,
        status: response.status,
        duration_ms: Date.now() - requestStartedAt,
      })
    },
  })

  let acc = ''
  const assistants: AssistantMessage[] = []
  let sawError: string | null = null
  const toolCalls = new Map<string, { startedAt: number; index: number }>()
  let toolIndex = 0
  let firstDelta = false
  let firstThinking = false
  const unsub = agent.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta' && !firstThinking) {
      firstThinking = true
      observeRun('agent.first_thinking', { duration_ms: Date.now() - startedAt })
    }
    if (event.type === 'tool_execution_start') {
      const call = { startedAt: Date.now(), index: ++toolIndex }
      toolCalls.set(event.toolCallId, call)
      let inputChars = 0
      try { inputChars = JSON.stringify(event.args ?? '').length } catch { /* Measure metadata only. */ }
      observeRun('tool.started', { tool_name: event.toolName, tool_index: call.index, input_chars: inputChars })
    }
    if (event.type === 'tool_execution_end') {
      const call = toolCalls.get(event.toolCallId)
      const errorText = event.isError && Array.isArray(event.result?.content)
        ? event.result.content.filter((part: { type?: string; text?: string }) => part?.type === 'text').map((part: { text?: string }) => part.text ?? '').join(' ')
        : ''
      const resultChars = Array.isArray(event.result?.content)
        ? event.result.content.reduce((total: number, part: { type?: string; text?: string }) => total + (part?.type === 'text' ? part.text?.length ?? 0 : 0), 0)
        : 0
      observeRun('tool.completed', {
        tool_name: event.toolName,
        tool_index: call?.index ?? null,
        is_error: event.isError,
        ...(event.isError ? { error_code: classifyObservationError(errorText || 'tool_error') } : {}),
        duration_ms: Date.now() - (call?.startedAt ?? Date.now()),
        result_chars: resultChars,
        ...(event.isError ? { error_status: observationErrorStatus(errorText) } : {}),
      })
      toolCalls.delete(event.toolCallId)
    }
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      acc += event.assistantMessageEvent.delta
      if (!firstDelta) {
        firstDelta = true
        observeRun('agent.first_text', { duration_ms: Date.now() - startedAt })
      }
      callbacks.onDelta(event.assistantMessageEvent.delta)
    } else if (event.type === 'message_end') {
      const m = event.message
      if (m.role === 'assistant') {
        assistants.push(m)
        observeRun('agent.step.completed', { stop_reason: m.stopReason, input_tokens: m.usage.input, output_tokens: m.usage.output, reasoning_tokens: m.usage.reasoning ?? null, total_tokens: m.usage.totalTokens })
      }
    } else if (
      event.type === 'tool_execution_end' &&
      !event.isError &&
      (event.toolName === 'workspace_write' ||
        event.toolName === 'workspace_edit')
    ) {
      const relPath = event.result?.details?.path
      if (typeof relPath === 'string') {
        try {
          callbacks.onArtifact?.(
            describeWorkspaceArtifact(
              bot.id,
              relPath,
              event.toolName === 'workspace_edit' ? 'edit' : 'write',
            ),
          )
        } catch {
          // 工具结果已经成功返回；卡片元数据读取失败不应中断 Agent 回复。
        }
      }
    } else if (
      event.type === 'tool_execution_end' &&
      !event.isError &&
      event.toolName === 'bash'
    ) {
      callbacks.onWorkspaceChanged?.()
    }
  })
  const onAbort = () => agent.abort()
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    if (signal.aborted) return
    await agent.prompt(promptMessage)
  } catch (e) {
    sawError = e instanceof Error ? e.message : String(e)
  } finally {
    unsub()
    signal.removeEventListener('abort', onAbort)
  }

  const lastAssistant: AssistantMessage | undefined = assistants.at(-1)
  if (signal.aborted || lastAssistant?.stopReason === 'aborted') {
    observeRun('agent.run.aborted', { duration_ms: Date.now() - startedAt, partial_chars: acc.length })
    return
  }
  if (sawError) {
    observeRun('agent.run.failed', {
      chat_id: chatId,
      bot_id: bot.id,
      provider_kind: provider.kind,
      model: model.id,
      duration_ms: Date.now() - startedAt,
      error_code: classifyObservationError(sawError),
      error_status: observationErrorStatus(sawError),
    })
    callbacks.onError(sawError)
    return
  }
  if (lastAssistant && lastAssistant.stopReason === 'error') {
    observeRun('agent.run.failed', {
      chat_id: chatId,
      bot_id: bot.id,
      provider_kind: provider.kind,
      model: model.id,
      duration_ms: Date.now() - startedAt,
      error_code: classifyObservationError(lastAssistant.errorMessage),
      error_status: observationErrorStatus(lastAssistant.errorMessage),
    })
    callbacks.onError(lastAssistant.errorMessage || '生成失败')
    return
  }
  const full = acc || (lastAssistant ? contentText(lastAssistant.content) : '')
  observeRun('agent.run.completed', {
    chat_id: chatId,
    bot_id: bot.id,
    provider_kind: provider.kind,
    model: model.id,
    duration_ms: Date.now() - startedAt,
    output_chars: full.length,
    stop_reason: lastAssistant?.stopReason ?? 'unknown',
  })
  callbacks.onDone(full)
}

// ---------- 非流式 completion（成员回复判断 / 记忆提取 / testProvider） ----------

export interface CompleteOnceOptions {
  signal?: AbortSignal
  reasoning?: ReasoningEffort
  maxTokens?: number
  temperature?: number
  onResponseStatus?: (status: number) => void
  onCompletion?: (metadata: { stopReason: string; inputTokens: number; outputTokens: number; reasoningTokens: number | null; outputChars: number }) => void
  observation?: {
    operation: string
    chatId?: string
    messageId?: string
    traceId?: string
    taskId?: string
  }
}

export async function completeOnce(
  bot: Bot,
  systemPrompt: string,
  userText: string,
  options: CompleteOnceOptions = {},
): Promise<string> {
  const effort = options.reasoning ?? bot.reasoning_effort
  const callId = randomUUID()
  const configuredProvider = bot.provider_id ? db.getProvider(bot.provider_id) : null
  const scope: ObservationFields = {
    call_id: callId,
    bot_id: bot.id,
    operation: options.observation?.operation ?? 'internal_completion',
    provider_kind: configuredProvider?.kind ?? 'unconfigured',
    model: bot.model || configuredProvider?.default_model || '',
    ...(options.observation?.chatId ? { chat_id: options.observation.chatId } : {}),
    ...(options.observation?.messageId ? { message_id: options.observation.messageId } : {}),
    ...(options.observation?.traceId ? { trace_id: options.observation.traceId } : {}),
    ...(options.observation?.taskId ? { scheduled_task_id: options.observation.taskId } : {}),
  }
  const startedAt = Date.now()
  let status: number | null = null
  observe('completion.started', {
    ...scope,
    max_tokens: options.maxTokens ?? bot.max_tokens,
    reasoning: effort,
  })
  try {
    if (isMockBot(bot)) {
      const result = await mockComplete(bot, systemPrompt, userText, { signal: options.signal })
      const aborted = options.signal?.aborted ?? false
      observe(aborted ? 'completion.aborted' : 'completion.finished', {
        ...scope, duration_ms: Date.now() - startedAt,
        stop_reason: aborted ? 'aborted' : 'stop', output_chars: result.length,
      })
      return result
    }
    const { models, model, apiKey, provider } = resolveModel(bot)
    const callScope = { ...scope, provider_kind: provider.kind, model: model.id }
    const msg = await models.completeSimple(
      model,
      {
        systemPrompt: applyLmStudioReasoningHint(provider, systemPrompt, effort),
        messages: [{ role: 'user', content: userText, timestamp: Date.now() }],
      },
      {
        apiKey: apiKey || undefined,
        signal: options.signal,
        reasoning: effort === 'off' ? undefined : effort,
        onPayload: (payload) => {
          observe('completion.payload.ready', { ...callScope, ...payloadObservation(payload) })
          return undefined
        },
        onResponse: (response) => {
          status = response.status
          options.onResponseStatus?.(response.status)
          observe('completion.response.received', { ...callScope, status, duration_ms: Date.now() - startedAt })
        },
        maxTokens: options.maxTokens ?? bot.max_tokens,
        temperature:
          provider.kind === 'kimi' && model.id === 'k3'
            ? 1
            : (options.temperature ?? bot.temperature),
      },
    )
    const result = contentText(msg.content)
    const metadata = {
      stopReason: msg.stopReason, inputTokens: msg.usage.input,
      outputTokens: msg.usage.output, reasoningTokens: msg.usage.reasoning ?? null,
      outputChars: result.length,
    }
    options.onCompletion?.(metadata)
    observe('completion.finished', {
      ...callScope, duration_ms: Date.now() - startedAt,
      stop_reason: metadata.stopReason, input_tokens: metadata.inputTokens,
      output_tokens: metadata.outputTokens, reasoning_tokens: metadata.reasoningTokens,
      output_chars: metadata.outputChars,
    })
    if (msg.stopReason === 'error') throw new Error(msg.errorMessage || '调用失败')
    if (msg.stopReason === 'aborted') observe('completion.aborted', { ...callScope, duration_ms: Date.now() - startedAt })
    return result
  } catch (error) {
    if (options.signal?.aborted) {
      observe('completion.aborted', { ...scope, duration_ms: Date.now() - startedAt })
    } else {
      const message = error instanceof Error ? error.message : String(error)
      observe('completion.failed', {
        ...scope, duration_ms: Date.now() - startedAt,
        error_code: classifyObservationError(error), error_status: status ?? observationErrorStatus(error),
      })
    }
    throw error
  }
}

/** testProvider：用一次 ping completion 验证连通性 */
export async function testProviderConnection(
  provider: Provider,
): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  try {
    if (provider.kind === 'mock') return { ok: true, models: ['mock-default'] }
    const modelIds = await listProviderModels(provider)
    const modelId = provider.default_model || modelIds[0]
    if (!modelId)
      return {
        ok: false,
        error: '未找到可用模型，请先拉取模型或填写模型 ID',
      }
    const probe: Bot = {
      id: '__probe__',
      gender: 'female',
      name: provider.name,
      avatar: '',
      description: '',
      tags: '',
      system_prompt: '',
      provider_id: provider.id,
      model: modelId,
      temperature: 0.7,
      max_tokens: 8192,
      reasoning_effort: 'medium',
      workspace_dir: '',
      notify: 0,
      is_coordinator: 0,
      pinned: 0,
      sort_order: 0,
      created_at: 0,
    }
    const { models, model, apiKey } = resolveModel(probe)
    const msg = await models.completeSimple(
      model,
      {
        messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
      },
      { apiKey: apiKey || undefined, reasoning: undefined, maxTokens: 32 },
    )
    if (msg.stopReason === 'error')
      return {
        ok: false,
        error: msg.errorMessage || '调用失败',
        models: modelIds,
      }
    return { ok: true, models: modelIds }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
