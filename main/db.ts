// main/db.ts — SQLite 打开、migration、DAO（SPEC §3）
// 注意：本模块不 import electron，以便冒烟脚本在纯 Node 下复用。
// 由 index.ts 调用 initDb(app.getPath('userData')) 完成初始化。
import { PRESET_AVATARS } from '../shared/presetAvatars'
import {
  isGroupBackground,
  randomGroupBackground,
} from '../shared/groupBackgrounds'
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
  MemorySummaryState,
  Message,
  MessageStatus,
  Provider,
  ProviderInput,
  SenderType,
  UserProfile,
  UserMemory,
  AgentThread,
  AgentPrivateMessage,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskStatus,
  WorkspaceArtifact,
} from '../shared/types'
import { emitEvent } from './events'
import { assertTimeZone, localTimeZone, nextScheduledRun } from './scheduleUtils'

export type Db = Database.Database

let db: Db | null = null

const DEFAULT_MAX_TOKENS = 8192
const DEFAULT_REASONING_EFFORT: Bot['reasoning_effort'] = 'medium'

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
  gender TEXT NOT NULL DEFAULT 'female',
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  provider_id TEXT REFERENCES providers(id),
  model TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 8192,
  reasoning_effort TEXT NOT NULL DEFAULT 'medium',
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
  background_image TEXT NOT NULL DEFAULT '',
  last_message_at INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  reply_mode TEXT NOT NULL DEFAULT 'sequential',
  context_summary TEXT NOT NULL DEFAULT '',
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
  artifacts TEXT NOT NULL DEFAULT '[]',
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
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule TEXT NOT NULL DEFAULT 'cron',
  cron TEXT NOT NULL DEFAULT '',
  run_at INTEGER,
  timezone TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_bot ON scheduled_tasks(bot_id, next_run_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_chat ON scheduled_tasks(chat_id);
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
    d.exec(
      "ALTER TABLE bots ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'off'",
    )
    // 旧版本的 Kimi Coding Plan 固定使用 high，迁移时保留原有行为。
    d.exec(
      "UPDATE bots SET reasoning_effort='high' WHERE provider_id IN (SELECT id FROM providers WHERE kind='kimi')",
    )
  }
  if (!botColumns.some((column) => column.name === 'gender')) {
    d.exec("ALTER TABLE bots ADD COLUMN gender TEXT NOT NULL DEFAULT 'female'")
    for (const preset of PRESET_AVATARS.filter((p) => p.gender === 'male'))
      d.prepare("UPDATE bots SET gender='male' WHERE avatar=?").run(
        preset.avatar,
      )
  }
  const chatColumns = d.pragma('table_info(chats)') as { name: string }[]
  if (!chatColumns.some((column) => column.name === 'hidden'))
    d.exec('ALTER TABLE chats ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0')
  if (!chatColumns.some((column) => column.name === 'reply_mode'))
    d.exec(
      "ALTER TABLE chats ADD COLUMN reply_mode TEXT NOT NULL DEFAULT 'sequential'",
    )
  if (!chatColumns.some((column) => column.name === 'context_summary'))
    d.exec(
      "ALTER TABLE chats ADD COLUMN context_summary TEXT NOT NULL DEFAULT ''",
    )
  if (!chatColumns.some((column) => column.name === 'background_image'))
    d.exec(
      "ALTER TABLE chats ADD COLUMN background_image TEXT NOT NULL DEFAULT ''",
    )
  const messageColumns = d.pragma('table_info(messages)') as { name: string }[]
  if (!messageColumns.some((column) => column.name === 'artifacts'))
    d.exec("ALTER TABLE messages ADD COLUMN artifacts TEXT NOT NULL DEFAULT '[]'")
  // 仅迁移明确指向 LM Studio 默认端口的旧“OpenAI 兼容”配置。
  d.exec(
    `UPDATE providers SET kind='lm-studio'
     WHERE kind='openai-compatible'
       AND (lower(base_url) LIKE 'http://localhost:1234/%'
         OR lower(base_url) LIKE 'http://127.0.0.1:1234/%')`,
  )
  db = d
  seedMissingGroupBackgrounds()
  migrateMemories()
  return d
}

export function getDb(): Db {
  if (!db) throw new Error('数据库未初始化（initDb 未调用）')
  return db
}

export function newId(): string {
  return randomUUID()
}

const profileTextKeys = [
  'avatar',
  'name',
  'role',
  'bio',
  'preferences',
  'goals',
  'boundaries',
] as const

export function getUserProfile(): UserProfile {
  const empty: UserProfile = {
    avatar: '',
    name: '',
    role: '',
    bio: '',
    preferences: '',
    goals: '',
    boundaries: '',
    accept_mature_content: false,
  }
  try {
    const saved = JSON.parse(getSetting('user_profile') || '{}')
    for (const key of profileTextKeys)
      if (typeof saved?.[key] === 'string')
        empty[key] = saved[key].slice(0, 5000)
    empty.accept_mature_content = saved?.accept_mature_content === true
    return empty
  } catch {
    return empty
  }
}

export function saveUserProfile(value: UserProfile): UserProfile {
  const profile = getUserProfile()
  for (const key of profileTextKeys) {
    if (typeof value[key] !== 'string' || value[key].length > 5000)
      throw new Error('用户资料字段须为不超过 5000 字的文本')
    profile[key] = value[key].trim()
  }
  if (value.accept_mature_content !== undefined) {
    if (typeof value.accept_mature_content !== 'boolean')
      throw new Error('成熟内容偏好必须为布尔值')
    profile.accept_mature_content = value.accept_mature_content
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
  return getDb().transaction(() => {
    getDb()
      .prepare('INSERT INTO agent_private_messages VALUES(?,?,?,?,?,?,?)')
      .run(message.id, threadId, botId, content, status, '', message.created_at)
    capturePrivateMemory(message)
    return message
  })()
}

export function updateAgentPrivateMessage(
  id: string,
  content: string,
  status: MessageStatus,
  error = '',
): void {
  getDb().transaction(() => {
    const previous = getDb().prepare('SELECT status FROM agent_private_messages WHERE id=?').get(id) as { status: MessageStatus } | undefined
    if (!previous) return
    getDb()
      .prepare(
        'UPDATE agent_private_messages SET content=?, status=?, error=? WHERE id=?',
      )
      .run(content, status, error, id)
    if (status === 'done' && previous?.status !== 'done') {
      const message = getDb().prepare('SELECT * FROM agent_private_messages WHERE id=?').get(id) as AgentPrivateMessage
      capturePrivateMemory(message)
    }
  })()
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
  gender: Bot['gender']
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
  background_image: string
  last_message_at: number
  unread: number
  hidden: number
  reply_mode: 'active' | 'sequential'
  context_summary: string
  created_at: number
}
interface MessageRow {
  id: string
  chat_id: string
  sender_type: string
  sender_bot_id: string | null
  content: string
  attachments: string
  artifacts: string
  mentions: string
  status: string
  error: string
  created_at: number
}
interface ScheduledTaskRow {
  id: string
  bot_id: string
  chat_id: string
  title: string
  prompt: string
  schedule: string
  cron: string
  run_at: number | null
  timezone: string
  model: string
  enabled: number
  next_run_at: number | null
  last_run_at: number | null
  last_status: string
  last_error: string
  created_at: number
  updated_at: number
}
interface MemoryRow extends Omit<Memory, 'participants' | 'evidence'> {
  participants: string
  evidence: string
}

function toProvider(r: ProviderRow): Provider {
  return { ...r, kind: r.kind as Provider['kind'] }
}
function toBot(r: BotRow): Bot {
  return { ...r }
}
function toChat(r: ChatRow): Chat {
  return {
    ...r,
    type: r.type as ChatType,
    background_image: isGroupBackground(r.background_image)
      ? r.background_image
      : '',
  }
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
    artifacts: safeJsonArray<WorkspaceArtifact>(r.artifacts),
    mentions: safeJsonArray<string>(r.mentions),
    status: r.status as MessageStatus,
    error: r.error,
    created_at: r.created_at,
  }
}
function toScheduledTask(r: ScheduledTaskRow): ScheduledTask {
  return {
    ...r,
    schedule: r.schedule as ScheduledTask['schedule'],
    enabled: !!r.enabled,
    last_status: r.last_status as ScheduledTaskStatus,
  }
}
function toMemory(r: MemoryRow): Memory {
  return {
    ...r,
    kind: r.kind as MemoryKind,
    source: r.source as Memory['source'],
    participants: safeJsonArray<string>(r.participants),
    evidence: safeJsonArray<string>(r.evidence),
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
  assertGender(input.gender ?? 'female')
  if (input.pinned && listBots().filter((b) => b.pinned).length >= 3)
    throw new Error('最多置顶 3 个 Bot，请先取消一个置顶')
  const id = newId()
  const now = Date.now()
  const maxSort = (
    getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM bots')
      .get() as { m: number }
  ).m
  assertMaxTokens(input.max_tokens ?? DEFAULT_MAX_TOKENS)
  const reasoningEffort = input.reasoning_effort ?? DEFAULT_REASONING_EFFORT
  assertReasoningEffort(reasoningEffort)
  getDb()
    .prepare(
      `INSERT INTO bots (id,name,avatar,gender,description,tags,system_prompt,provider_id,model,
        temperature,max_tokens,reasoning_effort,workspace_dir,notify,is_coordinator,pinned,sort_order,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.name,
      input.avatar ?? '',
      input.gender ?? 'female',
      input.description ?? '',
      input.tags ?? '',
      input.system_prompt ?? '',
      input.provider_id ?? null,
      input.model ?? '',
      input.temperature ?? 0.7,
      input.max_tokens ?? DEFAULT_MAX_TOKENS,
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
  if (patch.gender !== undefined) assertGender(patch.gender)
  if (patch.reasoning_effort !== undefined)
    assertReasoningEffort(patch.reasoning_effort)
  if (patch.max_tokens !== undefined) assertMaxTokens(patch.max_tokens)
  const merged: Bot = {
    ...existing,
    name: patch.name ?? existing.name,
    avatar: patch.avatar ?? existing.avatar,
    gender: patch.gender ?? existing.gender,
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
      `UPDATE bots SET name=?, avatar=?, gender=?, description=?, tags=?, system_prompt=?, provider_id=?,
       model=?, temperature=?, max_tokens=?, reasoning_effort=?, notify=?, is_coordinator=?, pinned=? WHERE id=?`,
    )
    .run(
      merged.name,
      merged.avatar,
      merged.gender,
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

function assertGender(value: string): void {
  if (value !== 'female' && value !== 'male') throw new Error('未知 Bot 性别')
}

function assertReasoningEffort(
  value: string,
): asserts value is Bot['reasoning_effort'] {
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
      'SELECT * FROM chats WHERE hidden=0 ORDER BY last_message_at DESC, created_at DESC',
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

function seedMissingGroupBackgrounds(): void {
  const rows = getDb()
    .prepare(
      "SELECT id FROM chats WHERE type='group' AND background_image=''",
    )
    .all() as { id: string }[]
  if (!rows.length) return
  const update = getDb().prepare('UPDATE chats SET background_image=? WHERE id=?')
  getDb().transaction(() => {
    for (const row of rows) update.run(randomGroupBackground(), row.id)
  })()
}

export function createDm(botId: string): Chat {
  // 同一 bot 的 dm 复用已有会话
  const existing = getDb()
    .prepare(
      "SELECT * FROM chats WHERE type='dm' AND bot_id = ? ORDER BY created_at ASC LIMIT 1",
    )
    .get(botId) as ChatRow | undefined
  if (existing) {
    if (existing.hidden)
      getDb().prepare('UPDATE chats SET hidden=0 WHERE id=?').run(existing.id)
    return getChat(existing.id)!
  }
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
  const background = randomGroupBackground()
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare(
      "INSERT INTO chats (id,type,name,bot_id,coordinator_bot_id,background_image,last_message_at,unread,created_at) VALUES (?,'group',?,NULL,?,?,0,0,?)",
    ).run(id, name, coordinatorBotId ?? null, background, now)
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
  patch: {
    name?: string
    coordinatorBotId?: string | null
    replyMode?: 'active' | 'sequential'
    backgroundImage?: string
  },
): void {
  const existing = getChat(id)
  if (!existing) throw new Error('会话不存在')
  const nextBackground =
    patch.backgroundImage === undefined
      ? existing.background_image
      : patch.backgroundImage
  if (nextBackground && !isGroupBackground(nextBackground))
    throw new Error('未知群聊背景')
  getDb()
    .prepare(
      'UPDATE chats SET name=?, coordinator_bot_id=?, reply_mode=?, background_image=? WHERE id=?',
    )
    .run(
      patch.name ?? existing.name,
      patch.coordinatorBotId === undefined
        ? existing.coordinator_bot_id
        : patch.coordinatorBotId,
      patch.replyMode ?? existing.reply_mode,
      nextBackground,
      id,
    )
}

export function updateChatSummary(id: string, summary: string): void {
  getDb()
    .prepare('UPDATE chats SET context_summary=? WHERE id=?')
    .run(summary.slice(0, 6000), id)
}

export function addChatMembers(chatId: string, botIds: string[]): void {
  const chat = getChat(chatId)
  if (!chat) throw new Error('会话不存在')
  if (chat.type !== 'group') throw new Error('单聊不能直接邀请成员，请创建群聊')
  const insert = getDb().prepare(
    'INSERT OR IGNORE INTO chat_members (chat_id,bot_id,role) VALUES (?,?,?)',
  )
  for (const botId of botIds) {
    if (!getBot(botId)) throw new Error('Bot 不存在')
    insert.run(chatId, botId, 'member')
  }
}

export function hideChat(chatId: string): void {
  const chat = getChat(chatId)
  if (!chat) throw new Error('会话不存在')
  getDb().prepare('UPDATE chats SET hidden=1, unread=0 WHERE id=?').run(chatId)
}

export function clearChatMessages(chatId: string): void {
  if (!getChat(chatId)) throw new Error('会话不存在')
  const d = getDb()
  d.transaction(() => {
    d.prepare('DELETE FROM agent_threads WHERE parent_chat_id=?').run(chatId)
    d.prepare('DELETE FROM messages WHERE chat_id=?').run(chatId)
    d.prepare(
      "UPDATE chats SET last_message_at=0, unread=0, context_summary='' WHERE id=?",
    ).run(chatId)
  })()
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

// ---------- scheduled tasks ----------

export function listScheduledTasks(botId?: string): ScheduledTask[] {
  const rows = (botId
    ? getDb()
        .prepare(
          'SELECT * FROM scheduled_tasks WHERE bot_id=? ORDER BY enabled DESC, next_run_at ASC, created_at DESC',
        )
        .all(botId)
    : getDb()
        .prepare(
          'SELECT * FROM scheduled_tasks ORDER BY enabled DESC, next_run_at ASC, created_at DESC',
        )
        .all()) as ScheduledTaskRow[]
  return rows.map(toScheduledTask)
}

export function getScheduledTask(id: string): ScheduledTask | null {
  const row = getDb()
    .prepare('SELECT * FROM scheduled_tasks WHERE id=?')
    .get(id) as ScheduledTaskRow | undefined
  return row ? toScheduledTask(row) : null
}

function validateScheduledTask(input: ScheduledTaskInput): {
  title: string
  prompt: string
  schedule: ScheduledTask['schedule']
  cron: string
  runAt: number | null
  timezone: string
  model: string
  enabled: boolean
  nextRunAt: number | null
} {
  const title = input.title.trim()
  const prompt = input.prompt.trim()
  if (!title || title.length > 120) throw new Error('任务名称需要 1–120 字')
  if (!prompt || prompt.length > 8000) throw new Error('任务指令需要 1–8000 字')
  if (input.schedule !== 'once' && input.schedule !== 'cron')
    throw new Error('任务计划必须是单次或重复')
  const timezone = assertTimeZone(input.timezone || localTimeZone())
  const cron = (input.cron ?? '').trim()
  const runAt = input.run_at ?? null
  const enabled = input.enabled ?? true
  return {
    title,
    prompt,
    schedule: input.schedule,
    cron,
    runAt,
    timezone,
    model: (input.model ?? '').trim().slice(0, 300),
    enabled,
    nextRunAt: enabled
      ? nextScheduledRun(input.schedule, cron, runAt, timezone)
      : null,
  }
}

/** 创建或更新任务时，Bot 必须仍属于目标会话，避免后台回复投递到无关会话。 */
export function saveScheduledTask(input: ScheduledTaskInput): ScheduledTask {
  const bot = getBot(input.bot_id)
  const chat = getChat(input.chat_id)
  if (!bot || !chat) throw new Error('Bot 或目标会话不存在')
  if (!listMemberBots(chat.id).some((member) => member.id === bot.id))
    throw new Error('定时任务的 Bot 必须属于目标会话')
  const value = validateScheduledTask(input)
  const now = Date.now()
  if (input.id) {
    const existing = getScheduledTask(input.id)
    if (!existing) throw new Error('定时任务不存在')
    getDb()
      .prepare(
        `UPDATE scheduled_tasks SET bot_id=?,chat_id=?,title=?,prompt=?,schedule=?,cron=?,run_at=?,timezone=?,model=?,enabled=?,next_run_at=?,last_error='',updated_at=? WHERE id=?`,
      )
      .run(
        bot.id,
        chat.id,
        value.title,
        value.prompt,
        value.schedule,
        value.cron,
        value.runAt,
        value.timezone,
        value.model,
        value.enabled ? 1 : 0,
        value.nextRunAt,
        now,
        input.id,
      )
    emitEvent({ type: 'scheduled-tasks-updated', taskId: input.id })
    return getScheduledTask(input.id)!
  }
  const id = newId()
  getDb()
    .prepare(
      `INSERT INTO scheduled_tasks(id,bot_id,chat_id,title,prompt,schedule,cron,run_at,timezone,model,enabled,next_run_at,last_run_at,last_status,last_error,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,'idle','',?,?)`,
    )
    .run(
      id,
      bot.id,
      chat.id,
      value.title,
      value.prompt,
      value.schedule,
      value.cron,
      value.runAt,
      value.timezone,
      value.model,
      value.enabled ? 1 : 0,
      value.nextRunAt,
      now,
      now,
    )
  emitEvent({ type: 'scheduled-tasks-updated', taskId: id })
  return getScheduledTask(id)!
}

export function deleteScheduledTask(id: string): void {
  getDb().prepare('DELETE FROM scheduled_tasks WHERE id=?').run(id)
  emitEvent({ type: 'scheduled-tasks-updated', taskId: id })
}

export function updateScheduledTaskRuntime(
  id: string,
  patch: {
    enabled?: boolean
    nextRunAt?: number | null
    lastRunAt?: number | null
    lastStatus?: ScheduledTaskStatus
    lastError?: string
  },
): ScheduledTask | null {
  const existing = getScheduledTask(id)
  if (!existing) return null
  getDb()
    .prepare(
      'UPDATE scheduled_tasks SET enabled=?,next_run_at=?,last_run_at=?,last_status=?,last_error=?,updated_at=? WHERE id=?',
    )
    .run(
      patch.enabled === undefined ? (existing.enabled ? 1 : 0) : patch.enabled ? 1 : 0,
      patch.nextRunAt === undefined ? existing.next_run_at : patch.nextRunAt,
      patch.lastRunAt === undefined ? existing.last_run_at : patch.lastRunAt,
      patch.lastStatus ?? existing.last_status,
      patch.lastError === undefined ? existing.last_error : patch.lastError.slice(0, 1200),
      Date.now(),
      id,
    )
  const task = getScheduledTask(id)
  emitEvent({ type: 'scheduled-tasks-updated', taskId: id })
  return task
}

// ---------- messages ----------

export interface InsertMessageInput {
  chat_id: string
  sender_type: SenderType
  sender_bot_id?: string | null
  content: string
  attachments?: Attachment[]
  artifacts?: WorkspaceArtifact[]
  mentions?: string[]
  status?: MessageStatus
  error?: string
}

export function insertMessage(input: InsertMessageInput): Message {
  const id = newId()
  const now = Date.now()
  return getDb().transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO messages (id,chat_id,sender_type,sender_bot_id,content,attachments,artifacts,mentions,status,error,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.chat_id,
        input.sender_type,
        input.sender_bot_id ?? null,
        input.content,
        JSON.stringify(input.attachments ?? []),
        JSON.stringify(input.artifacts ?? []),
        JSON.stringify(input.mentions ?? []),
        input.status ?? 'done',
        input.error ?? '',
        now,
      )
    const message = getMessage(id)!
    captureChatMemory(message)
    return message
  })()
}

export function getMessage(id: string): Message | null {
  const r = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as
    | MessageRow
    | undefined
  return r ? toMessage(r) : null
}

export function updateMessage(
  id: string,
  patch: {
    content?: string
    status?: MessageStatus
    error?: string
    attachments?: Attachment[]
    artifacts?: WorkspaceArtifact[]
  },
): Message {
  const existing = getMessage(id)
  if (!existing) throw new Error('消息不存在')
  return getDb().transaction(() => {
    getDb()
      .prepare(
        'UPDATE messages SET content=?, status=?, error=?, attachments=?, artifacts=? WHERE id=?',
      )
      .run(
        patch.content ?? existing.content,
        patch.status ?? existing.status,
        patch.error ?? existing.error,
        JSON.stringify(patch.attachments ?? existing.attachments),
        JSON.stringify(patch.artifacts ?? existing.artifacts),
        id,
      )
    const message = getMessage(id)!
    if (existing.status !== 'done') captureChatMemory(message)
    return message
  })()
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

const MEMORY_DAY = 86400000

function migrateMemories(): void {
  const d = getDb()
  const columns = d.pragma('table_info(memories)') as { name: string }[]
  const fields: Record<string, string> = {
    layer: "TEXT NOT NULL DEFAULT 'long'",
    source_type: "TEXT NOT NULL DEFAULT 'legacy'",
    source_id: "TEXT NOT NULL DEFAULT ''",
    scene_id: "TEXT NOT NULL DEFAULT ''",
    participants: "TEXT NOT NULL DEFAULT '[]'",
    speaker: "TEXT NOT NULL DEFAULT ''",
    evidence: "TEXT NOT NULL DEFAULT '[]'",
    expires_at: 'INTEGER',
    last_recalled_at: 'INTEGER',
    representation: "TEXT NOT NULL DEFAULT 'note'",
    updated_at: 'INTEGER NOT NULL DEFAULT 0',
  }
  d.transaction(() => {
    for (const [name, definition] of Object.entries(fields))
      if (!columns.some((column) => column.name === name))
        d.exec('ALTER TABLE memories ADD COLUMN ' + name + ' ' + definition)
    d.exec('CREATE INDEX IF NOT EXISTS idx_memories_scene ON memories(bot_id, scene_id, layer)')
    d.exec('CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(bot_id, source_id)')
    d.exec("CREATE TABLE IF NOT EXISTS memory_summary_states (bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, scene_id TEXT NOT NULL, status TEXT NOT NULL, source_cursor TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, PRIMARY KEY(bot_id, scene_id))")
    if (!columns.some((column) => column.name === 'representation')) {
      d.exec("UPDATE memories SET representation='verbatim' WHERE source_id!='' AND evidence=json_array(source_id)")
      d.exec("UPDATE memories SET representation='summary' WHERE source_id LIKE 'summary:%'")
      d.exec('UPDATE memories SET updated_at=created_at WHERE updated_at=0')
    }
    d.exec("UPDATE memories SET layer='evidence' WHERE representation='verbatim'")
    // Exact private-chat audience is recoverable; historical group membership is not.
    if (!getSetting('memory_v2_private_backfill')) {
      const rows = d.prepare("SELECT * FROM agent_private_messages WHERE status='done' ORDER BY created_at, rowid").all() as AgentPrivateMessage[]
      for (const message of rows) capturePrivateMemory(message)
      setSetting('memory_v2_private_backfill', '1')
    }
  })()
  maintainMemories()
}

type MemoryWrite = Omit<Memory, 'id' | 'representation' | 'updated_at'> & Partial<Pick<Memory, 'representation' | 'updated_at'>>

export function writeMemory(input: MemoryWrite): Memory {
  const memory: Memory = {
    ...input, id: newId(),
    representation: input.representation ?? (input.source_id && input.evidence[0] === input.source_id ? 'verbatim' : input.source_id ? 'summary' : 'note'),
    updated_at: input.updated_at ?? input.created_at,
  }
  getDb().prepare(
    'INSERT INTO memories (id,bot_id,kind,content,source,created_at,layer,source_type,source_id,scene_id,participants,speaker,evidence,expires_at,last_recalled_at,representation,updated_at) VALUES (@id,@bot_id,@kind,@content,@source,@created_at,@layer,@source_type,@source_id,@scene_id,@participants,@speaker,@evidence,@expires_at,@last_recalled_at,@representation,@updated_at)',
  ).run({ ...memory, participants: JSON.stringify(memory.participants), evidence: JSON.stringify(memory.evidence) })
  emitEvent({ type: 'memories-updated', botId: input.bot_id })
  return memory
}

let memoryObserver: ((botId: string, sceneId: string) => void) | undefined
export function setMemoryObserver(observer?: typeof memoryObserver): void {
  memoryObserver = observer
}

export function listMemorySummaryStates(botId: string): MemorySummaryState[] {
  return getDb().prepare('SELECT * FROM memory_summary_states WHERE bot_id=? ORDER BY updated_at DESC').all(botId) as MemorySummaryState[]
}

export function setMemorySummaryState(botId: string, sceneId: string, status: MemorySummaryState['status'], cursor = '', error = ''): void {
  if (!getBot(botId)) return
  getDb().prepare('INSERT INTO memory_summary_states (bot_id,scene_id,status,source_cursor,error,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(bot_id,scene_id) DO UPDATE SET status=excluded.status, source_cursor=CASE WHEN excluded.source_cursor=\'\' THEN memory_summary_states.source_cursor ELSE excluded.source_cursor END, error=excluded.error, updated_at=excluded.updated_at')
    .run(botId, sceneId, status, cursor, error, Date.now())
  emitEvent({ type: 'memories-updated', botId })
}

/** One scene summary, plus one stable card per short-memory window. */
export function saveSceneSummary(botId: string, sceneId: string, content: string, evidence: Memory[], layer: 'short' | 'episodic' = 'episodic', windowId = ''): Memory {
  const sourceId = layer === 'short'
    ? 'working-summary:' + sceneId + ':' + (windowId || evidence[0]?.source_id || 'empty')
    : 'scene-summary:' + sceneId
  if (layer === 'short')
    getDb().prepare('DELETE FROM memories WHERE bot_id=? AND source_id=?').run(botId, 'working-summary:' + sceneId)
  const row = getDb().prepare('SELECT * FROM memories WHERE bot_id=? AND source_id=?').get(botId, sourceId) as MemoryRow | undefined
  const now = Date.now()
  const fields: MemoryWrite = {
    bot_id: botId, kind: 'summary', content, source: 'auto', layer,
    source_type: evidence[0].source_type, source_id: sourceId, scene_id: sceneId,
    participants: [...new Set(evidence.flatMap((m) => m.participants))], speaker: '',
    evidence: evidence.map((m) => m.source_id), expires_at: now + (layer === 'short' ? 1 : 90) * MEMORY_DAY,
    last_recalled_at: row?.last_recalled_at ?? null, representation: 'summary',
    created_at: row?.created_at ?? now, updated_at: now,
  }
  if (!row) return writeMemory(fields)
  getDb().prepare('UPDATE memories SET content=?,participants=?,evidence=?,expires_at=?,updated_at=? WHERE id=?')
    .run(content, JSON.stringify(fields.participants), JSON.stringify(fields.evidence), fields.expires_at, now, row.id)
  emitEvent({ type: 'memories-updated', botId })
  return { ...fields, id: row.id, representation: 'summary', updated_at: now }
}

/** Every completed delivery is copied to its actual Bot audience atomically. */
function captureMemory(
  message: { id: string; content: string; status: MessageStatus; created_at: number },
  owners: string[], participants: string[], speaker: string,
  sourceType: 'chat' | 'private', sceneId: string,
): void {
  if (message.status !== 'done' || !message.content.trim()) return
  getDb().transaction(() => {
    for (const botId of new Set(owners)) {
      if (!getBot(botId)) continue
      if (getDb().prepare("SELECT 1 FROM memories WHERE bot_id=? AND source_id=? AND representation='verbatim'").get(botId, message.id)) continue
      writeMemory({
        bot_id: botId, kind: 'summary', content: message.content.slice(0, 12000), source: 'auto',
        layer: 'evidence', source_type: sourceType, source_id: message.id, scene_id: sceneId,
        participants, speaker, evidence: [message.id], created_at: message.created_at,
        expires_at: message.created_at + 90 * MEMORY_DAY, last_recalled_at: null,
      })
      memoryObserver?.(botId, sceneId)
    }
  })()
}

function captureChatMemory(message: Message): void {
  if (message.sender_type === 'system') return
  const owners = listMemberBots(message.chat_id).map((bot) => bot.id)
  captureMemory(message, owners, ['user', ...owners], message.sender_bot_id ?? 'user', 'chat', message.chat_id)
}

function capturePrivateMemory(message: AgentPrivateMessage): void {
  const thread = getDb().prepare('SELECT * FROM agent_threads WHERE id=?').get(message.thread_id) as AgentThread | undefined
  if (!thread) return
  const owners = [thread.from_bot_id, thread.to_bot_id]
  captureMemory(message, owners, owners, message.sender_bot_id, 'private', thread.id)
}

/** Automatic records age and expire. Manual and explicit long-term memories survive. */
export function maintainMemories(botId?: string, now = Date.now()): void {
  const scope = botId ? ' AND bot_id=@botId' : ''
  const params = botId ? { now, cutoff: now - MEMORY_DAY, botId } : { now, cutoff: now - MEMORY_DAY }
  getDb().prepare("DELETE FROM memories WHERE source='auto' AND expires_at IS NOT NULL AND expires_at <= @now" + scope).run(params)
  const owners = botId ? [{ id: botId }] : getDb().prepare('SELECT id FROM bots').all() as { id: string }[]
  for (const owner of owners)
    getDb().prepare("DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE bot_id=? AND source='auto' AND layer!='long' ORDER BY COALESCE(last_recalled_at, created_at) DESC, created_at DESC, rowid DESC LIMIT -1 OFFSET 2000)").run(owner.id)
}

export function markMemoriesRecalled(ids: string[]): void {
  const update = getDb().prepare('UPDATE memories SET last_recalled_at=? WHERE id=?')
  getDb().transaction(() => { for (const id of ids) update.run(Date.now(), id) })()
}

export function listMemories(botId: string, limit = -1): Memory[] {
  maintainMemories(botId)
  const rows = getDb()
    .prepare(
      'SELECT * FROM memories WHERE bot_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
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
  return writeMemory({
    bot_id: botId, content: content.trim(), kind, source, layer: 'long',
    source_type: source === 'manual' ? 'manual' : 'legacy', source_id: '', scene_id: '',
    participants: [], speaker: '', evidence: [], expires_at: null, last_recalled_at: null,
    created_at: Date.now(),
  })
}

export function deleteMemory(id: string): void {
  const row = getDb().prepare('SELECT * FROM memories WHERE id=?').get(id) as MemoryRow | undefined
  if (!row) return
  const memory = toMemory(row)
  getDb().transaction(() => {
    getDb().prepare('DELETE FROM memories WHERE id=?').run(id)
    // Forget the source and its summaries for this owner, without touching the peer.
    for (const evidenceId of memory.evidence)
      getDb().prepare('DELETE FROM memories WHERE bot_id=? AND id IN (SELECT m.id FROM memories m, json_each(m.evidence) e WHERE e.value=?)').run(memory.bot_id, evidenceId)
  })()
  emitEvent({ type: 'memories-updated', botId: memory.bot_id })
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
