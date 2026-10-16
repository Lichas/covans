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
export type ResponseDecisionStrategy = 'auto' | 'llm' | 'jev'

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

export type BotBackend = 'api' | 'codex-cli' | 'claude-cli'
export type LocalCliKind = Exclude<BotBackend, 'api'>
export type CliAccess = 'read-only' | 'workspace-write'
export interface LocalCliProbe {
  kind: LocalCliKind
  available: boolean
  path: string
  version: string
  error?: string
}

export type BotGender = 'female' | 'male'

export type McpTransport = 'stdio' | 'http' | 'sse'
export interface McpToolInfo { name: string; description: string }
export interface McpServer {
  id: string
  name: string
  transport: McpTransport
  command: string
  args: string[]
  cwd: string
  url: string
  enabled: boolean
  env_keys: string[]
  header_keys: string[]
  tools: McpToolInfo[]
  last_checked_at: number | null
  last_error: string
}
export interface McpServerInput {
  id?: string
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  enabled?: boolean
  /** Omitted preserves stored values; an empty object clears them. */
  env?: Record<string, string>
  headers?: Record<string, string>
}
export interface InstalledSkill {
  id: string
  name: string
  description: string
  compatibility: string
  source: string
  enabled: boolean
  file_count: number
  updated_at: number
}
export interface BotExtensions {
  mcpServerIds: string[]
  skillIds: string[]
}
export interface ExtensionCatalog {
  servers: McpServer[]
  skills: InstalledSkill[]
}

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
  backend: BotBackend
  cli_path: string
  cli_access: CliAccess
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
  response_decision_strategy: ResponseDecisionStrategy
  workspace_dir: string
  notify: number
  is_coordinator: number
  pinned: number
  sort_order: number
  created_at: number
}

export interface BotInput {
  backend?: BotBackend
  cli_path?: string
  cli_access?: CliAccess
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
  response_decision_strategy?: ResponseDecisionStrategy
  notify?: boolean
  is_coordinator?: boolean
  pinned?: boolean
}

export interface JevConfig {
  has_api_key: boolean
  model: string
  confidence_threshold: number
}

export interface JevConfigInput {
  /** Omitted preserves the stored key; an empty string clears it. */
  api_key?: string
  model?: string
  confidence_threshold?: number
}

export interface TestJevResult {
  ok: boolean
  model?: string
  latency_ms?: number
  error?: string
}

export type ChatType = 'dm' | 'group'
export type GroupReplyMode = 'active' | 'sequential'

export interface Chat {
  id: string
  type: ChatType
  name: string
  bot_id: string | null
  coordinator_bot_id: string | null
  background_image: string
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
  system_kind?: '' | 'topic_boundary'
  created_at: number
}

export interface ChatTopic {
  id: string
  chat_id: string
  boundary_message_id: string
  summary: string
  previous_message_count: number
  created_at: number
}

export interface ChatTopicState {
  latest_topic: ChatTopic | null
  current_message_count: number
  last_message_at: number | null
  suggestion_reason: 'long_context' | 'inactive' | null
}

export interface StartChatTopicResult {
  topic: ChatTopic
  marker: Message
}

export type MemoryKind = 'fact' | 'preference' | 'summary'
export type MemoryLayer = 'short' | 'episodic' | 'semantic' | 'long'

export interface Memory {
  id: string
  bot_id: string
  kind: MemoryKind
  content: string
  source: 'auto' | 'manual'
  layer: MemoryLayer | 'evidence'
  source_type: 'manual' | 'chat' | 'private' | 'legacy'
  source_id: string
  scene_id: string
  participants: string[]
  speaker: string
  evidence: string[]
  expires_at: number | null
  last_recalled_at: number | null
  representation: 'verbatim' | 'summary' | 'note'
  updated_at: number
  created_at: number
}

export interface MemorySummaryState {
  bot_id: string
  scene_id: string
  status: 'pending' | 'running' | 'ready' | 'error'
  source_cursor: string
  error: string
  updated_at: number
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

export type ScheduledTaskSchedule = 'once' | 'cron'
export type ScheduledTaskStatus =
  | 'idle'
  | 'running'
  | 'done'
  | 'error'
  | 'stopped'
  | 'missed'

/** Bot 的本地持久化定时 Agent 任务。空 model 表示继承 Bot 当前模型。 */
export interface ScheduledTask {
  id: string
  bot_id: string
  chat_id: string
  title: string
  prompt: string
  schedule: ScheduledTaskSchedule
  cron: string
  run_at: number | null
  timezone: string
  model: string
  enabled: boolean
  next_run_at: number | null
  last_run_at: number | null
  last_status: ScheduledTaskStatus
  last_error: string
  created_at: number
  updated_at: number
}

export interface ScheduledTaskInput {
  id?: string
  bot_id: string
  chat_id: string
  title: string
  prompt: string
  schedule: ScheduledTaskSchedule
  cron?: string
  run_at?: number | null
  timezone?: string
  /** 留空时沿用 Bot 当前的模型或 Provider 默认模型。 */
  model?: string
  enabled?: boolean
}

export interface AvatarDesign {
  prompt: string
  style: 'portrait' | 'robot' | 'cat' | 'abstract'
  palette: 'sage' | 'sand' | 'lavender' | 'ocean' | 'rose'
}

export type CovanEvent =
  | { type: 'user-context-updated' }
  | { type: 'memories-updated'; botId: string }
  | { type: 'agent-thread-updated'; chatId: string; threadId: string }
  | { type: 'message-start'; chatId: string; message: Message }
  | { type: 'generation-state'; chatId: string; generating: boolean }
  | {
      type: 'scheduled-task-state'
      chatId: string
      taskId: string
      running: boolean
    }
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
  | { type: 'scheduled-tasks-updated'; taskId?: string }
  | { type: 'extensions-updated'; botId?: string }
  | { type: 'system-message'; chatId: string; message: Message }

export interface TestProviderResult {
  ok: boolean
  error?: string
  models?: string[]
}

export interface DiagnosticReport {
  reference: string
  collectedAt: string
  loggingEnabled: boolean
  runtimeActive: boolean
  message: { id: string; chatId: string; botId: string | null; status: string; createdAt: number; outputChars: number; errorCode: string | null }
  currentModel: { provider: string; model: string; reasoning: string; maxTokens: number } | null
  events: { timestamp: string; event: string; fields: Record<string, string | number | boolean | null | (string | number | boolean | null)[]> }[]
  notes: string[]
}

export interface CovanApi {
  probeLocalCli(kind: LocalCliKind, executablePath?: string): Promise<LocalCliProbe>
  listExtensions(): Promise<ExtensionCatalog>
  saveMcpServer(input: McpServerInput): Promise<McpServer>
  deleteMcpServer(id: string): Promise<void>
  testMcpServer(id: string): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }>
  pickSkillDirectory(): Promise<string | null>
  installSkills(source: string, subdirectory?: string): Promise<InstalledSkill[]>
  readInstalledSkill(id: string): Promise<{ content: string; files: string[] }>
  setSkillEnabled(id: string, enabled: boolean): Promise<void>
  deleteSkill(id: string): Promise<void>
  getBotExtensions(botId: string): Promise<BotExtensions>
  setBotExtensions(botId: string, config: BotExtensions): Promise<BotExtensions>
  getDiagnosticReport(reference: string): Promise<DiagnosticReport>
  analyzeDiagnostic(reference: string, botId: string): Promise<string>
  cancelDiagnostic(): Promise<void>
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
  listScheduledTasks(botId?: string): Promise<ScheduledTask[]>
  saveScheduledTask(input: ScheduledTaskInput): Promise<ScheduledTask>
  deleteScheduledTask(id: string): Promise<void>
  runScheduledTask(id: string): Promise<void>
  expandAvatarPrompt(botId: string, direction?: string): Promise<AvatarDesign>
  listProviders(): Promise<Provider[]>
  saveProvider(p: ProviderInput): Promise<Provider>
  deleteProvider(id: string): Promise<void>
  listProviderModels(id: string): Promise<string[]>
  testProvider(id: string): Promise<TestProviderResult>
  getJevConfig(): Promise<JevConfig>
  saveJevConfig(input: JevConfigInput): Promise<JevConfig>
  testJev(): Promise<TestJevResult>

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
      backgroundImage?: string
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
  getChatTopicState(chatId: string): Promise<ChatTopicState>
  startChatTopic(chatId: string): Promise<StartChatTopicResult>
  sendUserMessage(
    chatId: string,
    content: string,
    mentions: string[],
    attachments?: Attachment[],
  ): Promise<void>
  stopChat(chatId: string): Promise<void>

  listMemories(botId: string): Promise<Memory[]>
  listMemorySummaryStates(botId: string): Promise<MemorySummaryState[]>
  refreshMemorySummaries(botId: string): Promise<void>
  addMemory(botId: string, content: string, kind?: MemoryKind): Promise<Memory>
  deleteMemory(id: string): Promise<void>

  listWorkspaceFiles(botId: string): Promise<WorkspaceFile[]>
  openWorkspace(botId: string): Promise<void>
  revealWorkspaceFile(botId: string, relPath: string): Promise<void>
  readWorkspaceFile(botId: string, relPath: string): Promise<string>

  getSetting(key: string): Promise<string>
  setSetting(key: string, value: string): Promise<void>
  openObservabilityLogs(): Promise<void>

  onEvent(cb: (ev: CovanEvent) => void): () => void
}

declare global {
  interface Window {
    covan: CovanApi
  }
}
