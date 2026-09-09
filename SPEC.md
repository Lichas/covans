# SPEC — Covan（Grok Bot 风格多智能体聊天桌面应用）

> 单一事实来源。所有子代理必须严格按本规范实现接口与模块边界。

## 0. 产品概述

Covan 是一个 macOS 风格三栏布局的桌面应用（Electron + React），核心概念是 **Bot**（有独立人设、记忆、模型配置、工作区的智能体）与 **Chat**（单聊或群聊）。用户可以：
- 创建多个 Bot（工作伙伴或虚拟伴侣）
- 与单个 Bot 私聊，或把多个 Bot 拉入群聊讨论
- 群聊中由「协调 Bot」（coordinator）决定谁发言、说什么方向
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
  orchestrator.ts   群聊编排（协调者决策 → 成员依次发言 → 落库）
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
  kind TEXT NOT NULL,             -- 'openai'|'anthropic'|'google'|'openrouter'|'kimi'|'zhipu'|'deepseek'|'openai-compatible'
  api_key TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '', -- 可空，openai-compatible 必填
  default_model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',   -- 相对 userData 的路径或内置 emoji 头像 id
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',     -- 逗号分隔
  system_prompt TEXT NOT NULL DEFAULT '',
  provider_id TEXT REFERENCES providers(id),
  model TEXT NOT NULL DEFAULT '',    -- 空 = 用 provider 默认
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  reasoning_effort TEXT NOT NULL DEFAULT 'off',
  workspace_dir TEXT NOT NULL DEFAULT '',  -- 相对 workspaces/ 的目录名
  notify INTEGER NOT NULL DEFAULT 1,
  is_coordinator INTEGER NOT NULL DEFAULT 0, -- 可作为群聊协调者
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,               -- 'dm' | 'group'
  name TEXT NOT NULL DEFAULT '',    -- group 必填；dm 空
  bot_id TEXT REFERENCES bots(id),  -- dm 专用
  coordinator_bot_id TEXT REFERENCES bots(id), -- group 专用，可空
  last_message_at INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE chat_members (
  chat_id TEXT NOT NULL REFERENCES chats(id),
  bot_id TEXT NOT NULL REFERENCES bots(id),
  role TEXT NOT NULL DEFAULT 'member',  -- 'member'|'coordinator'
  PRIMARY KEY (chat_id, bot_id)
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  sender_type TEXT NOT NULL,        -- 'user'|'bot'|'system'
  sender_bot_id TEXT,               -- bot 消息必填
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]', -- JSON [{path,name,mime}]
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

```ts
// shared/types.ts 中定义全部类型；以下为签名（全部 async，主进程实现）
interface CovanApi {
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
  pickAvatar(botId: string): Promise<string>;          // 打开文件对话框，拷贝进 avatars/，返回路径
  generateAvatar(botId: string, prompt: string, mode?: 'local'|'image'|'auto'): Promise<string>; // 返回保存路径；失败 reject
  expandAvatarPrompt(botId: string, direction?: string): Promise<AvatarDesign>;

  // chats
  listChats(): Promise<ChatSummary[]>;                 // 含最后一条消息预览、未读、成员头像
  createDm(botId: string): Promise<Chat>;
  createGroup(name: string, memberBotIds: string[], coordinatorBotId?: string): Promise<Chat>;
  updateChat(id: string, patch: { name?: string; coordinatorBotId?: string }): Promise<void>;
  deleteChat(id: string): Promise<void>;
  markRead(chatId: string): Promise<void>;
  exportChat(chatId: string): Promise<string | null>;  -- 原生保存对话框，导出完整 Markdown 历史
  writeClipboard(text: string): Promise<void>;        -- 原生剪贴板写入，不暴露读取接口

  // messages
  listMessages(chatId: string, before?: number, limit?: number): Promise<Message[]>;
  sendUserMessage(chatId: string, content: string, mentions: string[]): Promise<void>;
  stopChat(chatId: string): Promise<void>;             -- 停止该会话所有进行中的生成

  // memory
  listMemories(botId: string): Promise<Memory[]>;
  addMemory(botId: string, content: string, kind?: string): Promise<Memory>;
  deleteMemory(id: string): Promise<void>;

  // workspace
  listWorkspaceFiles(botId: string): Promise<WorkspaceFile[]>;
  openWorkspace(botId: string): Promise<void>;         -- shell.openPath
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
2. 构建群聊 transcript（最近 30 条，格式 `[名字]: 内容`）。
3. 若群配置了 coordinator：调用 coordinator agent，工具不限，但要求其**只输出 JSON**：
   `{"speak": [{"botId": "...", "hint": "要说什么的简短指令"}, ...], "note": "系统条文本，如：已发消息给 3 个 Bot"}`
   - 解析失败兜底：所有被 @mention 的 bot + coordinator 自己发言。
   - 用户 @mention 的 bot 强制加入 speak 列表首位。
4. 若无 coordinator：被 mention 的 bot 发言；无 mention 则全体成员按 sort_order 发言（最多 5 人）。
5. 写入一条 system 消息（note）。
6. 依次（串行）对每个 speak 项调用对应 Bot 的 agent：
   - system prompt = bot.system_prompt + 记忆注入 + 群聊上下文指令（"你在群聊 X 中，其他成员：…，请用口语化中文简短回复，不要复述别人"）
   - hint 作为用户消息前缀：`(协调者提示: hint)`
   - 流式 delta → `message-delta` 事件；完成 → 落库 + `message-done`。
7. 全部完成后触发后台记忆提取（memory.ts）。

单聊（dm）：直接调用该 bot agent，流程同 6。

## 6. 记忆系统（memory.ts）

- **注入**：每次调用 agent 前，取该 bot 最近 30 条 memories，拼进 system prompt：
  `\n\n## 你的长期记忆\n- …`
- **自动提取**：每个 chat 每累计 10 条新消息触发一次（异步、失败静默）：
  用该 bot 自己的 provider/model（无则全局默认 provider）调一次非流式 completion，prompt 要求从最近对话提取「关于用户的事实/偏好/约定/重要事件」，输出 JSON 数组字符串，去重（与现有记忆简单相似度比较：包含关系即跳过）后入库。
- **手动管理**：右侧设置面板 Memory 标签页可增删。
- 伴侣场景强化：人设模板里要求 bot 主动记住用户喜好、纪念日。

## 7. 工作区（workspace.ts）

- 根目录：`app.getPath('userData')/workspaces/<botId>/`，创建 bot 时自动建。
- agent 运行时 cwd 设为该目录（pi 的文件工具限定其中）。
- 面板可列文件（深度 2）、预览文本文件（<=200KB）、`openWorkspace` 打开系统文件夹。

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

**工作区工具（自研 3 个 AgentTool，不用 pi-coding-agent）**：`workspace_read` / `workspace_write` / `workspace_list`，参数 TypeBox `Type.Object({...})`，实现里把路径 resolve 到 `workspaces/<botId>/` 下并拒绝 `..` 逃逸。仅当 bot.system_prompt 非空标记为「工作型」或群聊场景时挂载？——简化为：**所有 bot 都挂载**，由人设决定是否使用。

**Provider kind → pi 内置 provider 映射**：`openai→openAIProvider()`、`anthropic→anthropicProvider()`、`google→googleProvider()`、`openrouter→openrouterProvider()`、`kimi→createProvider(...)`（Kimi Coding Plan，模型从 `/v1/models` 动态拉取）、`zhipu→createProvider(...)`（智谱 OpenAI 兼容国内端点）、`deepseek→deepseekProvider()`、`lm-studio→createProvider(...)`、`openai-compatible→createProvider(...)`。`testProvider` 用小输出上限的 completion 验证。LM Studio Provider 无需 API Key，模型目录请求不发送 Authorization，pi-agent-core 运行时使用不落库、无权限的占位值满足其非空校验。默认地址为 `http://localhost:1234/v1`；误填 `/api/v1/chat` 或 `/v1/chat/completions` 会规范到 `/v1`。Covan 使用支持自定义 tools 与完整历史的 `/v1/chat/completions`。Bot 的 `reasoning_effort` 支持 off/low/medium/high/xhigh；LM Studio 标准参数之外还会注入兼容提示。所有运行均传入 Bot 的 temperature/max_tokens，自动记忆固定 off、256 token，群聊协调固定 low、768 token。

**进行中任务表**：Agent 层维护 `Map<chatId, Set<AbortController>>`；编排层另外维护轮次级 AbortController。stopChat 同时取消协调者决策、当前 Agent 和后续群聊发言，保留当前已生成文本为 stopped 消息。generation-state 明确表示整个轮次是否结束。
**Mock provider（冒烟测试）**：kind='mock' 时不走 pi，直接按名字模板生成流式假回复（`main/mockProvider.ts`）。

## 9. UI 规范（复刻参考截图）

- 三栏：Sidebar 256px / ChatView 自适应 / BotSettingsPanel 320px（默认收起）。
- 跟随系统浅色/深色主题；暖白/炭灰背景、低饱和绿点缀；用户消息为紧凑浅灰气泡，Bot 回复使用宽阅读区域；代码和表格独立滚动。
- Sidebar：搜索框；单聊列表项右键「置顶 / 取消置顶」，最多3个 Bot，数据库层同样校验；顶部仅在有置顶时显示横排圆形头像，不显示空槽位或添加入口。会话列表项=头像(群聊显示叠头像+N角标)/名称/最后消息预览/时间/未读蓝点；底部为「关于我」「我的 Bot」「新建群聊」「设置」；顶部「+」菜单新建 Bot(⌘1) / 创建群聊(⌘2)。
- ChatView：顶部 Bot/群名、当前模型、完整会话导出和设置入口。消息显示作者、时间、跨日分隔；支持 Markdown、代码复制、原文复制、引用回复和错误重试。上翻阅读时不强制贴底，可手动回到最新；历史分页保持阅读位置。Composer 使用浮动圆角输入框、群聊 @ 提及、独立持久草稿与中文输入法保护。Enter 发送，Shift+Enter 换行。附件与图片消息为后续功能；远程 Markdown 图片显示为可点击链接。
- BotSettingsPanel（右栏，单聊选中时显示）：头像、名称输入、标签、描述、通知开关、人设 system prompt 编辑、模型选择（provider + model + reasoning effort + max tokens + temperature）、记忆标签页、工作区标签页。
- SettingsModal（通用）：账户占位、外观（主题跟随系统/浅色/深色、语言）、Bot（时区自动检测、自动审核开关 + 规则文本——审核规则作为自然语言注入 coordinator 决策前的检查）、Provider 管理（列表 + 新增/编辑表单 + 测试连接按钮）。
- 新建 Bot 对话框：名称/人设模板下拉（开发分队四人、产品经理、设计师、虚拟女友「小美女」、空白自定义）/描述/provider/模型。
- 中文 UI。

## 10. 人设模板（内置常量 personaTemplates.ts）

- 高级全栈（Go 后端为主，也懂 React/Flutter）、架构设计师（分层/性能/可靠/可扩展）、Code Reviewer（正确性与 bug）、测试员（端到端）、产品经理、设计师。
- 虚拟伴侣「小美女」：21 岁女朋友人设，好看聪明、生活化陪伴、爱夸赞、会记住你的喜好与纪念日；语气亲昵口语化。（成人 consenting 陪伴闲聊，不含露骨性内容生成义务。）

## 11. 非功能需求

- 无任何网络遥测；API key 仅存本地 SQLite（README 注明明文风险 + 后续 safeStorage 路线图）。
- 所有外部调用可中断；生成中 UI 可继续浏览其他会话。
- 错误（key 无效/超时/限流）在气泡内联显示并可重试。
- 代码质量：`tsc --noEmit` 通过、`electron-vite build` 通过。

## 12. 交付清单

- 完整源码（含本 SPEC.md、PRD.md、ARCHITECTURE.md、README.md）
- 冒烟脚本：`npm run smoke`（用 mock provider 验证：建 bot→建群→发消息→收到 mock 回复→记忆写入）

## 13. 用户背景、头像与 Agent 私聊（2026-09-08）

- **关于我**：settings.user_profile 保存 name/role/bio/preferences/goals/boundaries；user_memories 保存 id/content/kind/source/source_bot_id/created_at。个人资料与最近60条共同记忆注入所有 Bot 后续 system prompt；资料编辑/共同记忆增删改经独立 IPC 通道保存，user-context-updated 通知刷新。用户界面标明本机保存与对话时发送模型服务的区别。
- **应用工具**：list_bots、update_bot、expand_avatar_prompt、generate_bot_avatar、read_user_profile、remember_user、agent_private_chat。修改以用户明确要求为依据，不向模型返回 Provider 密钥。记忆需为用户直接表达的事实，不保存猜测或密钥。
- **头像**：默认自动生成本地 SVG（人物/机器人/猫咪/抽象，5套柔和配色）；自定义上传不被自动刷新覆盖。可选择通过已有 Provider 扩写人设提示词。图片模式由 avatar_provider / avatar_model / avatar_base_url 配置，POST /images/generations 支持 base64 或 URL，限16MB、120秒。显式 image 未配置时报错，auto 未配置时使用 local，并返回实际模式。
- **私聊数据**：agent_threads 关联 parent_chat_id、origin_message_id、from_bot_id、to_bot_id、subject、status 与时间；agent_private_messages 保存双方文本、状态、错误与时间。删除主会话级联删除对应私聊，关闭应用后不自动续跑网络任务。
- **私聊执行**：一次咨询将问题发送给目标 Bot，接收方使用自己的人设/模型与工作区读取工具；不递归调用私聊或修改应用状态。每个主会话最多并发3个、每个用户轮次最多调用3次；可独立停止，也随主轮次停止。
- **私聊界面**：自然语言工具触发后，卡片插在来源用户消息后；未加载来源消息时仍有入口。点击浮窗显示双方真实消息、Markdown、作者、时间、流式/失败/停止状态。聊天顶部双人按钮也可手动指定咨询问题，不自动转发整段主会话。
- **IPC 契约**：getUserProfile / saveUserProfile / listUserMemories / saveUserMemory / deleteUserMemory；listAgentThreads / getAgentThread / startAgentConversation / stopAgentConversation；准确类型以 shared/types.ts 为准。
- **启动与验证**：根目录 start.command 一键启动；npm run typecheck、npm run smoke、npm run test:ui、npm run test:context。UI 与工具测试均使用临时 profile；真实 pi 工具循环由本地 HTTP fixture 驱动，无付费 API 调用。
