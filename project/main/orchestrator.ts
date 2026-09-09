// main/orchestrator.ts — 群聊编排协议（SPEC §5）+ 单聊直调
// 事件推送通过注入的 emit(CovanEvent) 完成，本模块不 import electron。
import type {
  AssistantMessage,
  Message as PiMessage,
  Usage,
} from '@earendil-works/pi-ai'
import type { Bot, CovanEvent, Message } from '../shared/types'
import * as db from './db'
import { abortChat, completeOnce, runAgent } from './agentRuntime'
import { buildSystemPrompt, noteNewMessages, type GroupContext } from './memory'
import { COORDINATOR_MARKER, ROSTER_PREFIX } from './mockProvider'
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
      out.push({ role: 'user', content: m.content, timestamp: m.created_at })
    } else if (m.sender_type === 'bot' && m.sender_bot_id === self.id) {
      const assistant: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: m.content }],
        api: 'openai-completions',
        provider: 'covan-history',
        model: 'history',
        usage: ZERO_USAGE,
        stopReason: 'stop',
        timestamp: m.created_at,
      }
      out.push(assistant)
    } else if (m.sender_type === 'bot') {
      const name =
        (m.sender_bot_id && db.getBot(m.sender_bot_id)?.name) || 'Bot'
      out.push({
        role: 'user',
        content: `[${name}]: ${m.content}`,
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

/** 群聊 transcript（最近 30 条，`[名字]: 内容`），供协调者决策 */
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

// ---------- 协调者决策 ----------

interface SpeakItem {
  botId: string
  hint: string
}

function buildCoordinatorSystemPrompt(
  coordinator: Bot,
  members: Bot[],
): string {
  const roster = members
    .map((m) => `${ROSTER_PREFIX}${m.id}:${m.name}`)
    .join('\n')
  const memberDesc = members
    .map(
      (m) =>
        `- ${m.name}（id: ${m.id}）${m.description ? `：${m.description}` : ''}`,
    )
    .join('\n')
  return [
    COORDINATOR_MARKER,
    `你是群聊协调者「${coordinator.name}」。根据群聊记录，决定接下来由哪些成员发言。`,
    `成员名单：\n${memberDesc}`,
    roster,
    '只输出 JSON，格式：{"speak": [{"botId": "成员id", "hint": "要说什么的简短指令"}], "note": "系统条文本，如：已发消息给 3 个 Bot"}',
    '不要输出任何其他文字。speak 最多 5 项，按发言顺序排列。',
  ].join('\n')
}

function parseCoordinatorDecision(
  raw: string,
  validIds: Set<string>,
): SpeakItem[] | null {
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      speak?: { botId?: string; hint?: string }[]
      note?: string
    }
    if (!Array.isArray(obj.speak)) return null
    const items: SpeakItem[] = []
    for (const s of obj.speak) {
      if (s && typeof s.botId === 'string' && validIds.has(s.botId)) {
        items.push({
          botId: s.botId,
          hint: typeof s.hint === 'string' ? s.hint : '',
        })
      }
    }
    if (items.length === 0) return null
    return items.slice(0, 5)
  } catch {
    return null
  }
}

function parseCoordinatorNote(raw: string): string {
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return ''
    const obj = JSON.parse(raw.slice(start, end + 1)) as { note?: string }
    return typeof obj.note === 'string' ? obj.note : ''
  } catch {
    return ''
  }
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
): Promise<void> {
  if (turns.has(chatId)) throw new Error('当前会话正在回复，请稍后再发送')
  const controller = new AbortController()
  turns.set(chatId, controller)
  emit({ type: 'generation-state', chatId, generating: true })
  try {
    await runTurn(chatId, content, mentions, controller.signal)
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
    turns.delete(chatId)
    emit({ type: 'generation-state', chatId, generating: false })
    emit({ type: 'chat-updated', chatId })
  }
}

const turns = new Map<string, AbortController>()

export function isTurnRunning(chatId: string): boolean {
  return turns.has(chatId)
}

export function stopTurn(chatId: string): void {
  turns.get(chatId)?.abort()
  abortChat(chatId)
}

async function runTurn(
  chatId: string,
  content: string,
  mentions: string[],
  signal: AbortSignal,
): Promise<void> {
  const chat = db.getChat(chatId)
  if (!chat) throw new Error('会话不存在')
  const text = content.trim()
  if (!text) throw new Error('消息内容不能为空')

  const members = db.listMemberBots(chatId)
  if (members.length === 0) throw new Error('会话内没有 Bot 成员')

  // 1. 落库用户消息；发 chat-updated
  db.insertMessage({
    chat_id: chatId,
    sender_type: 'user',
    content: text,
    mentions,
  })
  db.touchChat(chatId, Date.now())
  emit({ type: 'chat-updated', chatId })

  let speakList: SpeakItem[]
  let note = ''

  if (chat.type === 'dm') {
    // 单聊：直接调用该 bot agent
    const bot =
      (chat.bot_id && members.find((b) => b.id === chat.bot_id)) || members[0]
    speakList = [{ botId: bot.id, hint: '' }]
  } else {
    // 群聊
    const validIds = new Set(members.map((m) => m.id))
    const forced = mentions.filter((id) => validIds.has(id))
    const coordinator = chat.coordinator_bot_id
      ? (db.getBot(chat.coordinator_bot_id) ?? null)
      : null

    if (coordinator && validIds.has(coordinator.id)) {
      // 3. 调 coordinator agent 决策（只输出 JSON）
      const sysPrompt = buildCoordinatorSystemPrompt(coordinator, members)
      const transcript = buildTranscript(chatId)
      let decision: SpeakItem[] | null = null
      let raw = ''
      try {
        raw = await completeOnce(coordinator, sysPrompt, transcript, {
          signal,
          reasoning: 'low',
          maxTokens: 768,
          temperature: 0,
        })
        decision = parseCoordinatorDecision(raw, validIds)
        note = parseCoordinatorNote(raw)
      } catch {
        decision = null
      }
      if (signal.aborted) return
      if (!decision) {
        // 解析失败兜底：所有被 @mention 的 bot + coordinator 自己发言
        decision = [
          ...forced.map((botId) => ({ botId, hint: '' })),
          { botId: coordinator.id, hint: '' },
        ]
        if (!note) note = '协调者决策失败，按兜底规则发言'
      }
      // 用户 @mention 的 bot 强制加入 speak 列表首位
      const rest = decision.filter((s) => !forced.includes(s.botId))
      speakList = [
        ...forced.map((botId) => ({ botId, hint: '' })),
        ...rest,
      ].slice(0, 5)
    } else {
      // 4. 无 coordinator：被 mention 的发言；无 mention 则全体成员按 sort_order（最多 5 人）
      speakList = (
        forced.length > 0 ? forced : members.slice(0, 5).map((m) => m.id)
      ).map((botId) => ({
        botId,
        hint: '',
      }))
      note =
        forced.length > 0
          ? `已发消息给 ${speakList.length} 个 Bot`
          : '全体成员依次发言'
    }

    // 5. 写入一条 system 消息（note）
    const sysMsg = db.insertMessage({
      chat_id: chatId,
      sender_type: 'system',
      content: note || '协调中',
    })
    db.touchChat(chatId, Date.now())
    emit({ type: 'system-message', chatId, message: sysMsg })
    emit({ type: 'chat-updated', chatId })
  }

  // 6. 依次（串行）对每个 speak 项调用对应 Bot 的 agent
  const groupContext: GroupContext | undefined =
    chat.type === 'group'
      ? {
          chatName: chat.name,
          otherMembers: members.map((m) => ({ id: m.id, name: m.name })),
        }
      : undefined

  for (const item of speakList) {
    if (signal.aborted) break
    const bot = db.getBot(item.botId)
    if (!bot) continue
    await speakOne(chat.id, bot, text, item.hint, groupContext, signal)
  }

  // 7. 全部完成后触发后台记忆提取
  if (!signal.aborted)
    noteNewMessages(
      chatId,
      members.map((m) => m.id),
      1 + speakList.length,
    )
}

async function speakOne(
  chatId: string,
  bot: Bot,
  userText: string,
  hint: string,
  groupContext?: GroupContext,
  signal?: AbortSignal,
): Promise<void> {
  const memories = db.listMemories(bot.id, 30)
  const ctx: GroupContext | undefined = groupContext
    ? {
        ...groupContext,
        otherMembers: groupContext.otherMembers.filter((m) => m.id !== bot.id),
      }
    : undefined
  const systemPrompt = buildSystemPrompt(bot, memories, ctx)

  // 历史（最近 30 条）+ hint 作为用户消息前缀（加在最后一条真实用户消息上）
  const recent = db.listRecentMessages(chatId, 30)
  const history = toPiHistory(recent, bot)
  let userIdx = -1
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].sender_type === 'user') {
      userIdx = i
      break
    }
  }
  if (hint && userIdx >= 0) {
    history[userIdx] = {
      role: 'user',
      content: `(协调者提示: ${hint})\n${userText}`,
      timestamp: recent[userIdx].created_at,
    }
  }

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
