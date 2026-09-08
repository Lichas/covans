# ARCHITECTURE — Covan 技术方案

> 版本：v1.0 · 与 SPEC.md 保持一致；本文档展开 SPEC 的技术决策与内部设计，不引入与其冲突的接口或边界。

## 1. 总览

Covan 是标准 Electron 双进程 + preload 桥接架构。所有 LLM 调用、数据库、编排逻辑集中在主进程；渲染进程是纯 React UI，仅通过 `window.covan` 白名单 API 与事件订阅通信。

```
┌────────────────────────────────────────────────────────────┐
│ Renderer Process（React 18 + zustand + Tailwind）          │
│  Sidebar │ ChatView │ BotSettingsPanel │ SettingsModal     │
│      stores(bots/chats/messages/settings)                  │
│      lib/api.ts ── window.covan（类型化封装）              │
└───────────────▲───────────────────────────▲────────────────┘
   IPC invoke   │  （contextBridge 白名单）   │  webContents.send
┌───────────────┴───────────────────────────┴────────────────┐
│ Preload（contextBridge.exposeInMainWorld('covan', api)）  │
│  contextIsolation: true · nodeIntegration: false           │
└───────────────▲───────────────────────────▲────────────────┘
┌───────────────┴────────────────────────────────────────────┐
│ Main Process（Node ≥ 22.19，Electron 38）                  │
│  index.ts      窗口与生命周期                              │
│  ipc.ts        ipcMain.handle 白名单通道注册               │
│  db.ts         better-sqlite3（WAL）+ migration + DAO      │
│  agentRuntime.ts  pi-mono 封装：provider 解析/流式/Abort   │
│  orchestrator.ts  群聊编排状态机                           │
│  memory.ts       记忆注入 + 后台提取                       │
│  workspace.ts    每 Bot 工作区目录                         │
│  mockProvider.ts 冒烟测试假回复                            │
└───────┬───────────────────────────┬────────────────────────┘
        ▼                           ▼
  SQLite（userData/legacy.db）   LLM Providers
  workspaces/<botId>/            （OpenAI/Anthropic/Google/
  avatars/                        OpenRouter/OpenAI 兼容网关）
```

## 2. 技术选型与理由

| 选型 | 版本 | 理由 |
| --- | --- | --- |
| Electron | 38 | pi-ai / pi-agent-core 为 ESM only 且 `engines: node >= 22.19.0`，Electron 38 内置 Node 22.19 满足该下限；同时获得成熟的 contextIsolation 安全模型 |
| electron-vite | ^2 | 主/preload/渲染三端一体化构建，开发期 HMR，天然支持 ESM 输出 |
| TypeScript | ^5.6 | 主/渲染共享 `shared/types.ts`，IPC 契约编译期校验 |
| React | ^18.3 | 成熟生态，配合 zustand 足够支撑三栏 UI |
| zustand | ^5 | 轻量、无样板；四个 store（bots/chats/messages/settings）与事件流（message-delta 等）天然契合 |
| Tailwind CSS | ^3.4 | 快速复刻参考截图的低饱和暖灰视觉体系，`dark:` 变体支持跟随系统暗色 |
| better-sqlite3 | ^11 | 同步 API 让 DAO 代码直白可靠；主进程单写者模型下性能充足；WAL 模式保证流式写入与读取并发不互斥 |
| pi-mono：`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` | 最新 | 见下节 |

### 为什么用 pi-agent-core 而不是 pi-coding-agent SDK

1. **零原生依赖**：pi-ai 是纯 JS 的统一 LLM 层，pi-agent-core 只依赖 pi-ai。而 pi-coding-agent 会连带引入 ripgrep（安装时联网下载二进制）、node-pty（原生编译）、WASM 组件，在 Electron 打包中每一处都是原生模块重建与分发陷阱。
2. **无联网下载**：`npm install --ignore-scripts` 下即可完整安装，CI 与离线环境友好；pi-coding-agent 的 postinstall 下载 ripgrep 与该约束冲突。
3. **ESM 一致性**：两包均 ESM only，与 electron-vite 输出一致，避免 CJS/ESM 互操作坑。
4. **能力恰好够用**：我们需要的是「ReAct 循环 + 工具执行 + 事件流 + abort」，pi-agent-core 完整提供；coding-agent 多出的终端/编辑器能力对本产品无用，反而扩大攻击面。
5. **工具自研**：工作区只需 3 个文件工具（workspace_read/write/list），用 pi-agent-core 的 AgentTool + TypeBox 自行实现，几十行代码换来完全的依赖控制。

注意包名使用新 scope `@earendil-works/*`；旧 `@mariozechner/*` 已废弃，禁止引用。

## 3. 数据模型

SQLite 数据库位于 `app.getPath('userData')/legacy.db`，WAL 模式，启动时按版本号顺序执行 migration。表结构以 SPEC.md §3 为准，摘要如下：

```
providers 1───n bots（provider_id，可空）
bots      1───n memories
bots      1───n workspaces（文件系统目录，键为 bot.id）
chats     1───n messages
chats     n───n bots   通过 chat_members（role: member|coordinator）
chats     1───1 bots   dm：chats.bot_id
chats     n───1 bots   group：chats.coordinator_bot_id（可空）
settings  键值表（主题/语言/时区/审核规则等）
```

关键设计点：

- **messages.sender_type** 区分 `user|bot|system`；群聊中 bot 消息用 `sender_bot_id` 归属，system 消息承载协调者 note 等元信息。`status` 机（streaming/done/error/stopped）支撑断点续显与错误内联。
- **mentions / attachments 以 JSON 字符串列存储**：结构简单、无查询需求，避免额外表。
- **引用完整性**：messages 不级联删除——删除 Bot 时只清 bots/memories/chat_members 与外键引用，messages 保留（FR-BOT-04），渲染层对悬空 sender_bot_id 降级为占位头像。
- **settings 键值表**承载所有非结构化配置，避免 schema 膨胀。

## 4. IPC 安全边界

- `contextIsolation: true`，`nodeIntegration: false`，渲染进程无任何 Node 能力。
- preload 仅通过 `contextBridge.exposeInMainWorld('covan', api)` 暴露 SPEC.md §4 定义的 `CovanApi`；通道名集中在 `shared/ipcChannels.ts` 常量，主进程 `ipcMain.handle` 逐一注册，**无泛化转发、无 `ipcRenderer.send` 裸暴露**。
- 所有通道参数在主进程侧做类型与非空校验（id 必须为已存在的 uuid 等），渲染传入的路径一律不允许——文件路径只由主进程根据 botId 推导。
- 主 → 渲染为单向事件广播：`webContents.send('covan:event', ev)`，渲染通过 `onEvent(cb)` 订阅并返回取消订阅函数。事件类型为 SPEC §4 的 `CovanEvent` 联合（message-delta / message-done / message-error / chat-updated / bot-updated / system-message）。
- api_key 从不流向渲染进程的通道响应之外的任何地方；渲染仅在 provider 编辑表单中读写，列表展示默认掩码。

## 5. pi 集成层设计（agentRuntime.ts）

### 5.1 Provider 映射

providers.kind → pi 内置 provider 的映射表：

| kind | pi 构造 |
| --- | --- |
| openai | `openAIProvider()` |
| anthropic | `anthropicProvider()` |
| google | `googleProvider()` |
| openrouter | `openrouterProvider()` |
| kimi | `createProvider({...})`（Kimi Coding Plan 动态模型） |
| zhipu | `createProvider({...})`（智谱 OpenAI 兼容国内端点） |
| deepseek | `deepseekProvider()` |
| openai-compatible | `createProvider({...})` 动态构造 |
| mock | 不进 pi，走 main/mockProvider.ts |

`openai-compatible`（Ollama / vLLM / 公司网关）按 SPEC §8 的方式用 `createProvider` 构造：`id: custom-${provider.id}`、`baseUrl` 取 provider.base_url、单模型定义（`api: 'openai-completions'`、`contextWindow: 128000`、`maxTokens: 32000`、cost 全 0、compat 关闭 developer role 与 reasoning effort），`api` 挂 `openAICompletionsApi()`，再 `models.setProvider(custom)`。

Kimi Coding Plan 通过 `GET https://api.kimi.com/coding/v1/models` 拉取当前账号可用模型，使用拉取到的模型 ID 动态构造 OpenAI-compatible model；因此新模型（如 `k3` / `k3-256k`）无需更新静态目录。设置页的「拉取模型」与「测试连接」都会展示并复用这份账号模型列表。

### 5.2 apiKey 注入优先级

所有 `models.stream / models.complete` 调用在 options 中**显式传入 `{ apiKey: provider.api_key }`**，优先于任何环境变量；`createProvider` 的 auth 用 `envApiKeyAuth('key', [])` 占位仅满足类型要求，实际 key 永远按调用注入。Agent 层用 `getApiKey: async () => provider.api_key`，保证用户改 key 后下一次调用即生效，不依赖进程环境变量。

### 5.3 消息历史重建

pi 的 Context 为可 JSON 序列化的 `{ role, content, timestamp }[]`。每次生成前从 messages 表重建：

- `user` → `{ role: 'user' }`；`bot` → `{ role: 'assistant' }`；`system` 跳过（不进上下文，仅 UI 展示）。
- 群聊中其他 bot 的发言对当前发言 bot 而言是「用户侧」输入：以 `[名字]: 内容` 文本前缀保留归属，折叠进 user/assistant 交替序列（SPEC §8）。
- 窗口取最近 30 条，与 transcript 构建规则一致；超长按 max_tokens 预留截断。

### 5.4 Agent 会话与流式转发

按 SPEC §8 创建 `new Agent({ initialState: { systemPrompt, model, tools: workspaceTools, thinkingLevel: 'off' }, streamFn: models.streamSimple.bind(models), sessionId: ${chatId}:${botId}, getApiKey })`，订阅事件流：`message_update` 内的 `text_delta` → 发 `message-delta` IPC 事件；`agent_end` → 落库 + `message-done`；`error` → 落库 error 状态 + `message-error`。

### 5.5 AbortController 生命周期

- 主进程维护 `Map<chatId, Set<AbortController>>`（SPEC §8）。每次 `agent.prompt()` 创建 controller 入 set；`agent.abort()` 绑定之。
- 终态（done/error/stopped）时从 set 移除并置空；`stopChat(chatId)` 遍历该 chat 的 set 逐个 abort，随后清空。
- 消息状态机：创建 streaming → abort 时若已有 delta 落库为 stopped（保留已输出内容），若尚无内容则置 error 文案「已停止」；正常完成置 done。
- 应用退出前统一 abort 全部 set，避免悬挂请求。

## 6. 群聊编排协议详细设计（orchestrator.ts）

### 6.1 状态机

```
        sendUserMessage(group)
                │
                ▼
        ┌─────────────┐   无 coordinator   ┌──────────────┐
        │    idle     │ ─────────────────▶ │  fallback    │
        └─────┬───────┘                    │ (mention 或  │
              │ 有 coordinator             │  全员≤5)     │
              ▼                            └──────┬───────┘
        ┌─────────────┐  JSON 解析失败            │
        │  planning   │ ──────────────┐           │
        │(coordinator │               ▼           │
        │  输出决策)  │        ┌──────────────┐   │
        └─────┬───────┘        │ parse-fallback│  │
              │ JSON ok        │(@bots+coord) │   │
              ▼                └──────┬───────┘   │
        ┌─────────────┐               │           │
        │  speaking₁  │ ◀─────────────┴───────────┘
        │ speaking₂ … │  串行 n 次（受最大发言数截断）
        └─────┬───────┘
              ▼
        ┌─────────────┐
        │    done     │ → 触发后台记忆提取 → idle
        └─────────────┘
```

### 6.2 决策协议（JSON）

协调者调用的 system prompt 要求**只输出 JSON**（SPEC §5）：

```json
{
  "speak": [{ "botId": "uuid", "hint": "要说什么的简短指令" }],
  "note": "系统条文本，如：已发消息给 3 个 Bot"
}
```

处理规则：
1. 构建 transcript：最近 30 条消息，格式 `[名字]: 内容`。
2. 用户消息中的 @mention 强制并入 speak 列表首位（去重）。
3. JSON 提取容错：截取首个 `{` 到末个 `}` 尝试 parse；speak 项中 botId 必须是本群成员，非法项丢弃。
4. 全部失败 → 兜底：所有被 @ 的 bot + coordinator 自己发言。
5. note 写入一条 sender_type='system' 的消息并广播 `system-message` 事件。
6. 设置中开启「自动审核」时，审核规则文本作为自然语言追加进协调者决策前的检查环节。

### 6.3 发言执行

对每个 speak 项串行执行（保证群内消息顺序自然、便于用户阅读）：

- system prompt = `bot.system_prompt` + 记忆注入 + 群聊上下文指令（「你在群聊 X 中，其他成员：…，请用口语化中文简短回复，不要复述别人」）。
- hint 作为用户消息前缀：`(协调者提示: hint)`。
- 流式 delta 实时广播；单条失败不中断后续发言（该条落 error，继续下一个）。
- 每轮最大发言数硬上限（默认 5，settings 可调）：超出截断，截断动作写入 note。这是成本失控的主要防线（见 §11）。
- 全部完成后置 done，触发 memory.ts 后台提取。

单聊复用同一执行路径：跳过 planning/fallback，直接 speaking₁。

## 7. 记忆系统详细设计（memory.ts）

### 7.1 注入格式

每次构建 agent system prompt 时取该 bot 最近 30 条 memories，追加：

```


## 你的长期记忆
- {content}
- …
```

按 created_at 倒序取 30 条后反转为时间正序，保证最新记忆靠近列表末尾（近因效应）。

### 7.2 提取触发器

- 触发点：每个 chat 每累计 10 条新消息（user+bot 合计，计数器存内存 + 落库 last_message_at 差值兜底），在群聊 done / 单聊 done 后异步执行。
- 模型选择：该 bot 自己的 provider/model；无则全局默认 provider；仍无则静默跳过。
- 调用方式：非流式 `models.complete`，prompt 要求「从最近对话提取关于用户的事实/偏好/约定/重要事件，输出 JSON 字符串数组，无则输出 []」。
- 失败静默：任何异常（网络、解析）仅记日志，不产生 UI 打扰。

### 7.3 去重策略

v1 采用保守的**包含关系去重**：新条目与现有记忆任一存在子串包含关系（双向，去空白与标点归一化后比较）即跳过。该策略零依赖、可预测，误杀率可接受；手动添加（source='manual'）的记忆不参与被去重（新自动条目若被手动记忆包含则跳过，反之不删手动条目）。

### 7.4 未来向量检索路线

v2 规划：memories 表增加 `embedding BLOB` 列，提取后异步算向量（用 provider 的 embedding 端点或本地小模型）；注入时以当前会话最近若干消息为 query 做余弦相似度 Top-K 检索，替代「最近 30 条」的朴素窗口。schema 上仅需加列，不破坏 v1 数据。触发器、去重、手动管理逻辑保持不变。

## 8. 工作区与自研工具（workspace.ts + agentRuntime.ts）

- 根目录：`userData/workspaces/<botId>/`，createBot 时同步创建；删除 Bot 时目录保留与否由设置项控制（默认保留，防误删数据）。
- 三个 AgentTool（TypeBox 参数定义，SPEC §8）：
  - `workspace_read({ path })`：读文本文件，超限/二进制返回错误。
  - `workspace_write({ path, content })`：写文件，自动创建父目录。
  - `workspace_list({ path? })`：列目录（深度 2）。
- **路径逃逸防护**：所有入参路径 `path.resolve(workspaceRoot, input)` 后校验结果必须以 `workspaceRoot + sep` 开头；拒绝绝对路径、拒绝任何解析后越出根目录的输入（`..`、符号链接场景下额外用 realpath 复核），违例返回错误字符串给模型而非抛异常中断 agent。
- 挂载策略（SPEC §8 结论）：**所有 bot 都挂载**三个工具，是否使用由人设决定——简化分支逻辑，伴侣 bot 的模板不引导其使用工具即可。
- UI 侧：`listWorkspaceFiles`（深度 2）、`readWorkspaceFile`（≤200KB 文本）、`openWorkspace`（`shell.openPath`）。

## 9. Mock provider 与可测试性

- `main/mockProvider.ts`：providers.kind='mock' 时 agentRuntime 短路进入 mock 路径，按 bot 名字模板生成确定性的流式假回复（分片 setTimeout 推送 text_delta，模拟真实节奏），支持 abort。
- 价值：
  1. `npm run smoke` 在无网络、无 key 环境完成端到端验证：建 bot → 建群 → 发消息 → 收 mock 回复 → 记忆写入（SPEC §12）。
  2. 群聊编排、记忆提取、停止/重试等逻辑可用 mock 做确定性集成测试（协调者 mock 返回固定 JSON / 非法 JSON 以覆盖兜底分支）。
  3. UI 开发不消耗真实 token。
- 测试分层：DAO 单测（内存 SQLite）、orchestrator 状态机单测（注入假 agentRuntime）、冒烟脚本端到端。质量门禁：`tsc --noEmit` 与 `electron-vite build` 必须通过。

## 10. 打包与分发

- 构建：`electron-vite build`（主/preload/renderer 三端），打包用 electron-builder（README 提供说明）。
- **ESM 注意事项**：pi-ai / pi-agent-core 为 ESM only，主进程 bundle 需以 ESM 输出；electron-vite 产物中若出现 CJS 桥接需求，使用 banner 注入 `import { createRequire } from 'module'; const require = createRequire(import.meta.url)` 的 shim，以兼容依赖树中残留的 CJS 引用。
- **安装约束**：`npm install --ignore-scripts`（SPEC §8），规避 better-sqlite3 之外的 postinstall 联网行为；better-sqlite3 的原生绑定需在打包阶段用 electron-builder 的 rebuild 能力对齐 Electron ABI。
- 分发产物：macOS dmg（arm64/x64）、Windows nsis、Linux AppImage；asar 打包时将 better-sqlite3 原生模块列入 asarUnpack。
- 首启初始化：建库、跑 migration、建 workspaces/ 与 avatars/ 根目录、写入默认设置。

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| pi 包（@earendil-works/*）版本变动 / API 漂移 | 编译或运行时破坏 | package-lock 锁定版本；agentRuntime.ts 是唯一直接依赖 pi 的模块（适配层），其余代码只面向内部抽象；升级前跑 smoke + 编排单测；禁止引用废弃的 @mariozechner/* scope |
| Electron 原生模块（better-sqlite3）重建失败 | 打包后崩溃 | 锁定 Electron 38 与 better-sqlite3 ^11 组合并验证；electron-builder rebuild；`--ignore-scripts` 后显式执行 rebuild 步骤写进 README |
| API key 明文存储于 SQLite | 本机被入侵时密钥泄露 | v1 明确取舍并文档化：README 显著风险提示；后续迁移 Electron safeStorage（key 加密落库，内存解密）；渲染层列表默认掩码展示 |
| 群聊成本失控（协调者安排大量发言、循环讨论） | 用户账单激增 | 每轮最大发言数硬上限（默认 5）+ 超出截断并写入 note；一切生成可 stopChat 一键中断；无「bot 主动追问」机制，一轮用户消息只触发一轮调度 |
| 协调者输出不稳定（非 JSON、幻觉 botId） | 群聊失序 | §6.2 的多级容错：JSON 截取 parse → 成员校验过滤 → mention+coordinator 兜底；兜底分支有 mock 集成测试覆盖 |
| 长会话上下文超限 | 生成报错 | transcript 与历史重建均限最近 30 条；注入记忆限 30 条；超长时按 token 预算从 oldest 侧截断 |
| 记忆提取误记/隐私顾虑 | 用户信任受损 | Memory 面板全量可见、可删；自动提取失败静默且不阻塞主流程；手动记忆不被自动去重误删 |
| 单写者阻塞（大消息流式落库 + UI 读取） | UI 卡顿 | WAL 模式读写并发；落库合并小事务；渲染端 delta 渲染做 rAF 节流 |
