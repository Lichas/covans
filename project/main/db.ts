// main/db.ts — SQLite 打开、migration、DAO（SPEC §3）
// 注意：本模块不 import electron，以便冒烟脚本在纯 Node 下复用。
// 由 index.ts 调用 initDb(app.getPath('userData')) 完成初始化。
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  Attachment,
  Bot,
  BotInput,
  Chat,
  ChatMember,
  ChatSummary,
  ChatType,
  Memory,
  MemoryKind,
  Message,
  MessageStatus,
  Provider,
  ProviderInput,
  SenderType,
  UserProfile,
  UserMemory,
  AgentThread,
  AgentPrivateMessage,
} from '../shared/types'
import { emitEvent } from './events'

export type Db = Database.Database

let db: Db | null = null

const MIGRATION = `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  default_model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  provider_id TEXT REFERENCES providers(id),
  model TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  reasoning_effort TEXT NOT NULL DEFAULT 'off',
  workspace_dir TEXT NOT NULL DEFAULT '',
  notify INTEGER NOT NULL DEFAULT 1,
  is_coordinator INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  bot_id TEXT REFERENCES bots(id),
  coordinator_bot_id TEXT REFERENCES bots(id),
  last_message_at INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id TEXT NOT NULL REFERENCES chats(id),
  bot_id TEXT NOT NULL REFERENCES bots(id),
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (chat_id, bot_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  sender_type TEXT NOT NULL,
  sender_bot_id TEXT,
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  mentions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'done',
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  kind TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_bot ON memories(bot_id, created_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  source TEXT NOT NULL DEFAULT 'manual',
  source_bot_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_threads (
  id TEXT PRIMARY KEY,
  parent_chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  origin_message_id TEXT NOT NULL,
  from_bot_id TEXT NOT NULL,
  to_bot_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_threads_chat ON agent_threads(parent_chat_id, created_at);
CREATE TABLE IF NOT EXISTS agent_private_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  sender_bot_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`

/** 打开（必要时创建）数据库并执行 migration。dir 为 userData 目录。 */
export function initDb(dir: string): Db {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'legacy.db')
  const d = new Database(file)
  d.pragma('journal_mode = WAL')
  d.pragma('foreign_keys = ON')
  d.exec(MIGRATION)
  const botColumns = d.pragma('table_info(bots)') as { name: string }[]
  if (!botColumns.some((column) => column.name === 'reasoning_effort')) {
    d.exec("ALTER TABLE bots ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'off'")
    // 旧版本的 Kimi Coding Plan 固定使用 high，迁移时保留原有行为。
    d.exec(
      "UPDATE bots SET reasoning_effort='high' WHERE provider_id IN (SELECT id FROM providers WHERE kind='kimi')",
    )
  }
  // 仅迁移明确指向 LM Studio 默认端口的旧“OpenAI 兼容”配置。
  d.exec(
    `UPDATE providers SET kind='lm-studio'
     WHERE kind='openai-compatible'
       AND (lower(base_url) LIKE 'http://localhost:1234/%'
         OR lower(base_url) LIKE 'http://127.0.0.1:1234/%')`,
  )
  db = d
  return d
}

export function getDb(): Db {
  if (!db) throw new Error('数据库未初始化（initDb 未调用）')
  return db
}

export function newId(): string {
  return randomUUID()
}

export function getUserProfile(): UserProfile {
  const empty: UserProfile = {
    name: '',
    role: '',
    bio: '',
    preferences: '',
    goals: '',
    boundaries: '',
  }
  try {
    const saved = JSON.parse(getSetting('user_profile') || '{}')
    for (const key of Object.keys(empty) as (keyof UserProfile)[])
      if (typeof saved?.[key] === 'string')
        empty[key] = saved[key].slice(0, 5000)
    return empty
  } catch {
    return empty
  }
}

export function saveUserProfile(value: UserProfile): UserProfile {
  const profile = getUserProfile()
  for (const key of Object.keys(profile) as (keyof UserProfile)[]) {
    if (typeof value[key] !== 'string' || value[key].length > 5000)
      throw new Error('用户资料字段须为不超过 5000 字的文本')
    profile[key] = value[key].trim()
  }
  setSetting('user_profile', JSON.stringify(profile))
  emitEvent({ type: 'user-context-updated' })
  return profile
}

export function listUserMemories(limit = 200): UserMemory[] {
  return getDb()
    .prepare('SELECT * FROM user_memories ORDER BY created_at DESC LIMIT ?')
    .all(limit) as UserMemory[]
}

export function saveUserMemory(
  content: string,
  kind: MemoryKind = 'fact',
  source: UserMemory['source'] = 'manual',
  sourceBotId: string | null = null,
  id?: string,
): UserMemory {
  const text = content.trim()
  if (!text || text.length > 1000) throw new Error('记忆需要 1–1000 字')
  if (!['fact', 'preference', 'summary'].includes(kind))
    throw new Error('未知记忆类型')
  const existing = listUserMemories(10000).find(
    (m) =>
      m.id !== id &&
      m.content.replace(/\s/g, '').toLowerCase() ===
        text.replace(/\s/g, '').toLowerCase(),
  )
  if (existing) {
    if (id) throw new Error('已有相同内容的记忆，请修改内容或删除重复条目')
    return existing
  }
  const memory: UserMemory = {
    id: id || newId(),
    content: text,
    kind,
    source,
    source_bot_id: sourceBotId,
    created_at: Date.now(),
  }
  if (id) {
    const result = getDb()
      .prepare(
        "UPDATE user_memories SET content=?, kind=?, source='manual', source_bot_id=NULL WHERE id=?",
      )
      .run(text, kind, id)
    if (!result.changes) throw new Error('记忆不存在')
  } else
    getDb()
      .prepare(
        'INSERT INTO user_memories(id, content, kind, source, source_bot_id, created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(memory.id, text, kind, source, sourceBotId, memory.created_at)
  emitEvent({ type: 'user-context-updated' })
  return getDb()
    .prepare('SELECT * FROM user_memories WHERE id=?')
    .get(memory.id) as UserMemory
}

export function deleteUserMemory(id: string): void {
  getDb().prepare('DELETE FROM user_memories WHERE id=?').run(id)
  emitEvent({ type: 'user-context-updated' })
}

export function listAgentThreads(chatId: string): AgentThread[] {
  return getDb()
    .prepare(
      'SELECT * FROM agent_threads WHERE parent_chat_id=? ORDER BY created_at',
    )
    .all(chatId) as AgentThread[]
}

export function getAgentThread(id: string): {
  thread: AgentThread
  messages: AgentPrivateMessage[]
} {
  const thread = getDb()
    .prepare('SELECT * FROM agent_threads WHERE id=?')
    .get(id) as AgentThread | undefined
  if (!thread) throw new Error('私聊记录不存在')
  const messages = getDb()
    .prepare(
      'SELECT * FROM agent_private_messages WHERE thread_id=? ORDER BY created_at, rowid',
    )
    .all(id) as AgentPrivateMessage[]
  return { thread, messages }
}

export function createAgentThread(
  parentChatId: string,
  originMessageId: string,
  fromBotId: string,
  toBotId: string,
  subject: string,
): AgentThread {
  const now = Date.now()
  const thread: AgentThread = {
    id: newId(),
    parent_chat_id: parentChatId,
    origin_message_id: originMessageId,
    from_bot_id: fromBotId,
    to_bot_id: toBotId,
    subject,
    status: 'running',
    created_at: now,
    updated_at: now,
  }
  getDb()
    .prepare('INSERT INTO agent_threads VALUES(?,?,?,?,?,?,?,?,?)')
    .run(
      thread.id,
      parentChatId,
      originMessageId,
      fromBotId,
      toBotId,
      subject,
      'running',
      now,
      now,
    )
  return thread
}

export function addAgentPrivateMessage(
  threadId: string,
  botId: string,
  content: string,
  status: MessageStatus = 'done',
): AgentPrivateMessage {
  const message: AgentPrivateMessage = {
    id: newId(),
    thread_id: threadId,
    sender_bot_id: botId,
    content,
    status,
    error: '',
    created_at: Date.now(),
  }
  getDb()
    .prepare('INSERT INTO agent_private_messages VALUES(?,?,?,?,?,?,?)')
    .run(message.id, threadId, botId, content, status, '', message.created_at)
  return message
}

export function updateAgentPrivateMessage(
  id: string,
  content: string,
  status: MessageStatus,
  error = '',
): void {
  getDb()
    .prepare(
      'UPDATE agent_private_messages SET content=?, status=?, error=? WHERE id=?',
    )
    .run(content, status, error, id)
}

export function finishAgentThread(
  id: string,
  status: AgentThread['status'],
): void {
  getDb()
    .prepare('UPDATE agent_threads SET status=?, updated_at=? WHERE id=?')
    .run(status, Date.now(), id)
}

// ---------- row 映射 ----------

interface ProviderRow {
  id: string
  name: string
  kind: string
  api_key: string
  base_url: string
  default_model: string
  created_at: number
}
interface BotRow {
  id: string
  name: string
  avatar: string
  description: string
  tags: string
  system_prompt: string
  provider_id: string | null
  model: string
  temperature: number
  max_tokens: number
  reasoning_effort: Bot['reasoning_effort']
  workspace_dir: string
  notify: number
  is_coordinator: number
  pinned: number
  sort_order: number
  created_at: number
}
interface ChatRow {
  id: string
  type: string
  name: string
  bot_id: string | null
  coordinator_bot_id: string | null
  last_message_at: number
  unread: number
  created_at: number
}
interface MessageRow {
  id: string
  chat_id: string
  sender_type: string
  sender_bot_id: string | null
  content: string
  attachments: string
  mentions: string
  status: string
  error: string
  created_at: number
}
interface MemoryRow {
  id: string
  bot_id: string
  kind: string
  content: string
  source: string
  created_at: number
}

function toProvider(r: ProviderRow): Provider {
  return { ...r, kind: r.kind as Provider['kind'] }
}
function toBot(r: BotRow): Bot {
  return { ...r }
}
function toChat(r: ChatRow): Chat {
  return { ...r, type: r.type as ChatType }
}
function safeJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}
function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    chat_id: r.chat_id,
    sender_type: r.sender_type as SenderType,
    sender_bot_id: r.sender_bot_id,
    content: r.content,
    attachments: safeJsonArray<Attachment>(r.attachments),
    mentions: safeJsonArray<string>(r.mentions),
    status: r.status as MessageStatus,
    error: r.error,
    created_at: r.created_at,
  }
}
function toMemory(r: MemoryRow): Memory {
  return {
    ...r,
    kind: r.kind as MemoryKind,
    source: r.source as Memory['source'],
  }
}

// ---------- providers ----------

export function listProviders(): Provider[] {
  const rows = getDb()
    .prepare('SELECT * FROM providers ORDER BY created_at ASC')
    .all() as ProviderRow[]
  return rows.map(toProvider)
}

export function getProvider(id: string): Provider | null {
  const r = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id) as
    | ProviderRow
    | undefined
  return r ? toProvider(r) : null
}

export function saveProvider(input: ProviderInput): Provider {
  const now = Date.now()
  const baseUrl = normalizeProviderBaseUrl(input.kind, input.base_url ?? '')
  if (input.id) {
    const existing = getProvider(input.id)
    if (!existing) throw new Error('Provider 不存在')
    getDb()
      .prepare(
        'UPDATE providers SET name=?, kind=?, api_key=?, base_url=?, default_model=? WHERE id=?',
      )
      .run(
        input.name,
        input.kind,
        input.api_key ?? existing.api_key,
        input.base_url === undefined
          ? existing.base_url
          : normalizeProviderBaseUrl(input.kind, input.base_url),
        input.default_model ?? existing.default_model,
        input.id,
      )
    return getProvider(input.id)!
  }
  const id = newId()
  getDb()
    .prepare(
      'INSERT INTO providers (id,name,kind,api_key,base_url,default_model,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      id,
      input.name,
      input.kind,
      input.api_key ?? '',
      baseUrl,
      input.default_model ?? '',
      now,
    )
  return getProvider(id)!
}

function normalizeProviderBaseUrl(
  kind: ProviderInput['kind'],
  value: string,
): string {
  let base = value.trim().replace(/\/+$/, '')
  if (!base) return ''
  if (!/^https?:\/\//i.test(base))
    throw new Error('Base URL 必须以 http:// 或 https:// 开头')
  if (kind === 'openai-compatible' || kind === 'lm-studio') {
    base = base.replace(/\/v1\/chat\/completions$/i, '/v1')
    // LM Studio 原生 /api/v1/chat 不是 OpenAI 消息协议；切换到同服务的兼容入口。
    base = base.replace(/\/api\/v1\/chat$/i, '/v1')
  }
  return base
}

export function deleteProvider(id: string): void {
  getDb()
    .prepare('UPDATE bots SET provider_id = NULL WHERE provider_id = ?')
    .run(id)
  getDb().prepare('DELETE FROM providers WHERE id = ?').run(id)
}

// ---------- bots ----------

export function listBots(): Bot[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM bots ORDER BY pinned DESC, sort_order ASC, created_at ASC',
    )
    .all() as BotRow[]
  return rows.map(toBot)
}

export function getBot(id: string): Bot | null {
  const r = getDb().prepare('SELECT * FROM bots WHERE id = ?').get(id) as
    | BotRow
    | undefined
  return r ? toBot(r) : null
}

export function createBot(input: BotInput): Bot {
  if (input.pinned && listBots().filter((b) => b.pinned).length >= 3)
    throw new Error('最多置顶 3 个 Bot，请先取消一个置顶')
  const id = newId()
  const now = Date.now()
  const maxSort = (
    getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM bots')
      .get() as { m: number }
  ).m
  const provider = input.provider_id ? getProvider(input.provider_id) : null
  assertMaxTokens(input.max_tokens ?? 4096)
  const reasoningEffort =
    input.reasoning_effort ?? (provider?.kind === 'kimi' ? 'high' : 'off')
  assertReasoningEffort(reasoningEffort)
  getDb()
    .prepare(
      `INSERT INTO bots (id,name,avatar,description,tags,system_prompt,provider_id,model,
        temperature,max_tokens,reasoning_effort,workspace_dir,notify,is_coordinator,pinned,sort_order,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.name,
      input.avatar ?? '',
      input.description ?? '',
      input.tags ?? '',
      input.system_prompt ?? '',
      input.provider_id ?? null,
      input.model ?? '',
      input.temperature ?? 0.7,
      input.max_tokens ?? 4096,
      reasoningEffort,
      id, // workspace_dir 默认用 bot id
      input.notify === false ? 0 : 1,
      input.is_coordinator ? 1 : 0,
      input.pinned ? 1 : 0,
      maxSort + 1,
      now,
    )
  return getBot(id)!
}

export function updateBot(
  id: string,
  patch: Partial<BotInput> & { avatar?: string },
): Bot {
  const existing = getBot(id)
  if (!existing) throw new Error('Bot 不存在')
  if (
    patch.pinned &&
    !existing.pinned &&
    listBots().filter((b) => b.pinned).length >= 3
  )
    throw new Error('最多置顶 3 个 Bot，请先取消一个置顶')
  if (
    patch.name !== undefined &&
    (!patch.name.trim() || patch.name.length > 80)
  )
    throw new Error('Bot 名称需要 1–80 字')
  if (patch.reasoning_effort !== undefined)
    assertReasoningEffort(patch.reasoning_effort)
  if (patch.max_tokens !== undefined) assertMaxTokens(patch.max_tokens)
  const merged: Bot = {
    ...existing,
    name: patch.name ?? existing.name,
    avatar: patch.avatar ?? existing.avatar,
    description: patch.description ?? existing.description,
    tags: patch.tags ?? existing.tags,
    system_prompt: patch.system_prompt ?? existing.system_prompt,
    provider_id:
      patch.provider_id === undefined
        ? existing.provider_id
        : patch.provider_id,
    model: patch.model ?? existing.model,
    temperature: patch.temperature ?? existing.temperature,
    max_tokens: patch.max_tokens ?? existing.max_tokens,
    reasoning_effort: patch.reasoning_effort ?? existing.reasoning_effort,
    notify: patch.notify === undefined ? existing.notify : patch.notify ? 1 : 0,
    is_coordinator:
      patch.is_coordinator === undefined
        ? existing.is_coordinator
        : patch.is_coordinator
          ? 1
          : 0,
    pinned: patch.pinned === undefined ? existing.pinned : patch.pinned ? 1 : 0,
  }
  getDb()
    .prepare(
      `UPDATE bots SET name=?, avatar=?, description=?, tags=?, system_prompt=?, provider_id=?,
       model=?, temperature=?, max_tokens=?, reasoning_effort=?, notify=?, is_coordinator=?, pinned=? WHERE id=?`,
    )
    .run(
      merged.name,
      merged.avatar,
      merged.description,
      merged.tags,
      merged.system_prompt,
      merged.provider_id,
      merged.model,
      merged.temperature,
      merged.max_tokens,
      merged.reasoning_effort,
      merged.notify,
      merged.is_coordinator,
      merged.pinned,
      id,
    )
  emitEvent({ type: 'bot-updated', botId: id })
  return getBot(id)!
}

function assertReasoningEffort(value: string): asserts value is Bot['reasoning_effort'] {
  if (!['off', 'low', 'medium', 'high', 'xhigh'].includes(value))
    throw new Error('未知推理强度')
}

function assertMaxTokens(value: number): void {
  if (!Number.isInteger(value) || value < 64 || value > 131072)
    throw new Error('最大输出 Token 需要是 64–131072 的整数')
}

export function deleteBot(id: string): void {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM chat_members WHERE bot_id = ?').run(id)
    d.prepare('DELETE FROM memories WHERE bot_id = ?').run(id)
    d.prepare(
      'UPDATE chats SET coordinator_bot_id = NULL WHERE coordinator_bot_id = ?',
    ).run(id)
    const dmIds = (
      d
        .prepare("SELECT id FROM chats WHERE type='dm' AND bot_id=?")
        .all(id) as { id: string }[]
    ).map((r) => r.id)
    for (const cid of dmIds) {
      d.prepare('DELETE FROM messages WHERE chat_id = ?').run(cid)
      d.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(cid)
      d.prepare('DELETE FROM chats WHERE id = ?').run(cid)
    }
    d.prepare('DELETE FROM bots WHERE id = ?').run(id)
  })
  tx()
}

// ---------- chats ----------

export function getChat(id: string): Chat | null {
  const r = getDb().prepare('SELECT * FROM chats WHERE id = ?').get(id) as
    | ChatRow
    | undefined
  return r ? toChat(r) : null
}

export function listChatMembers(chatId: string): ChatMember[] {
  return getDb()
    .prepare('SELECT * FROM chat_members WHERE chat_id = ?')
    .all(chatId) as ChatMember[]
}

export function listMemberBots(chatId: string): Bot[] {
  const rows = getDb()
    .prepare(
      `SELECT b.* FROM chat_members m JOIN bots b ON b.id = m.bot_id
       WHERE m.chat_id = ? ORDER BY b.sort_order ASC, b.created_at ASC`,
    )
    .all(chatId) as BotRow[]
  return rows.map(toBot)
}

export function listChats(): ChatSummary[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM chats ORDER BY last_message_at DESC, created_at DESC',
    )
    .all() as ChatRow[]
  const previewStmt = getDb().prepare(
    'SELECT content FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1',
  )
  return rows.map((r) => {
    const chat = toChat(r)
    const preview =
      (previewStmt.get(chat.id) as { content: string } | undefined)?.content ??
      ''
    const member_bots = listMemberBots(chat.id).map((b) => ({
      id: b.id,
      name: b.name,
      avatar: b.avatar,
    }))
    return { ...chat, preview, member_bots }
  })
}

export function createDm(botId: string): Chat {
  // 同一 bot 的 dm 复用已有会话
  const existing = getDb()
    .prepare(
      "SELECT * FROM chats WHERE type='dm' AND bot_id = ? ORDER BY created_at ASC LIMIT 1",
    )
    .get(botId) as ChatRow | undefined
  if (existing) return toChat(existing)
  const id = newId()
  const now = Date.now()
  getDb()
    .prepare(
      "INSERT INTO chats (id,type,name,bot_id,coordinator_bot_id,last_message_at,unread,created_at) VALUES (?,'dm','',?,NULL,0,0,?)",
    )
    .run(id, botId, now)
  getDb()
    .prepare('INSERT INTO chat_members (chat_id,bot_id,role) VALUES (?,?,?)')
    .run(id, botId, 'member')
  return getChat(id)!
}

export function createGroup(
  name: string,
  memberBotIds: string[],
  coordinatorBotId?: string,
): Chat {
  const id = newId()
  const now = Date.now()
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare(
      "INSERT INTO chats (id,type,name,bot_id,coordinator_bot_id,last_message_at,unread,created_at) VALUES (?,'group',?,NULL,?,0,0,?)",
    ).run(id, name, coordinatorBotId ?? null, now)
    const ins = d.prepare(
      'INSERT OR IGNORE INTO chat_members (chat_id,bot_id,role) VALUES (?,?,?)',
    )
    for (const bid of memberBotIds) {
      ins.run(id, bid, bid === coordinatorBotId ? 'coordinator' : 'member')
    }
    if (coordinatorBotId && !memberBotIds.includes(coordinatorBotId)) {
      ins.run(id, coordinatorBotId, 'coordinator')
    }
  })
  tx()
  return getChat(id)!
}

export function updateChat(
  id: string,
  patch: { name?: string; coordinatorBotId?: string | null },
): void {
  const existing = getChat(id)
  if (!existing) throw new Error('会话不存在')
  getDb()
    .prepare('UPDATE chats SET name=?, coordinator_bot_id=? WHERE id=?')
    .run(
      patch.name ?? existing.name,
      patch.coordinatorBotId === undefined
        ? existing.coordinator_bot_id
        : patch.coordinatorBotId,
      id,
    )
}

export function deleteChat(id: string): void {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM messages WHERE chat_id = ?').run(id)
    d.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(id)
    d.prepare('DELETE FROM chats WHERE id = ?').run(id)
  })
  tx()
}

export function markRead(chatId: string): void {
  getDb().prepare('UPDATE chats SET unread = 0 WHERE id = ?').run(chatId)
}

export function touchChat(
  chatId: string,
  at: number,
  bumpUnread = false,
): void {
  getDb()
    .prepare(
      'UPDATE chats SET last_message_at = ?, unread = unread + ? WHERE id = ?',
    )
    .run(at, bumpUnread ? 1 : 0, chatId)
}

// ---------- messages ----------

export interface InsertMessageInput {
  chat_id: string
  sender_type: SenderType
  sender_bot_id?: string | null
  content: string
  attachments?: Attachment[]
  mentions?: string[]
  status?: MessageStatus
  error?: string
}

export function insertMessage(input: InsertMessageInput): Message {
  const id = newId()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO messages (id,chat_id,sender_type,sender_bot_id,content,attachments,mentions,status,error,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.chat_id,
      input.sender_type,
      input.sender_bot_id ?? null,
      input.content,
      JSON.stringify(input.attachments ?? []),
      JSON.stringify(input.mentions ?? []),
      input.status ?? 'done',
      input.error ?? '',
      now,
    )
  return getMessage(id)!
}

export function getMessage(id: string): Message | null {
  const r = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as
    | MessageRow
    | undefined
  return r ? toMessage(r) : null
}

export function updateMessage(
  id: string,
  patch: { content?: string; status?: MessageStatus; error?: string },
): Message {
  const existing = getMessage(id)
  if (!existing) throw new Error('消息不存在')
  getDb()
    .prepare('UPDATE messages SET content=?, status=?, error=? WHERE id=?')
    .run(
      patch.content ?? existing.content,
      patch.status ?? existing.status,
      patch.error ?? existing.error,
      id,
    )
  return getMessage(id)!
}

export function listMessages(
  chatId: string,
  before?: number,
  limit = 50,
): Message[] {
  const rows = (
    before !== undefined
      ? getDb()
          .prepare(
            'SELECT * FROM messages WHERE chat_id = ? AND created_at < ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
          )
          .all(chatId, before, limit)
      : getDb()
          .prepare(
            'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
          )
          .all(chatId, limit)
  ) as MessageRow[]
  // Include every row at the boundary timestamp so timestamp pagination cannot skip ties.
  const boundary = rows.at(-1)?.created_at
  if (boundary !== undefined && rows.length === limit) {
    const boundaryRows = getDb()
      .prepare(
        'SELECT * FROM messages WHERE chat_id = ? AND created_at = ? ORDER BY rowid DESC',
      )
      .all(chatId, boundary) as MessageRow[]
    return [
      ...rows.filter((row) => row.created_at !== boundary),
      ...boundaryRows,
    ]
      .map(toMessage)
      .reverse()
  }
  return rows.map(toMessage).reverse()
}

export function listRecentMessages(chatId: string, limit: number): Message[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    )
    .all(chatId, limit) as MessageRow[]
  return rows.map(toMessage).reverse()
}

/** 把 chat 里仍处在 streaming 状态的消息标记为 stopped（stopChat 用） */
export function stopStreamingMessages(chatId: string): void {
  getDb()
    .prepare(
      "UPDATE messages SET status='stopped' WHERE chat_id = ? AND status = 'streaming'",
    )
    .run(chatId)
}

// ---------- memories ----------

export function listMemories(botId: string, limit = 100): Memory[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM memories WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(botId, limit) as MemoryRow[]
  return rows.map(toMemory)
}

export function addMemory(
  botId: string,
  content: string,
  kind: MemoryKind = 'fact',
  source: 'auto' | 'manual' = 'manual',
): Memory {
  const id = newId()
  getDb()
    .prepare(
      'INSERT INTO memories (id,bot_id,kind,content,source,created_at) VALUES (?,?,?,?,?,?)',
    )
    .run(id, botId, kind, content, source, Date.now())
  const r = getDb()
    .prepare('SELECT * FROM memories WHERE id = ?')
    .get(id) as MemoryRow
  return toMemory(r)
}

export function deleteMemory(id: string): void {
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
}

// ---------- settings ----------

export function getSetting(key: string): string {
  const r = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return r?.value ?? ''
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    )
    .run(key, value)
}
