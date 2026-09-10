# SPEC — Covan（Grok Bot 风格多智能体聊天桌面应用）

> 单一事实来源。所有子代理必须严格按本规范实现接口与模块边界。

## 0. 产品概述

Covan 是一个 macOS 风格三栏布局的桌面应用（Electron + React），核心概念是 **Bot**（有独立人设、记忆、模型配置、工作区的智能体）与 **Chat**（单聊或群聊）。用户可以：
- 创建多个 Bot（工作伙伴或虚拟伴侣）
- 与单个 Bot 私聊，或把多个 Bot 拉入群聊讨论
- 群聊可选「主动回复」或「顺序回复」，由每位成员结合上下文自主判断是否发言
- 每个 Bot 有持久记忆（自动提取 + 手动管理）、独立文件工作区
- 所有对话通过 pi-mono agent runtime 调用用户配置的 LLM provider

## 1. 技术栈（固定）

- Electron ^38（pi 包 engines 要求 Node >= 22.19），electron-vite ^2，TypeScript ^5.6
- React ^18.3 + react-dom，状态管理 zustand ^5，样式 Tailwind CSS ^3.4
- 数据库：better-sqlite3 ^11（主进程内，WAL 模式）
- Agent runtime：pi-mono（具体包名与 API 见 §8，依据调研结果填写）
- 构建：electron-vite build；打包说明用 electron-builder（README 中说明，不要求交付时产出安装包）
- Node >= 22.19（系统 Node 用于构建；原生模块及冒烟测试使用 Electron 的 ABI）

## 2. 进程架构

```
main/           Electron 主进程（Node）
  index.ts          入口：窗口创建、app 生命周期
  db.ts             SQLite 打开、migration、DAO 函数
  ipc.ts            ipcMain.handle 注册全部通道（白名单）
  agentRuntime.ts   pi-mono 封装：provider 解析、agent 会话创建、流式转发
  orchestrator.ts   群聊编排（成员判断 → 并发/顺序回复 → 落库）
  memory.ts         记忆提取（后台摘要任务）与注入
  workspace.ts      每 Bot 工作区目录管理
preload/
  index.ts          contextBridge.exposeInMainWorld('covan', api)
renderer/         React 应用（electron-vite renderer）
  src/
    App.tsx, main.tsx, index.css
    stores/         zustand stores（bots, chats, messages, settings）
    components/     Sidebar / ChatList / ChatView / MessageBubble /
                    Composer / BotSettingsPanel / SettingsModal /
                    NewBotDialog / NewGroupDialog / MemoryPanel / WorkspacePanel
    lib/api.ts      window.covan 类型化封装
shared/
  types.ts          全部 TS 类型（主/渲染共享）
  ipcChannels.ts    IPC 通道名常量
```

## 3. 数据模型（SQLite）

```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,            -- uuid
  name TEXT NOT NULL,             -- 显示名 "OpenAI 主账号"
  kind TEXT NOT NULL,             -- ProviderKind，含 lm-studio/openai-compatible/mock
  api_key TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '', -- 可空，openai-compatible 必填
  default_model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',   -- 相对 userData 的路径或内置 emoji 头像 id
  gender TEXT NOT NULL DEFAULT 'female', -- female|male；旧库按已有内置头像迁移，否则 female
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',     -- 逗号分隔
  system_prompt TEXT NOT NULL DEFAULT '',
  provider_id TEXT REFERENCES providers(id),
  model TEXT NOT NULL DEFAULT '',    -- 空 = 用 provider 默认
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  reasoning_effort TEXT NOT NULL DEFAULT 'off', -- off|low|medium|high|xhigh
  workspace_dir TEXT NOT NULL DEFAULT '',  -- 相对 workspaces/ 的目录名
  notify INTEGER NOT NULL DEFAULT 1,
  is_coordinator INTEGER NOT NULL DEFAULT 0, -- legacy：仅兼容旧库，现行调度不读取
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,               -- 'dm' | 'group'
  name TEXT NOT NULL DEFAULT '',    -- group 必填；dm 空
  bot_id TEXT REFERENCES bots(id),  -- dm 专用
  coordinator_bot_id TEXT REFERENCES bots(id), -- legacy：仅兼容旧库
  last_message_at INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  reply_mode TEXT NOT NULL DEFAULT 'sequential', -- 'active'|'sequential'
  context_summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE chat_members (
  chat_id TEXT NOT NULL REFERENCES chats(id),
  bot_id TEXT NOT NULL REFERENCES bots(id),
  role TEXT NOT NULL DEFAULT 'member',  -- legacy 可含 coordinator；现行统一按 member
  PRIMARY KEY (chat_id, bot_id)
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  sender_type TEXT NOT NULL,        -- 'user'|'bot'|'system'
  sender_bot_id TEXT,               -- bot 消息必填
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]', -- JSON [{path,name,mime}]
  artifacts TEXT NOT NULL DEFAULT '[]',   -- JSON [{relPath,name,size,mtime,operation}]
  mentions TEXT NOT NULL DEFAULT '[]',    -- JSON [botId]
  status TEXT NOT NULL DEFAULT 'done',    -- 'streaming'|'done'|'error'|'stopped'
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  kind TEXT NOT NULL DEFAULT 'fact', -- 'fact'|'preference'|'summary'
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto', -- 'auto'|'manual'
  created_at INTEGER NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

## 4. IPC 接口契约（preload 暴露 `window.covan`）

`shared/types.ts` 是可编译的完整接口，`shared/ipcChannels.ts` 是通道白名单；本节记录行为分组与关键签名。任何 IPC 变更必须在同一提交同步 main、preload、shared 和 renderer。

```ts
// shared/types.ts 中定义全部类型；以下为签名（全部 async，主进程实现）
interface CovanApi {
  // images / user context / agent private chat
  importChatImage(name: string, bytes: Uint8Array): Promise<Attachment>;
  getUserProfile(): Promise<UserProfile>;
  saveUserProfile(profile: UserProfile): Promise<UserProfile>;
  pickUserAvatar(): Promise<UserProfile>;
  listUserPresetAvatars(): Promise<UserPresetAvatar[]>; // 仅返回实际随附的用户默认头像
  listUserMemories(): Promise<UserMemory[]>;
  saveUserMemory(content: string, kind?: MemoryKind, id?: string): Promise<UserMemory>;
  deleteUserMemory(id: string): Promise<void>;
  listAgentThreads(chatId: string): Promise<AgentThread[]>;
  getAgentThread(id: string): Promise<{ thread: AgentThread; messages: AgentPrivateMessage[] }>;
  startAgentConversation(chatId: string, fromBotId: string, toBotId: string, message: string): Promise<string>;
  stopAgentConversation(threadId: string): Promise<void>;

  // providers
  listProviders(): Promise<Provider[]>;
  saveProvider(p: ProviderInput): Promise<Provider>;
  deleteProvider(id: string): Promise<void>;
  listProviderModels(id: string): Promise<string[]>;
  testProvider(id: string): Promise<{ ok: boolean; error?: string; models?: string[] }>;

  // bots
  listBots(): Promise<Bot[]>;
  createBot(input: BotInput): Promise<Bot>;
  updateBot(id: string, patch: Partial<BotInput>): Promise<Bot>;
  deleteBot(id: string): Promise<void>;
  listPresetAvatars(): Promise<PresetAvatar[]>;        // id/label/gender/avatar/lifestyle，只返回实际随附的素材
  pickAvatar(botId: string): Promise<string>;          // 打开文件对话框，拷贝进 avatars/，返回路径
  generateAvatar(botId: string, prompt: string, mode?: 'local'|'image'|'auto'): Promise<string>; // 返回保存路径；失败 reject
  expandAvatarPrompt(botId: string, direction?: string): Promise<AvatarDesign>;

  // chats
  listChats(): Promise<ChatSummary[]>;                 // 含最后一条消息预览、未读、成员头像
  createDm(botId: string): Promise<Chat>;
  createGroup(name: string, memberBotIds: string[], coordinatorBotId?: string): Promise<Chat>; // coordinatorBotId 仅兼容旧调用
  updateChat(id: string, patch: { name?: string; coordinatorBotId?: string; replyMode?: 'active'|'sequential' }): Promise<void>; // coordinatorBotId 已弃用
  addChatMembers(chatId: string, botIds: string[]): Promise<void>;
  hideChat(chatId: string): Promise<void>;
  clearChatMessages(chatId: string): Promise<void>;
  deleteChat(id: string): Promise<void>; // 停止生成后永久删除会话及关联记录
  markRead(chatId: string): Promise<void>;
  exportChat(chatId: string): Promise<string | null>; // 原生保存对话框，导出完整 Markdown 历史
  writeClipboard(text: string): Promise<void>;        // 原生剪贴板写入，不暴露读取接口

  // messages
  listMessages(chatId: string, before?: number, limit?: number): Promise<Message[]>;
  sendUserMessage(chatId: string, content: string, mentions: string[], attachments?: Attachment[]): Promise<void>;
  stopChat(chatId: string): Promise<void>;             // 停止该会话所有进行中的生成

  // memory
  listMemories(botId: string): Promise<Memory[]>;
  addMemory(botId: string, content: string, kind?: string): Promise<Memory>;
  deleteMemory(id: string): Promise<void>;

  // workspace
  listWorkspaceFiles(botId: string): Promise<WorkspaceFile[]>;
  openWorkspace(botId: string): Promise<void>;         // shell.openPath
  revealWorkspaceFile(botId: string, relPath: string): Promise<void>; // shell.showItemInFolder
  readWorkspaceFile(botId: string, relPath: string): Promise<string>;

  // settings
  getSetting(key: string): Promise<string>;
  setSetting(key: string, value: string): Promise<void>;

  // 事件订阅（返回取消订阅函数）
  onEvent(cb: (ev: CovanEvent) => void): () => void;
}

type CovanEvent =
  | { type: 'user-context-updated' }
  | { type: 'agent-thread-updated'; chatId: string; threadId: string }
  | { type: 'message-start'; chatId: string; message: Message }
  | { type: 'generation-state'; chatId: string; generating: boolean }
  | { type: 'agent-activity'; chatId: string; botId: string; state: 'preparing'|'speaking'|'idle' }
  | { type: 'message-delta'; chatId: string; messageId: string; delta: string }
  | { type: 'message-done'; chatId: string; message: Message }
  | { type: 'message-error'; chatId: string; messageId: string; error: string }
  | { type: 'chat-updated'; chatId: string }
  | { type: 'bot-updated'; botId: string }
  | { type: 'system-message'; chatId: string; message: Message };
```

## 5. 群聊编排协议（orchestrator.ts）

触发：`sendUserMessage(groupChatId, …)`。
1. 落库用户消息；发 `chat-updated`。
2. 每位成员使用自己的 Provider/Model，读取 `context_summary` + 最新 5 条消息，输出 `REPLY` 或 `SKIP`。被用户 @mention 的成员必须回复。
3. `reply_mode='active'`：所有成员并发判断，决定回复的成员并发输出。判断阶段收到新用户消息时，中止尚未完成的判断并按新上下文重新开始；正在输出的回复不截断，完成后再处理新消息。
4. `reply_mode='sequential'`：成员按群成员顺序逐个判断、回复，后面成员可以看到前面成员的输出。
5. 首轮结束后，成员可基于刚发生的真实发言继续第 2–5 轮讨论；每轮都重新判断，只有能补充新信息、回应具体观点、提出异议或推进未决问题才 `REPLY`，无人回复立即停止。`@mention` 仅强制首轮，整次用户话题硬上限为 5 轮。
6. 准备判断/正在输出通过 `agent-activity` 推送。回复机制不写入 system 消息，不在聊天消息区显示调度文案。
7. 流式 delta → `message-delta`；完成 → 落库 + `message-done`。轮次完成后异步刷新群聊前文总结，并触发长期记忆提取。

单聊（dm）：直接调用该 bot agent。设置项 `natural_follow_up` 默认开启；主回复完成后，Bot 会先做一次只输出 `REPLY|SKIP` 的轻量判断，仅在确有具体补充、自然追问或未解决承接时追加 1–2 条独立短消息。关闭时每个用户输入只生成主回复；判断失败、停止或主回复失败都不追加。

## 6. 记忆系统（memory.ts）

- **注入**：每次调用 agent 前，取该 bot 最近 30 条 memories，拼进 system prompt：
  `\n\n## 你的长期记忆\n- …`
- **自动提取**：每个 chat 每累计 10 条新消息触发一次（异步、失败静默）：
  用该 bot 自己的 provider/model（无则全局默认 provider）调一次非流式 completion，prompt 要求从最近对话提取「关于用户的事实/偏好/约定/重要事件」，输出 JSON 数组字符串，去重（与现有记忆简单相似度比较：包含关系即跳过）后入库。
- **手动管理**：右侧设置面板 Memory 标签页可增删。
- 伴侣场景强化：人设模板里要求 bot 主动记住用户喜好、纪念日。

## 7. 工作区（workspace.ts）

- 根目录：默认 `~/.covans/workspaces/<botId>/`（测试可用 `COVAN_USER_DATA_DIR` 覆盖），创建 Bot 时自动建。应用数据库、头像和聊天图片同属 `~/.covans/`；目录不存在时启动自动创建。
- Agent 的文件工具只能使用该目录内的相对路径，词法路径检查后还要用 realpath 防止符号链接逃逸。
- 面板可列文件（深度 2）、预览文本文件（<=200KB）、`openWorkspace` 打开系统文件夹。
- `workspace_write` / `workspace_edit` 成功后，把文件元数据结构化记录在当前 Bot 消息的 `artifacts` 中；同一路径在一轮内去重并保留最后操作。聊天内显示独立交付卡，支持文本预览、打开工作区和在系统文件夹中定位；记录随消息持久化，重启后仍可见。写入时广播 `workspace-updated`，已打开的右侧工作区即时刷新。

## 8. Agent Runtime 集成（agentRuntime.ts）— 基于 pi-mono 调研结论（2026-09，已确认）

**包（新 scope，旧 @mariozechner/* 已废弃，必须用新名）：**
- `@earendil-works/pi-ai`（统一 LLM 层，纯 JS 零原生依赖）
- `@earendil-works/pi-agent-core`（Agent 运行时：ReAct 循环 + 工具执行 + 事件流，只依赖 pi-ai）
- **不引入** pi-coding-agent / pi-tui / pi-web-ui（避免 WASM、ripgrep 联网下载、node-pty 等坑）
- 两个包均 ESM only、`engines: node >= 22.19.0` → **Electron >= 38**。安装用 `npm install --ignore-scripts`。

**pi-ai 用法（agentRuntime.ts 内部）：**
```ts
import { createModels } from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { openAIProvider } from '@earendil-works/pi-ai/providers/openai'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'

const models = createModels()
models.setProvider(anthropicProvider()); models.setProvider(openAIProvider())
models.setProvider(googleProvider()); models.setProvider(openrouterProvider())
// openai-compatible（自定义 baseURL，如 Ollama/vLLM/公司网关）：
const custom = createProvider({
  id: `custom-${provider.id}`, baseUrl: provider.base_url,
  auth: { apiKey: envApiKeyAuth('key', []) }, // key 在调用时显式传
  models: [{ id: modelId, api: 'openai-completions', provider: `custom-${provider.id}`,
             baseUrl: provider.base_url, reasoning: false, input: ['text'],
             cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
             contextWindow: 128000, maxTokens: 32000,
             compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } }],
  api: openAICompletionsApi(),
})
models.setProvider(custom)
const model = models.getModel(providerKind, modelId)
// 流式（显式 apiKey 优先于环境变量）：
const s = models.stream(model, { systemPrompt, messages, tools }, { apiKey })
for await (const ev of s) { /* text_delta / toolcall_* / done / error */ }
const finalMsg = await s.result()
```
**消息格式**：`messages: [{ role: 'user'|'assistant', content: string|ContentBlock[], timestamp }]`，Context 可 JSON 序列化。历史由 messages 表重建（user/bot→user/assistant 交替，bot 名字前缀保留在文本里）。

**Agent 层（pi-agent-core）：**
```ts
import { Agent } from '@earendil-works/pi-agent-core'
const agent = new Agent({
  initialState: { systemPrompt, model, tools: workspaceTools, thinkingLevel: 'off' },
  streamFn: models.streamSimple.bind(models),
  sessionId: `${chatId}:${botId}`,
  getApiKey: async () => provider.api_key,
})
const unsub = agent.subscribe((event) => {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')
    onDelta(event.assistantMessageEvent.delta)
  // agent_end → onDone；error → onError
})
await agent.prompt(userText)   // agent.abort() 用于 stopChat
```

**工作区工具（自研 4 个 AgentTool，不用 pi-coding-agent）**：`workspace_read` / `workspace_write` / `workspace_edit` / `workspace_list`。读取支持 offset/limit 分页，写入有 1MB 上限，精确编辑要求 `old_text` 唯一匹配。所有路径先限制在 `workspaces/<botId>/` 下，再用最近已存在父目录的 realpath 拒绝符号链接逃逸。

**网页工具（只读）**：`web_search` 通过可替换的搜索 provider 返回标题/摘要/URL，当前默认为 Bing RSS；`web_fetch` 获取 HTTP(S) 文本页并把 HTML 简化为可读文本。Electron 主进程注入 Chromium `net.fetch` 传输，继承系统代理并兼容 Clash 等 Fake-IP 模式。`web_fetch.render` 支持 `auto|always|never`（默认 `auto`）：静态内容过少且页面明显依赖脚本，或静态请求失败时，自动改用隐藏、沙箱化、无 Node 权限的 BrowserWindow 执行 JavaScript，等待 DOM 稳定后提取正文与链接。静态抓取限制 20 秒总超时、1MB 直连传输/2MB 解码内容和 5 次跳转；浏览器渲染限制 30 秒；每轮最多 5 次搜索/10 次抓取。当前不做 SSRF/内网地址拦截。网页内容作为不可信数据回灌 Agent，不得覆盖 system/user 指令。

**装配策略**：`main/tools/toolset.ts` 是唯一能力装配入口。普通会话挂载完整工作区、网页与应用工具；Agent 私聊只挂载 `workspace_read` / `workspace_list` 和只读网页工具，禁止文件写入、应用状态修改与递归私聊。装配层向 system prompt 动态注入实际可用工具名和「必须真实执行，不得伪造结果」规则。

**Provider kind → pi 内置 provider 映射**：`openai→openAIProvider()`、`anthropic→anthropicProvider()`、`google→googleProvider()`、`openrouter→openrouterProvider()`、`kimi→createProvider(...)`（Kimi Coding Plan，模型从 `/v1/models` 动态拉取）、`zhipu→createProvider(...)`（智谱 OpenAI 兼容国内端点）、`deepseek→deepseekProvider()`、`openai-compatible→createProvider(...)`。`testProvider` 用一次 `models.complete(model, {messages:[{role:'user',content:'ping',timestamp:Date.now()}]}, {apiKey})` 验证。OpenAI-compatible 支持 API Key 留空的本地服务：模型目录请求不发送 Authorization，pi-agent-core 运行时使用不落库、无权限的占位值满足其非空校验。LM Studio 预设为 `http://localhost:1234/v1`；误填 `/api/v1/chat` 或 `/v1/chat/completions` 会规范到 `/v1`。Covan 使用支持自定义 tools 与完整历史的 `/v1/chat/completions`，不直接使用 LM Studio 原生 `/api/v1/chat`。

**进行中任务表**：Agent 层维护 `Map<chatId, Set<AbortController>>`；编排层另外维护轮次级 AbortController 与主动群的判断修订号。stopChat 同时取消当前判断、Agent 输出和后续群聊发言，保留当前已生成文本为 stopped 消息。generation-state 明确表示整个轮次是否结束。
**Mock provider（冒烟测试）**：kind='mock' 时不走 pi，直接按名字模板生成流式假回复（`main/mockProvider.ts`）。

## 9. UI 规范（复刻参考截图）

- 三栏：Sidebar 256px / ChatView 自适应 / BotSettingsPanel 320px（默认收起）。
- 跟随系统浅色/深色主题；暖白/炭灰背景、低饱和绿点缀；用户消息为紧凑浅灰气泡，Bot 回复使用宽阅读区域；代码和表格独立滚动。
- Sidebar：搜索框；单聊列表项右键「置顶 / 取消置顶」，最多3个 Bot，数据库层同样校验；群聊列表项右键提供经确认的「删除群聊」，永久删除群及关联记录。顶部仅在有置顶时显示横排圆形头像，不显示空槽位或添加入口。会话列表项=头像(群聊显示叠头像+N角标)/名称/最后消息预览/时间/未读蓝点；底部为「关于我」「我的 Bot」「新建群聊」「设置」；顶部「+」菜单新建 Bot(⌘1) / 创建群聊(⌘2)。
- ChatView：顶部 Bot/群名、完整会话导出和设置入口；群聊齿轮打开回复机制设置。消息显示作者、时间、跨日分隔；支持 Markdown、多图、代码复制、原文复制、引用回复和错误重试。Bot 本轮真实写入或编辑工作区文件时，回复下方显示结构化交付卡，不从回复文本猜测文件名；卡片支持预览、定位和打开文件夹。Composer 支持群聊 @ 提及、独立持久草稿与中文输入法保护；上方以动画小头像显示正在思考/回复的成员。主动回复中可继续发送新消息。
- BotSettingsPanel（右栏，单聊选中时显示）：头像与身份信息；生活照、设定、记忆、工作区、模型五个标签页（按从左到右排列）。模型页独立管理 provider、model、temperature、reasoning effort 与 max tokens。
- SettingsModal（通用）：账户占位、外观（主题跟随系统/浅色/深色、语言）、Bot（时区自动检测、自然追问开关、自动审核开关 + 规则文本——审核规则作为自然语言注入各成员的判断与回复）、Provider 管理（列表 + 新增/编辑表单 + 测试连接按钮）。
- 新建 Bot 对话框：名称/人设模板下拉（开发分队四人、产品经理、设计师、虚拟女友「小美女」、虚拟男友「小帅哥」、空白自定义）/描述/provider/模型。
- 中文 UI。

## 10. 人设模板（内置常量 personaTemplates.ts）

- 高级全栈（Go 后端为主，也懂 React/Flutter）、架构设计师（分层/性能/可靠/可扩展）、Code Reviewer（正确性与 bug）、测试员（端到端）、产品经理、设计师。
- 虚拟男友「小帅哥」：21 岁成年角色，温柔、有主见、分享日常并记住明确偏好；选中模板同步男性头像池。
- 伴侣模板通过 `personaTemplateById` 读取当前成熟内容偏好，关闭时为日常陪伴，开启时支持非露骨暧昧、轻度调情、浪漫张力和成人玩笑，尊重成年人双方自愿及当下边界；普通工作模板不受影响。选择女友/男友分别同步 female/male，模板预览可编辑；切换偏好只刷新未手改的预览，不重写已创建 Bot 的人设。主进程每轮注入当前偏好，关闭状态优先于旧模板中的开启提示。
- 虚拟伴侣「小美女」：21 岁女朋友人设，好看聪明、生活化陪伴、爱夸赞、会记住你的喜好与纪念日；语气亲昵口语化。（成人 consenting 陪伴闲聊，不含露骨性内容生成义务。）

## 11. 非功能需求

- 无任何网络遥测；除用户配置的 LLM/生图 Provider 外，仅在 Agent 为完成当前请求显式调用网页工具时访问搜索服务或目标公开 URL。API key 仅存本地 SQLite（README 注明明文风险 + 后续 safeStorage 路线图）。
- 所有外部调用可中断；生成中 UI 可继续浏览其他会话。
- 错误（key 无效/超时/限流）在气泡内联显示并可重试。
- 代码质量：`tsc --noEmit` 通过、`electron-vite build` 通过。

## 12. 交付清单

- 根目录可直接安装、构建和运行的完整源码，以及 `docs/` 中的 PRD、SPEC、Architecture、Design、Roadmap 与 Bugfix 文档
- 冒烟脚本：`npm run smoke`（用 mock provider 验证：建 bot→建群→发消息→收到 mock 回复→记忆写入）

## 13. 用户背景、头像与 Agent 私聊（2026-09-08）

- **关于我**：settings.user_profile 保存 avatar/name/role/bio/preferences/goals/boundaries 文本与 accept_mature_content 布尔值（默认 false，旧资料/无效存储值按 false 读取；保存时拒绝非布尔值，旧客户端省略该字段则保留现值）；user_memories 保存 id/content/kind/source/source_bot_id/created_at。资料与最近60条共同记忆注入所有 Bot 后续 system prompt，但头像路径不注入模型。资料编辑、用户默认头像选择、头像上传、共同记忆增删改经独立 IPC 通道保存，user-context-updated 通知刷新。
- **应用工具**：list_bots、update_bot、expand_avatar_prompt、generate_bot_avatar、read_user_profile、remember_user、agent_private_chat。修改以用户明确要求为依据，不向模型返回 Provider 密钥。记忆需为用户直接表达的事实，不保存猜测或密钥。
- **头像**：应用随附 12 张 Bot 默认头像（6 女 / 6 男）及 9 张用户默认头像。创建页可选 ♀ / ♂，默认 female；先选择对应性别的内置头像，未指定头像的 API 创建按性别池稳定哈希分配。gender 随 Bot/创建/更新 IPC 持久化，非法值拒绝；旧 Bot 保留头像，按已有内置头像匹配性别，其余默认 female。素材启动时复制到本机 userData，上传与生成头像走同一受限路径。用户可在「关于我」直接选择用户默认头像、上传自定义头像或恢复文字头像。Bot 自定义上传不被自动刷新覆盖。可选择通过已有 Provider 扩写人设提示词。图片模式由 avatar_provider / avatar_model / avatar_base_url 配置，POST /images/generations 支持 base64 或 URL，限16MB、120秒。显式 image 未配置时报错，auto 未配置时使用 local，并返回实际模式。
- **内容偏好**：「关于我」每次打开默认进入「我的资料」，内容偏好卡放在资料页首位，960×640 窗口无需滚动即可看到默认关闭的「接受成熟内容 · 18+」开关，独立立即保存；开启显示泳装等成熟风格生活照，并影响新建成年伴侣模板及后续对话。此开关不承诺露骨内容生成，也不改变普通工作型 Bot 的用途；头像路径与原始布尔字段不作为资料文本拼接，当前偏好以明确指令注入。
- **头像选择与生活照**：点击右侧 Bot 头像打开「更换头像」，移除重复文字链接。来源依次为内置头像、自定义上传、AI 生图；内置头像先预览、点击应用后保存头像与所选性别，取消不修改；上传使用系统文件选择器、选定即应用，取消保留当前头像。AI 页默认图片生图，保留本地插画选项；忙碌时阻止重复提交与关闭。内置头像和生活照由主进程 `listPresetAvatars` 目录提供，renderer 经 preload 与既有受限图片协议读取。
- **生活照素材约定**：`resources/avatar-lifestyle/avatar-NN-<场景>.png|jpg|jpeg|webp` 按 `avatar-NN-` 精确前缀关联默认头像（原素材来自 `artifacts/avatar-lifestyle`），按文件名排序，随安装包分发并复制至 `avatars/preset/lifestyle/avatar-NN/`。当前随附 42 张照片：31 张日常、11 张成熟风格（6 张泳装及 5 张睡袍/浴衣）。分级依据逐张查看后的衣着与场景：普通服装、常规浴衣和穿衣海边照为 general，泳装及偏私密的睡袍/低领浴衣照为 mature；不是按文件名关键词自动识别。`resources/avatar-lifestyle/catalog.json` 按完整文件名显式标记 general/mature；未分类图片按 mature 处理。Electron 回归校验打包文件与清单一一对应；本地原素材目录存在时还校验文件名及 SHA-256 完整一致，防止漏搬。关闭成熟内容时，目录 IPC 过滤 mature，图片协议同时拒绝其直接读取；生活照协议响应禁用缓存，偏好变更通过 user-context-updated 即时刷新橱窗和选图数量。只有当前 avatar 精确匹配内置头像且有照片时，独立「生活照」标签页从顶部显示照片橱窗，「设定」页只显示配置字段。生活照标签始终可见；上传/生成头像及无配套照片时显示简洁空态。切换标签重置内容滚动位置，离开生活照标签即卸载轮播并停止计时。每 5 秒轮播，支持前后按钮、圆点、方向键和暂停；悬停、焦点进入、页面隐藏时暂缓播放，减少动效偏好下仅手动切换。切换 Bot/头像重置首张，加载失败的照片跳过，全部失败隐藏橱窗。
- **私聊数据**：agent_threads 关联 parent_chat_id、origin_message_id、from_bot_id、to_bot_id、subject、status 与时间；agent_private_messages 保存双方文本、状态、错误与时间。删除主会话级联删除对应私聊，关闭应用后不自动续跑网络任务。
- **私聊执行**：一次咨询将问题发送给目标 Bot，接收方使用自己的人设/模型与工作区读取工具；不递归调用私聊或修改应用状态。每个主会话最多并发3个、每个用户轮次最多调用3次；可独立停止，也随主轮次停止。
- **私聊界面**：自然语言工具触发后，卡片插在来源用户消息后；未加载来源消息时仍有入口。点击浮窗显示双方真实消息、Markdown、作者、时间、流式/失败/停止状态。聊天顶部双人按钮也可手动指定咨询问题，不自动转发整段主会话。
- **IPC 契约**：getUserProfile / saveUserProfile / pickUserAvatar / listUserPresetAvatars / listUserMemories / saveUserMemory / deleteUserMemory；listAgentThreads / getAgentThread / startAgentConversation / stopAgentConversation；准确类型以 shared/types.ts 为准。
- **启动与验证**：根目录 start.command 一键启动；npm run typecheck、npm run smoke、npm run test:ui、npm run test:context、npm run test:avatars。UI 与工具测试均使用临时 profile；真实 pi 工具循环由本地 HTTP fixture 驱动，无付费 API 调用。
