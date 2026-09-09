// main/memory.ts — 记忆系统（SPEC §6）：注入拼接 + 自动提取
import type { Bot, Memory, Message } from '../shared/types'
import * as db from './db'
import { completeOnce } from './agentRuntime'
import { MEMORY_EXTRACT_MARKER } from './mockProvider'

export interface GroupContext {
  chatName: string
  otherMembers: { id: string; name: string }[]
}

/**
 * 注入拼接：bot.system_prompt + 最近 30 条记忆 + 群聊上下文指令。
 */
export function buildSystemPrompt(
  bot: Bot,
  memories: Memory[],
  groupContext?: GroupContext,
): string {
  const parts: string[] = []
  const base = bot.system_prompt.trim()
  parts.push(
    base ||
      `你是 ${bot.name}。${bot.description || '请友好、简洁地用中文回复。'}`,
  )
  const profile = db.getUserProfile()
  const about = Object.entries(profile)
    .filter(([key, value]) => key !== 'avatar' && value.trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
  const sharedMemories = db.listUserMemories(60)
  if (about || sharedMemories.length)
    parts.push(
      `## 关于用户（所有 Bot 共享）\n${about}\n${sharedMemories.map((m) => '- ' + m.content).join('\n')}\n用户当前明确表达优先于旧记忆，不要推测未提供的个人事实。`,
    )
  parts.push(
    `## 应用能力\n你的 Bot ID 是 ${bot.id}，当前名称是「${bot.name}」。用户要求改名、修改设定或头像时，调用实际工具完成，不要只口头承诺。可以用 list_bots 查找其他 Bot，用 agent_private_chat 向另一位 Bot 咨询；私聊内容会在用户会话中留下可查看的记录。仅共享完成咨询所需的信息。用户明确要求记住的个人事实/偏好可以用 remember_user 保存。\n生图服务未配置时使用本地头像，并如实告知生成方式。`,
  )
  if (memories.length > 0) {
    const items = memories
      .slice(0, 30)
      .map((m) => `- ${m.content}`)
      .join('\n')
    parts.push(`## 你的长期记忆\n${items}`)
  }
  if (groupContext) {
    const others =
      groupContext.otherMembers.map((m) => m.name).join('、') || '（无）'
    parts.push(
      `## 群聊上下文\n你在群聊「${groupContext.chatName}」中，其他成员：${others}。` +
        `请用口语化中文简短回复，不要复述别人。`,
    )
  }
  return parts.join('\n\n')
}

// ---------- 自动提取 ----------

const EXTRACT_EVERY = 10
const counters = new Map<string, number>()

/**
 * 记录新消息；每 bot 每 chat 累计 10 条新消息时触发一次自动提取（异步、失败静默）。
 */
export function noteNewMessages(
  chatId: string,
  botIds: string[],
  count = 1,
): void {
  for (const botId of botIds) {
    const key = `${chatId}:${botId}`
    const n = (counters.get(key) ?? 0) + count
    if (n >= EXTRACT_EVERY) {
      counters.set(key, 0)
      const bot = db.getBot(botId)
      if (bot) {
        const recent = db.listRecentMessages(chatId, 30)
        void extractMemories(bot, recent).catch(() => {})
      }
    } else {
      counters.set(key, n)
    }
  }
}

/** 相似度去重：与现有记忆存在包含关系即跳过 */
function isDuplicate(content: string, existing: Memory[]): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const c = norm(content)
  if (!c) return true
  return existing.some((m) => {
    const e = norm(m.content)
    return e.includes(c) || c.includes(e)
  })
}

/**
 * 自动提取：用该 bot 自己的 provider/model 调一次非流式 completion，
 * 要求输出 JSON 数组字符串，去重后入库。失败静默。
 */
export async function extractMemories(
  bot: Bot,
  recentMessages: Message[],
): Promise<number> {
  try {
    if (recentMessages.length === 0) return 0
    const transcript = recentMessages
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
    const systemPrompt = [
      `${MEMORY_EXTRACT_MARKER}`,
      '你是记忆提取器。从最近的对话中提取「关于用户的事实/偏好/约定/重要事件」。',
      '只输出一个 JSON 数组（字符串元素），不要输出任何其他文字。没有可提取内容时输出 []。',
    ].join('\n')
    const raw = await completeOnce(bot, systemPrompt, transcript, {
      reasoning: 'off',
      maxTokens: 256,
      temperature: 0,
    })
    const jsonText = extractJsonArray(raw)
    if (!jsonText) return 0
    const arr = JSON.parse(jsonText) as unknown
    if (!Array.isArray(arr)) return 0
    const existing = db.listMemories(bot.id, 200)
    let added = 0
    for (const item of arr) {
      if (typeof item !== 'string') continue
      const content = item.trim()
      if (!content || content.length > 200) continue
      if (isDuplicate(content, existing)) continue
      db.addMemory(bot.id, content, 'fact', 'auto')
      existing.push({
        id: '',
        bot_id: bot.id,
        kind: 'fact',
        content,
        source: 'auto',
        created_at: Date.now(),
      })
      added += 1
    }
    return added
  } catch {
    return 0 // 失败静默
  }
}

function extractJsonArray(raw: string): string | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  return raw.slice(start, end + 1)
}
