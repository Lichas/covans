// shared/types.ts — 主/渲染进程共享类型（SPEC §3 §4 的唯一实现）

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'kimi'
  | 'zhipu'
  | 'deepseek'
  | 'lm-studio'
  | 'openai-compatible'
  | 'mock'

export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

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

export type BotGender = 'female' | 'male'

export interface PresetAvatar {
  id: string
  label: string
  gender: BotGender
  avatar: string
  lifestyle: string[]
}

export interface UserPresetAvatar {
  id: string
  label: string
  avatar: string
}

export interface Bot {
  id: string
  name: string
  avatar: string
  gender: BotGender
  description: string
  tags: string
  system_prompt: string
  provider_id: string | null
  model: string
  temperature: number
  max_tokens: number
  reasoning_effort: ReasoningEffort
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
  gender?: BotGender
  description?: string
  tags?: string
  system_prompt?: string
  provider_id?: string | null
  model?: string
  temperature?: number
  max_tokens?: number
  reasoning_effort?: ReasoningEffort
  notify?: boolean
  is_coordinator?: boolean
  pinned?: boolean
}

export type ChatType = 'dm' | 'group'
export type GroupReplyMode = 'active' | 'sequential'

export interface Chat {
  id: string
  type: ChatType
  name: string
  bot_id: string | null
  coordinator_bot_id: string | null
  last_message_at: number
  unread: number
  /** 隐藏的单聊保留在本地，可从「我的 Bot」再次打开。 */
  hidden: number
  reply_mode: GroupReplyMode
  context_summary: string
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

export interface Attachment {
  path: string
  name: string
  mime: string
}

export interface WorkspaceArtifact {
  relPath: string
  name: string
  size: number
  mtime: number
  operation: 'write' | 'edit'
}

export interface Message {
  id: string
  chat_id: string
  sender_type: SenderType
  sender_bot_id: string | null
  content: string
  attachments: Attachment[]
  artifacts: WorkspaceArtifact[]
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

export interface UserProfile {
  accept_mature_content: boolean
  avatar: string
  name: string
  role: string
  bio: string
  preferences: string
  goals: string
  boundaries: string
}

export interface UserMemory {
  id: string
  content: string
  kind: MemoryKind
  source: 'manual' | 'agent' | 'auto'
  source_bot_id: string | null
  created_at: number
}

export interface AgentThread {
  id: string
  parent_chat_id: string
  origin_message_id: string
  from_bot_id: string
  to_bot_id: string
  subject: string
  status: 'running' | 'done' | 'error' | 'stopped'
  created_at: number
  updated_at: number
}

export interface AgentPrivateMessage {
  id: string
  thread_id: string
  sender_bot_id: string
  content: string
  status: MessageStatus
  error: string
  created_at: number
}

export interface AvatarDesign {
  prompt: string
  style: 'portrait' | 'robot' | 'cat' | 'abstract'
  palette: 'sage' | 'sand' | 'lavender' | 'ocean' | 'rose'
}

export type CovanEvent =
  | { type: 'user-context-updated' }
  | { type: 'agent-thread-updated'; chatId: string; threadId: string }
  | { type: 'message-start'; chatId: string; message: Message }
  | { type: 'generation-state'; chatId: string; generating: boolean }
  | {
      type: 'agent-activity'
      chatId: string
      botId: string
      state: 'preparing' | 'speaking' | 'idle'
    }
  | {
      type: 'message-delta'
      chatId: string
      messageId: string
      delta: string
    }
  | { type: 'message-done'; chatId: string; message: Message }
  | {
      type: 'message-error'
      chatId: string
      messageId: string
      error: string
    }
  | { type: 'chat-updated'; chatId: string }
  | { type: 'bot-updated'; botId: string }
  | { type: 'workspace-updated'; botId: string }
  | { type: 'system-message'; chatId: string; message: Message }

export interface TestProviderResult {
  ok: boolean
  error?: string
  models?: string[]
}

export interface CovanApi {
  importChatImage(name: string, bytes: Uint8Array): Promise<Attachment>
  getUserProfile(): Promise<UserProfile>
  saveUserProfile(profile: UserProfile): Promise<UserProfile>
  pickUserAvatar(): Promise<UserProfile>
  listUserPresetAvatars(): Promise<UserPresetAvatar[]>
  listUserMemories(): Promise<UserMemory[]>
  saveUserMemory(
    content: string,
    kind?: MemoryKind,
    id?: string,
  ): Promise<UserMemory>
  deleteUserMemory(id: string): Promise<void>
  listAgentThreads(chatId: string): Promise<AgentThread[]>
  getAgentThread(
    id: string,
  ): Promise<{ thread: AgentThread; messages: AgentPrivateMessage[] }>
  startAgentConversation(
    chatId: string,
    fromBotId: string,
    toBotId: string,
    message: string,
  ): Promise<string>
  stopAgentConversation(threadId: string): Promise<void>
  expandAvatarPrompt(botId: string, direction?: string): Promise<AvatarDesign>
  listProviders(): Promise<Provider[]>
  saveProvider(p: ProviderInput): Promise<Provider>
  deleteProvider(id: string): Promise<void>
  listProviderModels(id: string): Promise<string[]>
  testProvider(id: string): Promise<TestProviderResult>

  listPresetAvatars(): Promise<PresetAvatar[]>
  listBots(): Promise<Bot[]>
  createBot(input: BotInput): Promise<Bot>
  updateBot(id: string, patch: Partial<BotInput>): Promise<Bot>
  deleteBot(id: string): Promise<void>
  pickAvatar(botId: string): Promise<string>
  generateAvatar(
    botId: string,
    prompt: string,
    mode?: 'local' | 'image' | 'auto',
  ): Promise<string>

  listChats(): Promise<ChatSummary[]>
  createDm(botId: string): Promise<Chat>
  createGroup(
    name: string,
    memberBotIds: string[],
    coordinatorBotId?: string,
  ): Promise<Chat>
  updateChat(
    id: string,
    patch: {
      name?: string
      coordinatorBotId?: string | null
      replyMode?: GroupReplyMode
    },
  ): Promise<void>
  addChatMembers(chatId: string, botIds: string[]): Promise<void>
  hideChat(chatId: string): Promise<void>
  clearChatMessages(chatId: string): Promise<void>
  deleteChat(id: string): Promise<void>
  markRead(chatId: string): Promise<void>
  exportChat(chatId: string): Promise<string | null>
  writeClipboard(text: string): Promise<void>

  listMessages(
    chatId: string,
    before?: number,
    limit?: number,
  ): Promise<Message[]>
  sendUserMessage(
    chatId: string,
    content: string,
    mentions: string[],
    attachments?: Attachment[],
  ): Promise<void>
  stopChat(chatId: string): Promise<void>

  listMemories(botId: string): Promise<Memory[]>
  addMemory(botId: string, content: string, kind?: MemoryKind): Promise<Memory>
  deleteMemory(id: string): Promise<void>

  listWorkspaceFiles(botId: string): Promise<WorkspaceFile[]>
  openWorkspace(botId: string): Promise<void>
  revealWorkspaceFile(botId: string, relPath: string): Promise<void>
  readWorkspaceFile(botId: string, relPath: string): Promise<string>

  getSetting(key: string): Promise<string>
  setSetting(key: string, value: string): Promise<void>

  onEvent(cb: (ev: CovanEvent) => void): () => void
}

declare global {
  interface Window {
    covan: CovanApi
  }
}
