# Bugfix 记录

这里只记录值得长期保留的缺陷知识：症状、根因、修复和防回归方式。面向用户的变化写入根目录 `CHANGELOG.md`，不在这里重复发布说明。

## 2026-09-10 · Bot 用文本冒充已完成跨 Bot 私聊

- **症状**：用户要求 Kimi Bot 咨询另一位 Bot 时，回复声称“已经问过”并引用对方回答，但会话中没有私聊卡片，也没有实际工具调用。
- **根因**：运行时已向模型提供 agent_private_chat，但旧系统提示仅说明“可以”使用，没有规定明确咨询请求必须调用，也没有禁止在缺少工具结果时模拟另一位 Bot 的回复。模型以普通文本结束后，应用无法把其陈述当作真实工具执行。
- **修复**：系统提示新增跨 Bot 咨询真实性约束：明确请求必须先 list_bots 再 agent_private_chat，只有收到本轮工具结果才能声称完成或转述回复；失败、不可用及目标不存在时必须如实说明。工具装配提示同步强调该规则。
- **回归**：`npm run smoke` 断言运行时系统提示同时包含强制调用、结果前置、禁止伪造和执行事实核验约束。

## 2026-09-10 · LM Studio 无法识别本轮 user query

- **症状**：用户在单聊发送“继续呢”等正常消息后，LM Studio/Qwen 返回 Jinja template 错误 `No user query found in messages`。
- **根因**：数据库和 pi 历史中存在 user 消息，但运行时把它随历史预填给新 Agent，再调用 `agent.continue()`；部分 LM Studio 模板只把本轮显式 prompt 识别为 user query，无法兼容这种 continuation 启动方式。
- **修复**：Agent 初始历史只保留到最新输入之前，最新 user/toolResult 消息改由 `agent.prompt(message)` 显式提交；新增默认关闭的隐私安全本地观测，记录历史与最终 payload 的角色摘要、续发结果及错误分类。
- **回归**：`npm run test:context` 的 OpenAI-compatible fixture 断言首个真实 Agent payload 最后一条为 user，并验证日志包含 `payload_last_role=user`，且不含已知聊天正文。

## 2026-09-10 · 私聊自然追问复述并暴露分段机制

- **症状**：Bot 已在主回复中完整回答，随后却从开头复述，还可能说“下一条来了”“重新来”等暴露内部调度的话。
- **根因**：旧流程先用一次 completion 判断 `REPLY|SKIP`，再对以 assistant 消息结尾的历史调用 `agent.continue()` 生成正文；判断与生成相互独立，且违反运行时要求历史最后一条为 user 消息的约定。发送前也没有内容校验。
- **修复**：较长主回复先生成一个自然完整的语义段；续发改为一次轻量 completion 同时决定并起草候选，默认 `SKIP`。候选只有在能推进未完成的新内容、遗漏重要信息或需要明确回答时才允许发送，并在落库前检查长度、近期回复长片段重复和调度元话术。
- **回归**：`npm run smoke` 验证较长回答按三个不重复语义段依次发送、有价值候选只发一次并及时停止、两个不同承接点最多发送两条、包含“下一条来了”的候选被拦截，以及关闭开关后只保留主回复。

## 2026-09-10 · Agent 看似无法调用工具

- **症状**：Bot 面对文件读写、网页原文或最新信息任务时，容易只给文本建议，缺少可验证的实际操作。
- **根因**：pi-agent-core 的 ReAct 循环已接通，但工具直接在 `agentRuntime.ts` 内零散拼装；只有基础文件读/写/列表，没有网页工具、精确编辑、分页读取和明确的模型工具指引。
- **修复**：新增单一能力装配层，将工作区、只读网页与应用工具按会话权限组合；网络层由 Electron 注入 Chromium `net.fetch` adapter，继承系统代理并兼容 Fake-IP，动态页再自动回退到隐藏沙箱 BrowserWindow 执行 JavaScript；文件层加入 realpath 防逃逸。
- **回归**：`npm run test:context` 通过本地 OpenAI-compatible fixture 执行真实 tool-call/result 循环，验证写入→精确编辑→列表→分页读取和普通/私聊工具集权限；同时用 Chromium Fake-IP 域名映射与本地 HTTP 代理提供只能由 JavaScript 写入的 DOM 标记，断言渲染后内容经工具回灌模型。

## 2026-09-10 · 开启成熟内容仍缺少生活照

- **症状**：部分角色在开启成熟内容后仍只有几张日常照，原素材中的泳装照没有显示。
- **根因**：原素材目录有 42 张，实际打包目录仅 26 张；10、12 号泳装等 16 张未复制，开关只能显示已打包的照片。
- **修复**：补齐全部素材，逐张检查新增图片并补全 general/mature 清单。泳装、偏私密睡袍及低领浴衣属于成熟风格，常规穿着按日常处理。
- **回归**：`npm run test:avatars` 检查清单与打包文件一致、本地源文件名及 SHA-256 一致；在临时 profile 中验证关闭时目录精确过滤、开启后全部 42 张可经图片协议读取，并验证新增男角色照片可显示。

## 2026-09-10 · 成熟内容开关难以找到

- **症状**：用户打开「关于我」后误以为当前版本没有成熟内容开关。
- **根因**：开关放在头像与长表单之后，首屏不可见；弹窗还可能保留上次的记忆标签。
- **修复**：将内容偏好卡移到资料页第一项，每次打开弹窗默认进入「我的资料」。
- **回归**：`npm run test:avatars` 在 960×640 窗口断言开关无需滚动即可完整进入视口，并验证从记忆页关闭后重新打开仍可直接看到开关。

## 2026-09-09 · 清空聊天记录调用失败

- **症状**：右键「清空聊天记录」显示 `api.clearChatMessages is not a function`。
- **根因**：renderer 已调用新 API，但运行中的 preload 契约未同步/未重启。
- **修复**：在 shared 类型、IPC 通道、preload 和主进程同步实现；清空时一并清除流式状态、私聊记录和群聊前文总结。
- **回归**：Electron UI 测试从 `window.covan` 真实调用该方法；主/preload 变更后使用 `restart.command`。

## 2026-09-09 · Kimi k3 拒绝 Temperature

- **症状**：聊天返回 `400 invalid temperature: only 1 is allowed for this model`。
- **根因**：Bot 通用 Temperature 设置被直接发给 k3，而该模型只接受 `1`。
- **修复**：Provider 为 Kimi 且模型 ID 为 `k3` 时，运行时统一发送 `temperature: 1`，UI 禁用该滑杆并显示模型固定值。
- **回归**：`npm run test:multimodal`；需要真实 Kimi 验证时使用显式 `--kimi` 参数，避免默认消耗额度。

## 2026-09-09 · LM Studio 本地地址与推理选项不生效

- **症状**：粘贴 `/api/v1/chat` 完整地址后连接失败，或通用 Provider 无法表达 LM Studio 的推理强度。
- **根因**：Covan 依赖 OpenAI-compatible Chat Completions 和自定义 tools，不直接使用 LM Studio 原生 stateful chat endpoint。
- **修复**：新增 `lm-studio` Provider，把常见完整 endpoint 规范到 `/v1`，动态拉取已加载模型，并按模型格式传递推理提示。
- **回归**：`npm run smoke` 验证 URL 规范化；`npm run test:local-llm` 在本地 1234 端口服务已启动时验证实际请求。

## 新条目模板

```markdown
## YYYY-MM-DD · 简短标题

- **症状**：用户看到了什么。
- **根因**：为什么发生。
- **修复**：修改了哪个契约或边界。
- **回归**：哪个测试能防止它再发生。
```
