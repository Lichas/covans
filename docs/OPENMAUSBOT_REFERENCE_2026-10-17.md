# OpenMausBot 借鉴报告（2026-10-17）

**结论**：OpenMausBot 与 Covan 定位几乎重合（本地多 Agent 聊天桌面端，Claude/Codex CLI 驱动，Jev 决策），但它的成熟度集中在**信任与可用性**：审批分级、只写密钥、工具活动可见、Provider 模型目录。Covan 不需要复制它的云桌面、应用市场、移动端与双进程架构；最值得吸收的是「每一步都能被用户看见和批准」，其次是房间级 Jev 决策与模型选择器的可用性设计。

## 优先建议

| 优先级 | 建议 | 预期收益 | 依赖和前提 |
| --- | --- | --- | --- |
| P0 | 工具调用的审批卡片与分级（默认询问） | 把 bash、文件写入、MCP 调用从"静默执行"变成可批准；这是当前最大的信任缺口 | 在 `main/tools/*` 与 `extensions/runtime.ts` 的执行前置一层 broker；IPC 增加请求/应答事件；allowlist 落 SQLite |
| P0 | Provider 密钥只写化 + `safeStorage` 迁移 | 渲染层不再拿到明文 key，补齐 ROADMAP 的 P0 | 与密钥迁移同一变更；`listProviders` 只回 `has_api_key` |
| P1 | 工具活动折叠 chip | 用户能看到"它跑了什么、花了多久、失败在哪"，而不是只看最终气泡 | 复用现有脱敏观测字段，不需要新的持久化 |
| P1 | 房间级 Jev 决策（一次判断选谁发言） | 群聊 N 个 Bot 从 N 次判断降为 1 次，且能表达"这轮谁最合适" | 现有 `decisionStrategy.ts` 扩展为返回成员集合；保留 @ 强制回复 |
| P1 | Provider rail 模型选择器与三种不可用态 | 模型选择从文本框变成可选目录，不可用有原因 | 复用刚完成的 `cli:models` 目录与 provider 图标 |
| P2 | 团队/空间分组 + 共享指令 | 多 Bot 有归属，团队指令不必逐个 Bot 粘贴 | 需要会话上下文注入点与侧栏分组，additive migration |
| P2 | Bot 右键菜单扩展（未读/归档/复制 ID） | 联系人式管理更完整 | 纯 UI + 状态字段 |
| P2 | 皮肤 token 与对比度校验脚本 | 主题可扩展、对比度可回归 | 现有 CSS 变量收敛 |

## 调研范围与方法

- **OpenMausBot 基线**：`988e15ceb`（本地 clone，2026-10-17）。Electron + React 19 + Vite 7 + Tailwind 4，Node ≥ 24，pnpm。
- **运行方式**：`pnpm install --ignore-scripts`（约 3 分钟，2.2GB）→ `pnpm dev --port 5273`（渲染层）+ `pnpm dev:server`（harness server，`127.0.0.1:8799`，本机浏览器视为 owner）→ 用系统 Chrome 通过 Playwright 打开并点击。未接任何真实 Provider，未发起付费调用。
- **实际点过**：5 步引导、主聊天、模型选择器、Bot 资料页、电脑面板、新建菜单、Apps 市场、审批级别弹层、Bot 右键菜单。
- **Covan 基线**：`d7be533`，以当前实现与 `docs/SPEC.md` 为准。

## 它已经解决而 Covan 还没有的

| 能力 | OpenMausBot 的做法 | Covan 现状 |
| --- | --- | --- |
| 工具审批 | 5 级（Ask / Auto-accept edits / Approve for me / Full / Custom），按 Bot 与按 thread 覆盖；风险动作变成消息流里的单行卡片，Allow once / Always allow / Deny；拒绝作为工具失败结果回给引擎，回合继续 | 无审批层；`bash` 在 sandbox 内直接执行，MCP 工具直接调用；`cli_access` 只表达 CLI 的沙箱档位 |
| 密钥 | 只写：接口只返回 `configured` 布尔；UI 显示绿点 + "已连接" + `•••• (paste to replace)`，清空才出现 Clear | Provider key 明文存 SQLite，且**渲染层能拿到明文**（编辑表单读写）；Jev/MCP 已用 safeStorage |
| 工具活动 | 每条回复下折叠 chip（工具名、耗时、状态），可展开；截图回灌为消息 | 只有交付文件卡片与 Debug 报告，过程不可见 |
| 群聊决策 | 房间级「Auto (Jev)」：一次判断从 roster 里选 1..N 个发言者，回复下标注 `Picked by Jev · n%` | 每个 Bot 各调一次 Jev/LLM 判断（N 次），无"谁最合适"的表达 |
| 模型选择 | provider rail + 模型列表（Default / Loaded / bot's model / 勾选），三种不可用态（隐藏、置灰带原因、未就绪卡），可"使用 Bot 默认模型"回退 | 文本框 + Provider 下拉；CLI Bot 刚有目录，但无 rail、无不可用原因、无会话级覆盖 |
| Bot 管理 | 右键：置顶 / 设为协调者 / 移至团队 / 标记未读 / 编辑资料 / 复制 / 复制对话 ID / 归档 / 删除 | 置顶（上限 3）与删除 |
| 组织 | 团队 = 侧栏分组 + 共享指令 + 共享电脑 + 每队一个 Chief | 扁平 Bot 列表与群聊，无分组、无团队共享指令 |

## 建议借鉴的落地方式

### 1 审批分级与卡片（P0）

**现状。** Covan 的工具执行没有询问环节：`main/tools/bash.ts` 在 macOS sandbox 内直接跑，工作区写入直接执行，MCP 工具直接调用。用户能看到的只有最终回复和交付卡片。

**建议。** 在 AgentTool 执行前加一个 `ApprovalBroker`：工具声明风险等级（命令执行、工作区写入、MCP 调用、资料修改），broker 查询该 Bot/该会话的级别与 allowlist，需要询问时通过 IPC 发 `approval-request`，渲染层在消息流插入卡片，用户允许/拒绝后 broker 返回结果或拒绝原因；拒绝作为工具错误回给模型，回合继续而不是中止。

关键细节照它的做法：
- 级别用**用户语言**而不是协议名：「请求批准 / 代我批准 / 完全访问」，每个级别一行后果说明；provider 不支持的能力要说明（它写"该提供方没有自动审核，行为与询问相同"）。
- 「总是允许」必须**精确绑定**（命令 + cwd + Bot + 工具），不要模糊前缀；上限条数与撤销入口要有。
- **默认询问**，不要照抄它的默认 Full access。
- CLI Bot 的能力受 CLI 限制：`codex exec` 是一次性进程，无法中途弹审批，因此 CLI Bot 的级别映射为 CLI 沙箱开关（只读 / 可写），并在界面上说明"该运行方式按会话建立时的权限运行"。

**验收。** 默认级别下，bash 写入、MCP 调用各弹一次卡片；拒绝后回合继续且模型收到失败结果；「总是允许」重载后仍生效；allowlist 上限有提示；不改动已有交付卡片与诊断。

### 2 密钥只写化（P0）

**现状。** `Provider` 类型含 `api_key`，`listProviders` 把它回给渲染层，UI 拿它做编辑表单。

**建议。** 与 `safeStorage` 迁移同一个变更：`listProviders` 只回 `has_api_key`；编辑表单不再回填明文，改成"已配置 · 粘贴以替换"；清空输入才出现「清除」；保存后调用 `testProvider` 只显示结果与延迟，不显示值。UI 照它的三段式：标签 + 状态徽标（已配置/未配置/可选）+ 内联 Save/Test/Clear。

**验收。** 渲染层任何 IPC 响应都不含明文 key；数据库迁移可回滚且幂等；无系统密钥环时拒绝保存并给出可读原因；列表页显示"已配置"而不是掩码。

### 3 工具活动 chip（P1）

每条回复底部一行：`已运行 3 个工具 · 12.4s`，展开是逐条（工具名、参数摘要脱敏、耗时、成功/失败），失败行可点开错误。数据直接复用 `observability` 的脱敏字段，不需要新表；默认折叠，遵守减少动效。

**验收。** 每次工具调用对应一条记录；不出现完整命令参数以外的敏感内容（密钥、文件正文）；折叠状态在会话切换后保持默认折叠。

### 4 房间级 Jev 决策（P1）

**现状。** `response_decision_strategy` 是**每 Bot** 的判断，群聊 3 个成员 = 3 次判断调用，且无法表达"这轮由谁回答更合适"。

**建议。** 增加房间级 responder 模式：`Auto (Jev)` 时用一次结构化请求提交成员清单（名称/描述/标签）与最近消息，返回 1..N 个成员或"多个成员"；低置信度、超时或未配置时回落到协调者/首位成员。回复旁可标注 `由 Jev 挑选 · 82%`（可关闭）。@ 提及仍然强制回复，不进入决策。

**验收。** 未被 @ 的群消息只产生 1 次决策调用；选择结果与实际发言者一致；失败回落可观测；顺序回复模式保持现有语义；每 Bot 的"是否续发"仍走原策略。

### 5 模型选择器（P1）

把 Provider 选择从下拉改成**左侧 Provider 轨 + 右侧模型列表**：轨道只列已配置且有目录的 Provider，当前所选即使不可用也保留并显示原因；模型行标注 `默认`、`(Bot 的模型)`、勾选当前；底部「使用 Bot 默认模型」；「管理 Provider」跳设置。

Covan 已有的 `cli:models` 目录与 provider 图标可直接复用；需要新增的是**会话级模型覆盖**（`bot.model` 之上的 per-chat override），并在切换后下一轮生效。

**验收。** 不可用 Provider 置灰并给出原因；切换后当前轮不变、下一轮生效；"使用默认"可还原；CLI 目录读取失败时保留自定义输入而不是空列表。

### 6 团队分组与共享指令（P2）

侧栏按团队分组 Bot 与群聊；团队提供一段共享指令与共享工作目录，注入每个成员的本轮上下文，Bot 不能改写；删除团队不删 Bot。Covan 已有每 Bot 工作区，团队目录可作为会话级子目录（与之前建议的"对话级工作区"合并做）。

**验收。** 分组不影响现有排序与置顶；共享指令出现在成员轮次的 system prompt；团队删除后 Bot 仍在。

### 7 工程实践（P2）

- **皮肤 token**：把 `index.css`/`glass.css`/`ui.css` 的形状与颜色收敛为命名 token（bg/panel/raised/control/hairline/ink/accent），并写一个按 CSS 实测的对比度脚本作为门禁。
- **组件旁测试**：它在 `src/components` 下放了 270 个 `*.test.ts`，多数只断言纯函数与状态转换；Covan 目前以 Electron 端到端为主，单测成本高。可先从决策策略、会话指纹、审批 allowlist 这些纯逻辑开始。
- **i18n**：若将来要英文版，照它的 `en.json` + source hash 校验，避免键漂移。

## 不建议引入

| 方向 | 原因 |
| --- | --- |
| 云桌面（Boat）、本地 VM、noVNC 接管、CUA 驱动、内置浏览器引擎安装 | 平台与打包重资产，与 Covan 本地优先的定位冲突；截图回灌也依赖远端算力 |
| Composio 应用市场、OAuth broker、Cloudflare worker、企业组织库/SSO/计费 | 需要服务端与合规面，当前没有商业化前提 |
| 移动端 / companion / 电话语音 / mascot | 与桌面多 Bot 核心体验无关 |
| 默认 Full access | 与 Covan 的安全基调相反；应默认询问 |
| 双进程 HTTP + SSE 架构 | Covan 的 Electron IPC + SQLite 更简单，本地单机足够；迁移成本大且无收益 |

## 推荐实施顺序

1. **审批 broker + 卡片**（P0）：先只覆盖 `bash` 与 MCP 两类高风险工具，级别存 Bot 与会话；默认询问。
2. **密钥只写化 + safeStorage 迁移**（P0）：与审批同批发布，一并解决"渲染层可见明文"。
3. **工具活动 chip**（P1）：复用观测字段，先只读展示，不做交互。
4. **房间级 Jev 决策**（P1）：与现有每 Bot 策略并存，用设置项切换，先只做"选一个成员"。
5. **模型选择器 rail + 会话级覆盖**（P1）。
6. **团队分组、Bot 菜单扩展、token/对比度门禁**（P2）。

前两项是信任基础，建议在同一轮完成；第 3–5 项各自独立，可以按用户反馈排序。
