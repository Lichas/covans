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

  if (chat.type === 'dm') {
    const bot =
      (chat.bot_id && members.find((b) => b.id === chat.bot_id)) || members[0]
    await speakOne(chat.id, bot, text, '', undefined, signal)
  } else if (chat.reply_mode === 'active') {
    await runActiveGroup(chat.id, members, signal)
  } else {
    await runSequentialGroup(chat.id, members, mentions, signal)
  }

  if (!signal.aborted) {
    noteNewMessages(
      chatId,
      members.map((m) => m.id),
      1 + members.length,
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
          '你正在群聊中判断是否应该发言。根据前文总结和最新 5 条消息独立判断。',
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
): Promise<void> {
  emit({ type: 'agent-activity', chatId, botId: bot.id, state: 'speaking' })
  try {
    const latestUser = [...db.listRecentMessages(chatId, 5)]
      .reverse()
      .find((message) => message.sender_type === 'user')
    await speakOne(
      chatId,
      bot,
      latestUser?.content ?? '',
      db.getChat(chatId)?.context_summary
        ? `请结合此前总结：${db.getChat(chatId)!.context_summary}`
        : '',
      groupContext(chatId, members),
      signal,
      5,
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
): Promise<void> {
  const forced = new Set(mentions)
  const ordered = [
    ...members.filter((member) => forced.has(member.id)),
    ...members.filter((member) => !forced.has(member.id)),
  ]
  for (const bot of ordered) {
    if (signal.aborted) return
    if (await shouldReply(chatId, bot, forced.has(bot.id), signal))
      await speakWithActivity(chatId, bot, members, signal)
  }
}

async function runActiveGroup(
  chatId: string,
  members: Bot[],
  signal: AbortSignal,
): Promise<void> {
  const session = activeGroupSessions.get(chatId)
  if (!session) return
  while (!signal.aborted) {
    const revision = session.revision
    const latestUser = [...db.listRecentMessages(chatId, 5)]
      .reverse()
      .find((message) => message.sender_type === 'user')
    const forced = new Set(latestUser?.mentions ?? [])
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
          )
        } catch {
          return false
        } finally {
          session.decisions.delete(controller)
        }
      }),
    )
    if (signal.aborted) return
    if (session.revision !== revision) continue
    await Promise.all(
      members
        .filter((_, index) => decisions[index])
        .map((bot) => speakWithActivity(chatId, bot, members, signal)),
    )
    if (session.revision === revision) return
  }
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
): Promise<void> {
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
}
