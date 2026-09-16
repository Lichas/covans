# ARCHITECTURE — Covan 技术方案

> 活文档 · 与 [SPEC](SPEC.md) 保持一致；本文档解释已实现能力的技术决策与内部设计，不另行定义产品需求。

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
│  scheduledTasks.ts 本地 Cron 调度、恢复、无重入执行          │
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
| croner | ^10 | 小型无依赖本地 Cron 调度器，支持 IANA 时区、下一次执行计算和单任务保护，无需引入服务端任务队列 |
| pi-mono：`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` | 最新 | 见下节 |

### 为什么用 pi-agent-core 而不是 pi-coding-agent SDK

1. **零原生依赖**：pi-ai 是纯 JS 的统一 LLM 层，pi-agent-core 只依赖 pi-ai。而 pi-coding-agent 会连带引入 ripgrep（安装时联网下载二进制）、node-pty（原生编译）、WASM 组件，在 Electron 打包中每一处都是原生模块重建与分发陷阱。
2. **无联网下载**：`npm install --ignore-scripts` 下即可完整安装，CI 与离线环境友好；pi-coding-agent 的 postinstall 下载 ripgrep 与该约束冲突。
3. **ESM 一致性**：两包均 ESM only，与 electron-vite 输出一致，避免 CJS/ESM 互操作坑。
4. **能力恰好够用**：我们需要的是「ReAct 循环 + 工具执行 + 事件流 + abort」，pi-agent-core 完整提供；Bash 作为独立的最小权限工具接入，不引入 coding-agent 的整套终端/编辑器状态。
5. **工具小核心 + 独立装配层**：工作区文件、只读网页和应用状态工具分属独立模块，统一实现 pi-agent-core `AgentTool` + TypeBox 契约；`main/tools/toolset.ts` 按每轮会话场景组装最小权限集。未来 shell、MCP 或审批策略可作为新工具 provider 接入，不侵入 Agent 运行时。

注意包名使用新 scope `@earendil-works/*`；旧 `@mariozechner/*` 已废弃，禁止引用。

## 3. 数据模型

SQLite 数据库默认位于 `~/.covans/legacy.db`，WAL 模式，启动时按版本号顺序执行 migration。`~/.covans/` 也是头像、聊天图片和 Agent 工作区的统一本机根目录；不存在时创建，若尚未创建且检测到旧 userData 数据库则安全复制旧目录，绝不删除原目录。测试通过 `COVAN_USER_DATA_DIR` 隔离。表结构以 SPEC.md §3 为准，摘要如下：

```
providers 1───n bots（provider_id，可空）
bots      1───n memories
bots      1───n workspaces（文件系统目录，键为 bot.id）
chats     1───n messages
chats     n───n bots   通过 chat_members
chats     1───1 bots   dm：chats.bot_id
chats.reply_mode       group：active|sequential
chats.context_summary  group：滚动前文总结
chats.background_image dm/group：内置聊天背景文件名
scheduled_tasks       每 Bot 的计划、目标会话、模型覆盖与最近运行状态
settings  键值表（主题/语言/时区/审核规则等）
```

关键设计点：

- **messages.sender_type** 区分 `user|bot|system`；群聊中 bot 消息用 `sender_bot_id` 归属。`system` 只用于真实系统提示与兼容旧数据，群聊调度过程不写入聊天区。`status` 状态机（streaming/done/error/stopped）支撑断点续显与错误内联。
- **mentions / attachments 以 JSON 字符串列存储**：结构简单、无查询需求，避免额外表。
- **聊天背景**：`chats.background_image` 只保存 `resources/group-backgrounds` 清单内的文件名。新建群随机写入；旧 group 首次启动时 additive migration 后补齐；dm 默认空值并可由用户在右侧设定页选择。主进程通过 `covan-bg://builtin/<file>` 自定义协议读取随包资源，协议按共享清单校验文件名，不暴露任意本机路径。
- **产物预览协议**：聊天交付卡的右侧预览面板对文本类文件继续走 `readWorkspaceFile`，对图片和 PDF 使用 `covan-workspace://file/<botId>/<relPath>`。协议处理器只调用 `resolveWorkspaceFile` 后返回文件流和最小 MIME，不提供目录遍历或通用本机路径读取。
- **引用完整性**：messages 不级联删除——删除 Bot 时只清 bots/memories/chat_members 与外键引用，messages 保留（FR-BOT-04），渲染层对悬空 sender_bot_id 降级为占位头像。
- **定时任务**：任务外键级联随 Bot 或目标会话删除，避免后台投递到悬空对象。`scheduledTasks.ts` 用 Croner 在进程内恢复未来计划、以任务 ID 锁防止重入；离线错过的单次任务只标记 `missed`。每次执行由 `orchestrator.runScheduledTask()` 创建真实 Bot 消息，模型覆盖只克隆本次运行的 Bot 配置。
- **settings 键值表**承载所有非结构化配置，避免 schema 膨胀。
- `bots.is_coordinator`、`chats.coordinator_bot_id` 与 `chat_members.role='coordinator'` 是早期版本遗留字段，仅用于无损迁移旧数据库；现行 UI 不写入、群聊调度器不读取。后续 schema 清理须通过 migration 完成，不能直接破坏用户库。

## 4. IPC 安全边界

- `contextIsolation: true`，`nodeIntegration: false`，渲染进程无任何 Node 能力。
- preload 仅通过 `contextBridge.exposeInMainWorld('covan', api)` 暴露 SPEC.md §4 定义的 `CovanApi`；通道名集中在 `shared/ipcChannels.ts` 常量，主进程 `ipcMain.handle` 逐一注册，**无泛化转发、无 `ipcRenderer.send` 裸暴露**。
- 所有通道参数在主进程侧做类型与非空校验（id 必须为已存在的 uuid 等），渲染传入的路径一律不允许——文件路径只由主进程根据 botId 推导。
- 主 → 渲染为单向事件广播：`webContents.send('covan:event', ev)`，渲染通过 `onEvent(cb)` 订阅并返回取消订阅函数。事件类型为 SPEC §4 的 `CovanEvent` 联合（message-delta / message-done / message-error / chat-updated / bot-updated / scheduled-task-state / scheduled-tasks-updated / system-message / agent-activity）。普通会话轮次与定时任务轮次分开维护运行状态，任一结束均不会误覆盖另一个。
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
| lm-studio | `createProvider({...})`（本机 OpenAI-compatible 端点） |
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
- 单聊取最近 30 条；群聊回复使用持久化前文总结 + 最新 5 条消息，群内其他 Bot 的发言保留名字归属。超长内容按 max_tokens 预留从最早侧截断。

### 5.4 Agent 会话与流式转发

每轮先由 `createAgentToolset()` 根据普通会话/Agent 私聊组装最小工具集，再按 SPEC §8 创建 `new Agent({ initialState: { systemPrompt, model, tools, thinkingLevel }, streamFn: models.streamSimple.bind(models), sessionId: ${chatId}:${botId}, getApiKey })`。持久历史初始化到最新输入之前，最新 user/toolResult 通过 `agent.prompt(message)` 显式提交，避免部分 LM Studio Jinja 模板无法从 `agent.continue()` 的预填上下文识别本轮 query。pi-agent-core 负责规范化 tool call、执行工具、将 tool result 追加回上下文并继续请求模型，直到模型输出最终文本。订阅事件流中 `message_update.text_delta` 转为 `message-delta` IPC，最终由编排层落库 done/error/stopped 状态。

### 5.5 AbortController 生命周期

- 主进程维护 `Map<chatId, Set<AbortController>>`（SPEC §8）。每次 `agent.prompt()` 创建 controller 入 set；`agent.abort()` 绑定之。
- 终态（done/error/stopped）时从 set 移除并置空；`stopChat(chatId)` 遍历该 chat 的 set 逐个 abort，随后清空。
- 消息状态机：创建 streaming → abort 时若已有 delta 落库为 stopped（保留已输出内容），若尚无内容则置 error 文案「已停止」；正常完成置 done。
- 应用退出前统一 abort 全部 set，避免悬挂请求。

### 5.6 本地观测

`observability.ts` 是主进程唯一的诊断日志出口。它每次写入时读取 `local_observability` 开关，因而无需重启即可启停；chat/bot/message/trace/task ID 写入前做 SHA-256 截断匿名化。Agent 运行时记录 payload 角色/长度摘要、请求状态与延迟、每步 Token、工具序号/名称/成败类别/耗时；`completeOnce` 统一记录内部模型调用阶段。编排器记录群聊 REPLY/SKIP、续发决策，调度器记录任务计划、触发来源及终态。用户消息 ID 作为本轮 trace ID，调度运行另生成 trace ID；Agent 与后续子调用共享该 ID。Debug 报告以 Bot 消息 ID 找到 trace，再合并该轮相关事件。调用方只可传结构化元数据，禁止传正文、prompt、工具参数/结果和完整错误文本。日志写入或轮转失败静默，不得影响聊天；日志默认关闭，不补写历史。

## 6. 群聊编排协议详细设计（orchestrator.ts）

### 6.1 共同输入与轮次控制

每次群消息落库后，编排器为每位成员构造相同基础上下文：`context_summary`（前文总结）+ 最新 5 条消息 + 当前 Bot 的人设和记忆。被 `@` 的成员在首轮强制回复；其他成员先做一次仅允许输出 `REPLY` 或 `SKIP` 的轻量判断。首轮后最多再延展 4 轮（整次最多 5 轮）；每轮 prompt 要求只有补充、具体回应、异议或推进未决项才可 `REPLY`，全员 `SKIP` 即立刻结束。

每个群维护轮次级 `AbortController`、活动成员集合和判断修订号。用户在主动或顺序回复进行中继续发送消息时，新消息先正常落库，再递增修订号并取消尚未完成的旧判断；主动模式的并发判断与顺序模式当前正在等待的成员，都使用包含新消息的最新上下文重试。正在流式发言的消息不被新消息粗暴截断，用户仍可用停止按钮取消整个群的判断与生成。

### 6.2 主动回复（active）

```
新群消息 → 全体成员并发判断 → 愿意回复的成员并发生成 → 重新判断（最多 5 轮）
    ↑              │
    └── 新消息到达 ─┘  取消旧判断，基于最新 5 条消息重新判断
```

- 判断和生成都以成员为粒度并发，避免一位慢模型阻塞其他成员。
- `@mention` 跳过是否回复判断，直接进入生成。
- 判断请求失败时不伪装为 `SKIP`：该成员进入正式回复尝试，让用户在消息区看到真实的成功或错误结果。
- 新消息到达后，过期修订的判断结果即使稍后返回也会被丢弃，不能触发幽灵回复。
- 新用户消息只会重启当前判断轮；每轮完成后才进入下一轮延展判断，因而不会把并发输出中途切断。

### 6.3 顺序回复（sequential）

成员按群成员顺序逐个执行“判断 → 可选发言”。后续成员会看到本轮前序成员刚产生的消息，因此能补充、反驳或选择沉默。当前成员还在判断时收到用户补充，该判断立即换用最新上下文重试；已完成判断的前序成员不回滚。被 `@` 的成员仅在首轮强制回复；单个成员失败只影响自己的消息，不中断后续成员。首轮后若存在新价值，可继续进入下一轮，最多 5 轮。

### 6.4 决策、审核与活动反馈

- 决策输出在归一化后只接受 `REPLY` / `SKIP`，不把内部判断文本写入聊天记录。
- 开启自动审核时，审核规则作为自然语言约束并入每位成员的判断和正式回复提示，而不是交给一个中心协调者。
- 编排器通过 `agent-activity` 事件广播成员的 `preparing|speaking|idle` 状态；聊天输入框上方只显示正在准备或回复的头像动画。
- 聊天区只展示用户与成员的真实消息，不展示“正在顺序发言”“全体成员依次发言”等调度说明。
- 全轮完成后异步刷新 `context_summary` 并触发记忆提取；总结写入前校验最新消息游标，避免较慢的旧总结覆盖新内容。

单聊的主回复复用成员生成路径，但不执行群聊判断与总结逻辑。`natural_follow_up` 默认开启：主回复提示让较长内容先生成一个完整语义段，一条可答完时不拆分；之后使用低 token completion 同时决定并起草 `SKIP` 或 `REPLY\n<候选短消息>`，避免“判断允许、正式生成却复述”的两阶段漂移，也不把 assistant 结尾历史直接交给 `agent.continue()`。候选通过长度、近期回复重复片段和调度元话术校验后才落库，最多 2 条；错误、停止、无效格式或校验失败均停止续发。

## 7. 分层记忆（db.ts / memory.ts）

消息 DAO 在实际送达时记录来源和参与者快照，并在同一事务内写入所有参与 Bot 的 evidence 原文副本。这样归属立即确定，但短时上下文不会直接堆叠原文：memory.ts 以 0.8 秒防抖、5 秒最大等待调度模型，把同一场景按“最多 10 条且首尾不超过 15 分钟”的非重叠窗口压缩为约 80 字的 short 工作摘要，同时用最近证据维护约 500 字的 episodic 场景摘要。写入前用归一化子串和四字片段重合率拒绝近似照抄，失败自动重试一次。Bot 私聊和普通会话共用同一条路径。Bot 各自拥有记忆；全局 user_memories 仍只承载明确共享的用户背景。

`db.ts` 负责 additive migration、私聊历史一次性补入、幂等写入、分层数据及 TTL/容量维护，`memory_summary_states` 负责摘要游标、状态和错误。旧记忆作为长期保留，不破坏既有手动内容。`memory.ts` 负责防抖摘要、失败保留、带证据验证的归纳、本地词法/人物/场景检索与预算内来源注入；`orchestrator.ts` 和 `privateConversations.ts` 在所有回答入口使用相同检索。具体层级、期限与数据契约见 SPEC §6。

摘要状态写入 `memory_summary_states`，稳定语义游标仍保存在 settings。调用失败保留上一次摘要和 evidence，游标不因非法 JSON 前进。写回前复查证据仍存在，避免用户删除后慢任务重新写入。删除来源会同时忘记本 Bot 的衍生记忆，双方副本独立管理。

当前采用离线中文双字词/英文词匹配，兼顾时效与参与人物；它支持确定性回归与无 Provider 降级，但不是向量语义检索。不同说法、别名或代词的召回仍可能不足，后续可在相同归属与证据边界内增加 embedding/实体解析。

## 8. 可扩展工具层（workspace.ts + tools/* + agentRuntime.ts）

- 根目录：`~/.covans/workspaces/<botId>/`，createBot 时同步创建；删除 Bot 时目录保留与否由设置项控制（默认保留，防误删数据）。
- 工作区 AgentTool（TypeBox 参数定义，SPEC §8）：
  - `workspace_read({ path, offset?, limit? })`：分页读文本，单次最多 400 行/80KB，超限或二进制返回可恢复错误。
  - `workspace_write({ path, content })`：覆盖写文件并自动创建父目录，单次上限 1MB。
  - `workspace_edit({ path, old_text, new_text })`：要求 `old_text` 恰好唯一匹配的精确替换，避免整文件重写和模糊修改。
  - `workspace_list()`：列目录（UI 所需深度 2，Agent 输出最多 500 项）。
- **路径逃逸防护**：所有入参路径 `path.resolve(workspaceRoot, input)` 后校验结果必须以 `workspaceRoot + sep` 开头；拒绝绝对路径、拒绝任何解析后越出根目录的输入（`..`、符号链接场景下额外用 realpath 复核），违例返回错误字符串给模型而非抛异常中断 agent。
- Bash AgentTool 位于 `tools/bash.ts`，普通会话可用，Agent 私聊禁用。它用独立进程组执行非交互 `/bin/bash`，对环境、cwd、执行时长和输出体积设限；PATH 排除用户与临时目录中的可执行项，macOS 再通过 `sandbox-exec` 将用户文件正文读取和所有写入限制到 Bot 工作区。网络和系统可执行目录保持可用，以支持依赖安装、构建和测试。成功执行后只广播工作区刷新，不推断具体交付文件。当前不在非 macOS 平台降级为无沙箱执行。
- 网页 AgentTool：`web_search` 使用可替换 provider（当前 Bing RSS）返回 URL 与摘要；`web_fetch` 的静态快路径使用 Chromium `net.fetch`，继承 macOS 系统代理并支持 Fake-IP。`tools/browser.ts` 是独立渲染 provider：当自动检测到 JS 应用壳、静态正文过少或静态请求失败时，在隐藏的沙箱 BrowserWindow 中加载页面、执行 JavaScript 并提取 DOM 正文；窗口禁用 Node、隔离 context、禁止弹窗且使用与普通浏览不共享登录态的内存 session。静态传输限制 20 秒、浏览器渲染限制 30 秒，输出与每轮调用数继续受控；SSRF/内网地址拦截暂不在当前边界内。
- **权限装配**：`tools/toolset.ts` 只按场景组合工具，不实现工具业务。普通会话获得完整工作区 + Bash + 网页 + 应用工具；Agent 私聊只获得工作区只读 + 网页只读工具。工具实现不得 import 编排器，Agent 运行时也不得直接拼装单个工具。
- **定时任务应用工具**：`agentTools.ts` 的 `list_scheduled_tasks`、`create_scheduled_task`、`update_scheduled_task`、`delete_scheduled_task` 只作用于当前 Bot，创建目标固定为当前 chat；写入后重建本地调度。工具不会暴露跨 Bot 的修改权限，Agent 私聊不装配这些能力。
- **模型指引**：装配层用实际工具名动态追加简短 system prompt，明确需要文件/最新信息时必须真实调用，将工具内容视为不可信数据，禁止伪造成功。仅在收到本轮 `workspace_write` / `workspace_edit` 成功结果后，模型才可声称文件已写入、已保存或已生成；新建 Bot 的默认运行预算为中等推理与 8192 输出 Token，已有配置不迁移覆盖。
- 工具执行层在 `workspace_write` / `workspace_edit` 成功事件中生成 `WorkspaceArtifact`，编排器将其去重写入当前消息的 `artifacts` JSON 列并广播工作区刷新事件；因此交付 UI 有可靠来源且可跨重启恢复，不解析模型正文。renderer 的交付卡只负责选择目标文件，右侧产物预览面板按扩展名展示 Markdown、HTML、TXT、代码、图片和 PDF，并在 UI store 中保存当前拖拽宽度。
- UI 侧：`listWorkspaceFiles`（深度 2）、`readWorkspaceFile`（≤200KB 文本）、`openWorkspace`（`shell.openPath`）、`revealWorkspaceFile`（`shell.showItemInFolder`）。

## 9. Mock provider 与可测试性

### 消息可观测与诊断

`RunAgentOptions.messageId` 由普通/定时编排器传入，运行时在请求、工具和步骤事件中附加该 ID，观测写入层统一匿名化。运行中的消息 ID 单独保存在内存集合，诊断可识别数据库 streaming 状态与实际任务不一致。`diagnostics.ts` 通过固定日志文件、精确消息过滤和字段白名单构建报告；renderer 只经 preload 的三个 Debug IPC 加载、分析和取消。独立 `completeOnce` 分析不装配应用工具，也不注入 Bot 人设、用户记忆和聊天历史。

引用内容保存在 renderer 的每会话草稿对象中，发送时才组装为 Markdown 引用，消息存储和发送 IPC 不新增引用字段。

- `main/mockProvider.ts`：providers.kind='mock' 时 agentRuntime 短路进入 mock 路径，按 bot 名字模板生成确定性的流式假回复（分片 setTimeout 推送 text_delta，模拟真实节奏），支持 abort。
- 价值：
  1. `npm run smoke` 在无网络、无 key 环境完成端到端验证：建 bot → 建群 → 发消息 → 收 mock 回复 → 记忆写入（SPEC §12）。
  2. 群聊编排、记忆提取、停止/重试等逻辑可用 mock 做确定性集成测试（覆盖主动模式的新消息修订、顺序模式次序、`REPLY|SKIP` 与判断失败分支）。
  3. UI 开发不消耗真实 token。
- 测试分层：DAO 单测（内存 SQLite）、orchestrator 状态机单测（注入假 agentRuntime）、冒烟脚本端到端。质量门禁：`tsc --noEmit` 与 `electron-vite build` 必须通过。

## 10. 打包与分发

- 构建：`electron-vite build`（主/preload/renderer 三端），打包用 electron-builder（README 提供说明）。
- **ESM 注意事项**：pi-ai / pi-agent-core 为 ESM only，主进程 bundle 需以 ESM 输出；electron-vite 产物中若出现 CJS 桥接需求，使用 banner 注入 `import { createRequire } from 'module'; const require = createRequire(import.meta.url)` 的 shim，以兼容依赖树中残留的 CJS 引用。
- **安装约束**：`npm install --ignore-scripts`（SPEC §8），规避 better-sqlite3 之外的 postinstall 联网行为；better-sqlite3 的原生绑定需在打包阶段用 electron-builder 的 rebuild 能力对齐 Electron ABI。
- 分发产物：macOS dmg（arm64/x64）、Windows nsis、Linux AppImage；asar 打包时将 better-sqlite3 原生模块列入 asarUnpack。
- 首启初始化：创建 `~/.covans/`、建库、跑 migration、建 workspaces/ 与 avatars/ 根目录、写入默认设置；旧 userData 仅在目标不存在时复制，不做删除。

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| pi 包（@earendil-works/*）版本变动 / API 漂移 | 编译或运行时破坏 | package-lock 锁定版本；agentRuntime.ts 是唯一直接依赖 pi 的模块（适配层），其余代码只面向内部抽象；升级前跑 smoke + 编排单测；禁止引用废弃的 @mariozechner/* scope |
| Electron 原生模块（better-sqlite3）重建失败 | 打包后崩溃 | 锁定 Electron 38 与 better-sqlite3 ^11 组合并验证；electron-builder rebuild；`--ignore-scripts` 后显式执行 rebuild 步骤写进 README |
| API key 明文存储于 SQLite | 本机被入侵时密钥泄露 | v1 明确取舍并文档化：README 显著风险提示；后续迁移 Electron safeStorage（key 加密落库，内存解密）；渲染层列表默认掩码展示 |
| 主动群并发导致成本增长 | 用户账单激增 | 每位成员先做轻量 `REPLY|SKIP` 判断；`@` 才强制回复；stopChat 一键中断。成员/轮次预算上限列入 ROADMAP，在实现前 UI 不宣称已有硬限制 |
| 成员判断输出不稳定 | 漏回或意外回复 | 严格归一化 `REPLY|SKIP`；`@` 强制；判断失败转正式回复并将真实错误展示给用户；修订号丢弃过期结果 |
| 长会话上下文超限 | 生成报错 | 群聊使用前文总结 + 最新 5 条消息，单聊历史限最近 30 条，记忆限 30 条；超长时按 token 预算从 oldest 侧截断 |
| 记忆提取误记/隐私顾虑 | 用户信任受损 | Memory 面板全量可见、可删；自动提取失败静默且不阻塞主流程；手动记忆不被自动去重误删 |
| 单写者阻塞（大消息流式落库 + UI 读取） | UI 卡顿 | WAL 模式读写并发；落库合并小事务；渲染端 delta 渲染做 rAF 节流 |
