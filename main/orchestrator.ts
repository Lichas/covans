// main/orchestrator.ts — 群聊编排协议（SPEC §5）+ 单聊直调
// 事件推送通过注入的 emit(CovanEvent) 完成，本模块不 import electron。
import type {
  AssistantMessage,
  Message as PiMessage,
  Usage,
} from '@earendil-works/pi-ai'
import type { Attachment, Bot, CovanEvent, Message } from '../shared/types'
import { imageContent, validateChatImages } from './chatImages'
import * as db from './db'
import { abortChat, completeOnce, runAgent } from './agentRuntime'
import { buildSystemPrompt, noteNewMessages, type GroupContext } from './memory'
import { emitEvent as emit, setEventEmitter } from './events'

export type EmitFn = (ev: CovanEvent) => void

/** 注入事件推送函数（index.ts 注入 webContents 广播；冒烟脚本注入收集器） */
export function initOrchestrator(deps: { emit: EmitFn }): void {
  setEventEmitter(deps.emit)
}

// ---------- 历史重建 ----------

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

/**
 * 从 messages 表重建 pi 历史（SPEC §8：user/bot→user/assistant 交替，bot 名字前缀保留在文本里）：
 * - user → user（原文）
 * - 自己发的 bot 消息 → assistant
 * - 其他 bot / system → user（带 [名字] 前缀）
 */
function toPiHistory(messages: Message[], self: Bot): PiMessage[] {
  const out: PiMessage[] = []
  for (const m of messages) {
    if (m.sender_type === 'user') {
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content || '请查看这些图片。' },
          ...m.attachments.map(imageContent),
        ],
        timestamp: m.created_at,
      })
    } else if (m.sender_type === 'bot' && m.sender_bot_id === self.id) {
      const assistant: AssistantMessage = {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: m.content || (m.attachments.length ? '[已发送图片]' : ''),
          },
        ],
        api: 'openai-completions',
        provider: 'covan-history',
        model: 'history',
        usage: ZERO_USAGE,
        stopReason: 'stop',
        timestamp: m.created_at,
      }
      out.push(assistant)
      if (m.attachments.length)
        out.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: '[历史图片：这是你此前回复中生成的图片，不是新的用户请求]',
            },
            ...m.attachments.map(imageContent),
          ],
          timestamp: m.created_at,
        })
    } else if (m.sender_type === 'bot') {
      const name =
        (m.sender_bot_id && db.getBot(m.sender_bot_id)?.name) || 'Bot'
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: `[${name}]: ${m.content}` },
          ...m.attachments.map(imageContent),
        ],
        timestamp: m.created_at,
      })
    } else {
      out.push({
        role: 'user',
        content: `[系统]: ${m.content}`,
        timestamp: m.created_at,
      })
    }
  }
  return out
}

/** 群聊 transcript（最近 30 条，`[名字]: 内容`），供前文总结 */
function buildTranscript(chatId: string): string {
  return db
    .listRecentMessages(chatId, 30)
    .map((m) => {
      const who =
        m.sender_type === 'user'
          ? '用户'
          : m.sender_type === 'system'
            ? '系统'
            : (m.sender_bot_id && db.getBot(m.sender_bot_id)?.name) || 'Bot'
      return `[${who}]: ${m.content}`
    })
    .join('\n')
}

// ---------- 主流程 ----------

/**
 * 处理用户消息（dm / group 统一入口，SPEC §5）。
 * 立即返回；bot 生成在后台异步推进，通过事件推送进度。
 */
export async function sendUserMessage(
  chatId: string,
  content: string,
  mentions: string[] = [],
  attachments: Attachment[] = [],
): Promise<void> {
  const chat = db.getChat(chatId)
  if (!chat) throw new Error('会话不存在')
  const running = turns.get(chatId)
  if (running) {
    if (running.signal.aborted) throw new Error('当前会话正在停止')
    const session = activeGroupSessions.get(chatId)
    if (chat.type !== 'group' || chat.reply_mode !== 'active' || !session)
      throw new Error('当前会话正在回复，请稍后再发送')
    appendUserMessage(
      chatId,
      content,
      mentions,
      validateChatImages(attachments),
    )
    session.revision += 1
    for (const controller of session.decisions) controller.abort()
    return
  }
  const controller = new AbortController()
  turns.set(chatId, controller)
  if (chat.type === 'group' && chat.reply_mode === 'active')
    activeGroupSessions.set(chatId, {
      revision: 0,
      decisions: new Set(),
    })
  emit({ type: 'generation-state', chatId, generating: true })
  try {
    await runTurn(
      chatId,
      content,
      mentions,
      controller.signal,
      validateChatImages(attachments),
    )
  } catch (e) {
    if (!controller.signal.aborted && db.getChat(chatId)) {
      const message = db.insertMessage({
        chat_id: chatId,
        sender_type: 'system',
        content: `出错了：${e instanceof Error ? e.message : String(e)}`,
      })
      emit({ type: 'system-message', chatId, message })
    }
    throw e
  } finally {
    activeGroupSessions.delete(chatId)
    turns.delete(chatId)
    emit({ type: 'generation-state', chatId, generating: false })
    emit({ type: 'chat-updated', chatId })
  }
}

const turns = new Map<string, AbortController>()
/** 首轮 + 最多四轮基于成员发言的延展讨论，避免群聊无限自我续聊。 */
const MAX_GROUP_DISCUSSION_ROUNDS = 5
const MAX_NATURAL_FOLLOW_UPS = 2
interface ActiveGroupSession {
  revision: number
  decisions: Set<AbortController>
}
const activeGroupSessions = new Map<string, ActiveGroupSession>()

export function isTurnRunning(chatId: string): boolean {
  return turns.has(chatId)
}

export function stopTurn(chatId: string): void {
  turns.get(chatId)?.abort()
  for (const controller of activeGroupSessions.get(chatId)?.decisions ?? [])
    controller.abort()
  abortChat(chatId)
}

function appendUserMessage(
  chatId: string,
  content: string,
  mentions: string[],
  attachments: Attachment[],
): void {
  const text = content.trim()
  if (!text && !attachments.length) throw new Error('消息内容不能为空')
  db.insertMessage({
    chat_id: chatId,
    sender_type: 'user',
    content: text,
    attachments,
    mentions,
  })
  db.touchChat(chatId, Date.now())
  emit({ type: 'chat-updated', chatId })
}

async function runTurn(
  chatId: string,
  content: string,
  mentions: string[],
  signal: AbortSignal,
  attachments: Attachment[],
): Promise<void> {
  const chat = db.getChat(chatId)
  if (!chat) throw new Error('会话不存在')
  const text = content.trim()

  const members = db.listMemberBots(chatId)
  if (members.length === 0) throw new Error('会话内没有 Bot 成员')

  // 1. 落库用户消息；发 chat-updated
  appendUserMessage(chatId, content, mentions, attachments)
  let newMessageCount = 1

  if (chat.type === 'dm') {
    const bot =
      (chat.bot_id && members.find((b) => b.id === chat.bot_id)) || members[0]
    const replied = await speakOne(chat.id, bot, text, '', undefined, signal)
    if (replied) {
      newMessageCount += 1
      newMessageCount += await runNaturalFollowUps(chat.id, bot, text, signal)
    }
  } else if (chat.reply_mode === 'active') {
    newMessageCount += await runActiveGroup(chat.id, members, signal)
  } else {
    newMessageCount += await runSequentialGroup(chat.id, members, mentions, signal)
  }

  if (!signal.aborted) {
    noteNewMessages(
      chatId,
      members.map((m) => m.id),
      newMessageCount,
    )
    if (chat.type === 'group') void refreshGroupSummary(chat.id, members)
  }
}

function groupContext(chatId: string, members: Bot[]): GroupContext {
  return {
    chatName: db.getChat(chatId)?.name ?? '群聊',
    otherMembers: members.map((member) => ({
      id: member.id,
      name: member.name,
    })),
  }
}

function groupReviewRules(): string {
  if (db.getSetting('auto_review') !== '1') return ''
  const rules = db.getSetting('review_rules').trim()
  return rules ? `## 群聊发言规则\n${rules}` : ''
}

function decisionTranscript(chatId: string): string {
  const chat = db.getChat(chatId)
  const latest = db.listRecentMessages(chatId, 5)
  const lines = latest.map((message) => {
    const who =
      message.sender_type === 'user'
        ? '用户'
        : message.sender_type === 'bot'
          ? db.getBot(message.sender_bot_id ?? '')?.name ?? 'Bot'
          : '系统'
    const images = message.attachments.length
      ? `（附 ${message.attachments.length} 张图片）`
      : ''
    return `[${who}] ${message.content}${images}`
  })
  return `前文总结：\n${chat?.context_summary || '暂无'}\n\n最新 5 条消息：\n${lines.join('\n')}`
}

async function shouldReply(
  chatId: string,
  bot: Bot,
  forced: boolean,
  signal: AbortSignal,
  round: number,
): Promise<boolean> {
  emit({ type: 'agent-activity', chatId, botId: bot.id, state: 'preparing' })
  try {
    try {
      const raw = await completeOnce(
        bot,
        [
          buildSystemPrompt(
            bot,
            db.listMemories(bot.id, 30),
            groupContext(chatId, db.listMemberBots(chatId)),
          ),
          groupReviewRules(),
          '<<group-reply-decision>>',
          '你正在群聊中判断是否应该发言。根据前文总结和最新 5 条消息独立判断。',
          `当前是本次话题的第 ${round} 轮（最多 ${MAX_GROUP_DISCUSSION_ROUNDS} 轮）。`,
          round > 1
            ? '这是一轮延展讨论。只有能补充新信息、回应其他成员的具体观点、提出有价值的异议或推进未解决问题时才回复；复述、附和或换句话重复时必须 SKIP。'
            : '首轮请优先直接回应用户的话题。',
          '需要回应时只输出 REPLY；没有新价值、与自己无关或别人已充分回答时只输出 SKIP。',
          '被用户直接点名时必须回复。不要在判断阶段输出正式回答。',
        ].join('\n\n'),
        decisionTranscript(chatId),
        { signal, reasoning: 'low', maxTokens: 32, temperature: 0 },
      )
      return forced || !/^\s*SKIP\b/i.test(raw)
    } catch (error) {
      if (signal.aborted) throw error
      // 判断请求失败时仍让 Bot 尝试正式回复，由消息气泡展示具体错误。
      return true
    }
  } finally {
    emit({ type: 'agent-activity', chatId, botId: bot.id, state: 'idle' })
  }
}

async function speakWithActivity(
  chatId: string,
  bot: Bot,
  members: Bot[],
  signal: AbortSignal,
  round: number,
): Promise<boolean> {
  emit({ type: 'agent-activity', chatId, botId: bot.id, state: 'speaking' })
  try {
    const latestUser = [...db.listRecentMessages(chatId, 5)]
      .reverse()
      .find((message) => message.sender_type === 'user')
    return await speakOne(
      chatId,
      bot,
      latestUser?.content ?? '',
      db.getChat(chatId)?.context_summary
        ? `请结合此前总结：${db.getChat(chatId)!.context_summary}`
        : '',
      groupContext(chatId, members),
      signal,
      5,
      round > 1
        ? `这是本次话题的第 ${round} 轮延展讨论。只说能推进讨论的新内容：补充事实、回应具体观点、提出有依据的异议或收敛下一步。不要复述、客套附和或重复自己的上一轮。`
        : '',
    )
  } finally {
    emit({ type: 'agent-activity', chatId, botId: bot.id, state: 'idle' })
  }
}

async function runSequentialGroup(
  chatId: string,
  members: Bot[],
  mentions: string[],
  signal: AbortSignal,
): Promise<number> {
  const forced = new Set(mentions)
  let repliedTotal = 0
  for (let round = 1; round <= MAX_GROUP_DISCUSSION_ROUNDS; round++) {
    const replied = await runSequentialRound(
      chatId,
      members,
      round === 1 ? forced : new Set(),
      signal,
      round,
    )
    repliedTotal += replied
    if (signal.aborted || replied === 0) return repliedTotal
  }
  return repliedTotal
}

async function runSequentialRound(
  chatId: string,
  members: Bot[],
  forced: Set<string>,
  signal: AbortSignal,
  round: number,
): Promise<number> {
  const ordered = [
    ...members.filter((member) => forced.has(member.id)),
    ...members.filter((member) => !forced.has(member.id)),
  ]
  let replied = 0
  for (const bot of ordered) {
    if (signal.aborted) return replied
    if (await shouldReply(chatId, bot, forced.has(bot.id), signal, round)) {
      replied += 1
      await speakWithActivity(chatId, bot, members, signal, round)
    }
  }
  return replied
}

async function runActiveGroup(
  chatId: string,
  members: Bot[],
  signal: AbortSignal,
): Promise<number> {
  const session = activeGroupSessions.get(chatId)
  if (!session) return 0
  let repliedTotal = 0
  for (let round = 1; round <= MAX_GROUP_DISCUSSION_ROUNDS; round++) {
    const replied = await runActiveRound(chatId, members, signal, round)
    repliedTotal += replied
    if (signal.aborted || replied === 0) return repliedTotal
  }
  return repliedTotal
}

async function runActiveRound(
  chatId: string,
  members: Bot[],
  signal: AbortSignal,
  round: number,
): Promise<number> {
  const session = activeGroupSessions.get(chatId)
  if (!session) return 0
  while (!signal.aborted) {
    const revision = session.revision
    const latestUser = [...db.listRecentMessages(chatId, 5)]
      .reverse()
      .find((message) => message.sender_type === 'user')
    // @ 只强制首轮回复；后续是否延展仍由每个成员基于新内容决定。
    const forced = round === 1 ? new Set(latestUser?.mentions ?? []) : new Set()
    const decisions = await Promise.all(
      members.map(async (bot) => {
        const controller = new AbortController()
        session.decisions.add(controller)
        try {
          const combined = AbortSignal.any([signal, controller.signal])
          return await shouldReply(
            chatId,
            bot,
            forced.has(bot.id),
            combined,
            round,
          )
        } catch {
          return false
        } finally {
          session.decisions.delete(controller)
        }
      }),
    )
    if (signal.aborted) return 0
    if (session.revision !== revision) continue
    const speakers = members.filter((_, index) => decisions[index])
    await Promise.all(speakers.map((bot) => speakWithActivity(chatId, bot, members, signal, round)))
    if (session.revision === revision) return speakers.length
  }
  return 0
}

function naturalFollowUpEnabled(): boolean {
  // 新安装默认开启；用户显式关闭后才不续发。
  return db.getSetting('natural_follow_up') !== '0'
}

async function shouldNaturallyFollowUp(
  chatId: string,
  bot: Bot,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const raw = await completeOnce(
      bot,
      [
        buildSystemPrompt(bot, db.listMemories(bot.id, 30)),
        '<<natural-followup-decision>>',
        '你刚刚在私聊中已经回复过用户。判断是否值得再单独发一条很短的自然跟进。',
        '只有在补充遗漏重点、自然追问用户的感受/选择，或承接一个尚未解决的问题时才输出 REPLY。',
        '若只是寒暄、重复、泛泛地问“还有什么需要”，或前一条已经完整，就输出 SKIP。只输出 REPLY 或 SKIP。',
      ].join('\n\n'),
      decisionTranscript(chatId),
      { signal, reasoning: 'low', maxTokens: 24, temperature: 0 },
    )
    return /^\s*REPLY\b/i.test(raw)
  } catch {
    // 追问是体验增强，判断失败时不影响已经完成的主回复。
    return false
  }
}

async function runNaturalFollowUps(
  chatId: string,
  bot: Bot,
  userText: string,
  signal: AbortSignal,
): Promise<number> {
  if (!naturalFollowUpEnabled()) return 0
  let sentCount = 0
  for (let index = 0; index < MAX_NATURAL_FOLLOW_UPS; index++) {
    if (signal.aborted || !(await shouldNaturallyFollowUp(chatId, bot, signal)))
      return sentCount
    const sent = await speakOne(
      chatId,
      bot,
      userText,
      '',
      undefined,
      signal,
      30,
      [
        '<<natural-followup-message>>',
        '这是紧接上一条回复的独立消息，不要重复答案。用一两句自然、具体的补充或追问来承接对话；不要解释这是“追问”，不要使用空泛的客服式收尾。',
      ].join('\n\n'),
    )
    if (!sent) return sentCount
    sentCount += 1
  }
  return sentCount
}

async function refreshGroupSummary(
  chatId: string,
  members: Bot[],
): Promise<void> {
  const bot = members[0]
  const chat = db.getChat(chatId)
  if (!bot || !chat) return
  const recent = db.listRecentMessages(chatId, 20)
  if (recent.length <= 5) return
  const newestMessageId = recent.at(-1)?.id
  try {
    const summary = await completeOnce(
      bot,
      '把群聊压缩成中立、准确的前文总结，保留人物立场、决定和未解决问题。只输出总结，不超过500字。',
      `${chat.context_summary ? `已有总结：${chat.context_summary}\n\n` : ''}${buildTranscript(chatId)}`,
      { reasoning: 'off', maxTokens: 700, temperature: 0 },
    )
    if (db.listRecentMessages(chatId, 1).at(-1)?.id === newestMessageId)
      db.updateChatSummary(chatId, summary)
  } catch {
    // 总结失败不影响聊天主流程。
  }
}

async function speakOne(
  chatId: string,
  bot: Bot,
  userText: string,
  hint: string,
  groupContext?: GroupContext,
  signal?: AbortSignal,
  historyLimit = 30,
  responseInstruction = '',
): Promise<boolean> {
  const memories = db.listMemories(bot.id, 30)
  const ctx: GroupContext | undefined = groupContext
    ? {
        ...groupContext,
        otherMembers: groupContext.otherMembers.filter((m) => m.id !== bot.id),
      }
    : undefined
  const systemPrompt = [
    buildSystemPrompt(bot, memories, ctx),
    ctx ? groupReviewRules() : '',
    responseInstruction,
  ]
    .filter(Boolean)
    .join('\n\n')

  // 截取指定条数的历史；hint 作为最后一条真实用户消息的补充上下文。
  const recent = db.listRecentMessages(chatId, historyLimit)
  let userIdx = -1
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].sender_type === 'user') {
      userIdx = i
      break
    }
  }
  if (hint && userIdx >= 0) {
    recent[userIdx] = {
      ...recent[userIdx],
      content: `（补充上下文：${hint}）\n${userText}`,
    }
  }
  const history = toPiHistory(recent, bot)

  // 先落一条 streaming 占位消息
  const placeholder = db.insertMessage({
    chat_id: chatId,
    sender_type: 'bot',
    sender_bot_id: bot.id,
    content: '',
    status: 'streaming',
  })
  emit({ type: 'message-start', chatId, message: placeholder })

  let acc = ''
  let completed = false
  await runAgent(
    chatId,
    bot,
    history,
    {
      onImages: (images) => {
        const current = db.getMessage(placeholder.id)!
        const msg = db.updateMessage(placeholder.id, {
          content: acc,
          attachments: [...current.attachments, ...images],
        })
        emit({ type: 'message-start', chatId, message: msg })
      },
      onArtifact: (artifact) => {
        const current = db.getMessage(placeholder.id)!
        const artifacts = [
          ...current.artifacts.filter((item) => item.relPath !== artifact.relPath),
          artifact,
        ]
        const msg = db.updateMessage(placeholder.id, {
          content: acc,
          artifacts,
        })
        emit({ type: 'message-start', chatId, message: msg })
        emit({ type: 'workspace-updated', botId: bot.id })
      },
      onDelta: (delta) => {
        acc += delta
        emit({
          type: 'message-delta',
          chatId,
          messageId: placeholder.id,
          delta,
        })
      },
      onDone: (full) => {
        const finalContent = full || acc
        const msg = db.updateMessage(placeholder.id, {
          content: finalContent,
          status: 'done',
        })
        db.touchChat(chatId, Date.now(), true)
        emit({ type: 'message-done', chatId, message: msg })
        emit({ type: 'chat-updated', chatId })
        completed = true
      },
      onError: (error) => {
        const msg = db.updateMessage(placeholder.id, {
          content: acc,
          status: 'error',
          error,
        })
        emit({ type: 'message-done', chatId, message: msg })
        emit({ type: 'chat-updated', chatId })
      },
    },
    { systemPrompt, signal },
  )
  if (signal?.aborted && db.getChat(chatId)) {
    const msg = db.updateMessage(placeholder.id, {
      content: acc,
      status: 'stopped',
    })
    emit({ type: 'message-done', chatId, message: msg })
  }
  return completed
}
