// shared/types.ts — 主/渲染进程共享类型（SPEC §3 §4 的唯一实现）

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'kimi'
  | 'zhipu'
  | 'deepseek'
  | 'openai-compatible'
  | 'mock'

export interface Provider {
  id: string
  name: string
  kind: ProviderKind
  api_key: string
  base_url: string
  default_model: string
  created_at: number
}

export interface ProviderInput {
  id?: string
  name: string
  kind: ProviderKind
  api_key?: string
  base_url?: string
  default_model?: string
}

export interface Bot {
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
  workspace_dir: string
  notify: number
  is_coordinator: number
  pinned: number
  sort_order: number
  created_at: number
}

export interface BotInput {
  name: string
  avatar?: string
  description?: string
  tags?: string
  system_prompt?: string
  provider_id?: string | null
  model?: string
  temperature?: number
  max_tokens?: number
  notify?: boolean
  is_coordinator?: boolean
  pinned?: boolean
}

export type ChatType = 'dm' | 'group'

export interface Chat {
  id: string
  type: ChatType
  name: string
  bot_id: string | null
  coordinator_bot_id: string | null
  last_message_at: number
  unread: number
  created_at: number
}

export interface ChatMember {
  chat_id: string
  bot_id: string
  role: 'member' | 'coordinator'
}

export interface ChatSummary extends Chat {
  preview: string
  member_bots: { id: string; name: string; avatar: string }[]
}

export type SenderType = 'user' | 'bot' | 'system'
export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped'

export interface Attachment { path: string; name: string; mime: string }

export interface Message {
  id: string
  chat_id: string
  sender_type: SenderType
  sender_bot_id: string | null
  content: string
  attachments: Attachment[]
  mentions: string[]
  status: MessageStatus
  error: string
  created_at: number
}

export type MemoryKind = 'fact' | 'preference' | 'summary'

export interface Memory {
  id: string
  bot_id: string
  kind: MemoryKind
  content: string
  source: 'auto' | 'manual'
  created_at: number
}

export interface WorkspaceFile {
  name: string
  relPath: string
  isDir: boolean
  size: number
  mtime: number
}

export type CovanEvent =
  | { type: 'message-delta'; chatId: string; messageId: string; delta: string }
  | { type: 'message-done'; chatId: string; message: Message }
  | { type: 'message-error'; chatId: string; messageId: string; error: string }
  | { type: 'chat-updated'; chatId: string }
  | { type: 'bot-updated'; botId: string }
  | { type: 'system-message'; chatId: string; message: Message }

export interface TestProviderResult {
  ok: boolean
  error?: string
  models?: string[]
}

export interface CovanApi {
  listProviders(): Promise<Provider[]>
  saveProvider(p: ProviderInput): Promise<Provider>
  deleteProvider(id: string): Promise<void>
  listProviderModels(id: string): Promise<string[]>
  testProvider(id: string): Promise<TestProviderResult>

  listBots(): Promise<Bot[]>
  createBot(input: BotInput): Promise<Bot>
  updateBot(id: string, patch: Partial<BotInput>): Promise<Bot>
  deleteBot(id: string): Promise<void>
  pickAvatar(botId: string): Promise<string>
  generateAvatar(botId: string, prompt: string): Promise<string>

  listChats(): Promise<ChatSummary[]>
  createDm(botId: string): Promise<Chat>
  createGroup(name: string, memberBotIds: string[], coordinatorBotId?: string): Promise<Chat>
  updateChat(id: string, patch: { name?: string; coordinatorBotId?: string | null }): Promise<void>
  deleteChat(id: string): Promise<void>
  markRead(chatId: string): Promise<void>

  listMessages(chatId: string, before?: number, limit?: number): Promise<Message[]>
  sendUserMessage(chatId: string, content: string, mentions: string[]): Promise<void>
  stopChat(chatId: string): Promise<void>

  listMemories(botId: string): Promise<Memory[]>
  addMemory(botId: string, content: string, kind?: MemoryKind): Promise<Memory>
  deleteMemory(id: string): Promise<void>

  listWorkspaceFiles(botId: string): Promise<WorkspaceFile[]>
  openWorkspace(botId: string): Promise<void>
  readWorkspaceFile(botId: string, relPath: string): Promise<string>

  getSetting(key: string): Promise<string>
  setSetting(key: string, value: string): Promise<void>

  onEvent(cb: (ev: CovanEvent) => void): () => void
}

declare global {
  interface Window { covan: CovanApi }
}
