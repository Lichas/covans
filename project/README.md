# Covan — 多 Bot 智能体聊天桌面应用

类 Grok Bot 的 Electron + React 桌面应用：创建多个有独立人设、记忆、模型配置与文件工作区的 Bot，与它们单聊，或把它们拉进群组讨论。双场景定位：**工作协作分队**（开发/产品/研究）与 **虚拟伴侣陪伴**。Agent runtime 基于 [pi（earendil-works/pi-mono）](https://github.com/earendil-works/pi) 的统一 LLM 抽象层，支持 30+ 模型供应商。

## 功能一览

- **多 Bot 管理**：名称/头像/标签/描述/人设 prompt，内置 8 套人设模板（高级全栈、架构设计师、Code Reviewer、测试员、产品经理、设计师、虚拟女友·小美女、自定义）
- **群聊编排**：创建群聊、指定「协调 Bot」主持讨论（JSON 决策协议决定谁发言），支持 @提及强制发言、最多 5 人截断、失败兜底
- **独立记忆**：每个 Bot 的长期记忆（对话中自动提取 + 手动增删），下次对话自动注入 system prompt
- **独立工作区**：每个 Bot 一个文件目录，agent 可通过 workspace_read / workspace_write / workspace_list 工具读写（路径逃逸防护）
- **多 LLM Provider**：OpenAI / Anthropic / Google / OpenRouter / Kimi Coding Plan / 智谱 / DeepSeek / 任意 OpenAI 兼容端点（Ollama、vLLM、公司网关）/ 内置 Mock（离线体验）；每 Bot 可绑定不同 provider 与模型
- **流式输出 / 随时停止 / 错误重试**；主题跟随系统（浅色/深色）
- **Markdown 阅读体验**：表格、任务列表、代码高亮与代码复制；消息时间与日期分隔；引用回复
- **聊天效率**：独立持久草稿、中文输入法保护、⌘K 搜索、会话恢复、完整 Markdown 导出；群聊停止会取消后续成员发言
- **关于我**：个人资料、交流偏好、目标与边界；可编辑/删除的共同记忆，显示记录来源，供所有 Bot 的后续对话使用
- **自然语言设定与双模式头像**：Agent 可通过实际工具修改名称、人设、emoji；按人设扩写提示词；本地 SVG 插画或配置 Images API 生成图片头像
- **Agent 私聊**：Bot 向另一位 Bot 咨询，消息流中插入私聊卡片，点击浮窗查看真实记录、状态与时间；支持停止，不递归发起私聊
- **最多 3 个置顶 Bot**：在左侧单聊列表项右键 → 置顶/取消置顶；顶部只显示已置顶头像，没有空槽位

本轮改进、验证与后续优先项见 [体验迭代记录](UX-NOTES.md)。

## 运行

macOS 可双击仓库根目录的 `start.command`，或运行 `./start.command`。脚本会检查 Node、安装缺失依赖并检查 Electron 原生模块，随后启动应用。当前已在系统 Node 26.5.0 上验证；Electron 仍使用自己的内置 Node，两者 ABI 不混用。

```bash
# 要求 Node >= 22.19（pi 包 engines 约束；Electron 38 内置 Node 22）
npm install --ignore-scripts   # pi 官方推荐；better-sqlite3 需随后重建
npx electron-builder install-app-deps  # 为 Electron 构建原生依赖

npm run dev      # 开发模式（electron-vite dev，热更新）
npm run build    # 构建 out/
npm run smoke    # 使用 Electron 的 Node 模式验证 Mock Provider 全链路
npm run test:ui  # 构建并运行独立临时 profile 的真实 Electron 点击回归
npm run test:context # 关于我/右键置顶/头像/Agent 工具/私聊的真实 Electron 回归
npm run test:local-llm # 可选：连接 localhost:1234 的真实 LM Studio 模型
```

> 开发模式下 Electron 加载 better-sqlite3 需要的是 **Electron 的 ABI** 构建。若 `npm run dev` 报原生模块 ABI 错误，执行：
> `npx electron-rebuild -f -w better-sqlite3`（或 `npm install electron-rebuild -D` 后运行）。

## 打包

```bash
npm run pack     # electron-builder --mac --dir（产物在 release/）
```

打包注意：pi 包为 **ESM only**，若单文件构建出现 `Dynamic require of "child_process" is not supported`，需在 esbuild 加 banner 注入 `createRequire` shim（详见 `../ARCHITECTURE.md` §10）。

## 快速上手

1. 启动后点左下角齿轮 → **Provider 管理** → 新增（填入 API Key；Kimi Coding Plan 保存后点击「拉取模型」选择账号可用模型；想离线体验选 `mock` 类型）
2. 左上「+」→ **新建 Bot** → 选人设模板（如「虚拟女友·小美女」或「高级全栈」）→ 创建后自动进入单聊
3. 左上「+」→ **创建群聊** → 勾选多个 Bot → 可选指定协调 Bot → 在群里提需求，协调者会分派讨论
4. 右侧面板管理该 Bot 的**设定 / 记忆 / 工作区**
5. 左侧 **关于我** 填写资料，或在聊天中说「请记住，我喜欢先看结论」；共同记忆可随时编辑/删除
6. 右键单聊列表项 **置顶**，最多 3 位；同一菜单 **取消置顶**
7. 点击 Bot 设置中的头像 → **设计头像**。本地插画立即可用；**设置 → 头像生成** 选择支持 Images API 的 Provider 与模型后，才能使用 AI 生图。Coding Plan 不等于生图服务
8. 对 Bot 说「改名为小蓝，生成蓝色机器人头像」或「和设计师讨论一下方案」；也可点聊天顶部的双人图标发起咨询。私聊卡片点击后显示浮窗

LM Studio：Provider 类型选 **OpenAI 兼容 / 本地模型**，点击 **LM Studio 本地服务 → 一键填写**，API Key 留空，点 **拉取模型** 后选择已加载实例。Base URL 是 `http://localhost:1234/v1`；若误贴 `/api/v1/chat` 或 `/v1/chat/completions`，保存时会自动规范成 `/v1`。Covan 需要自定义工具，所以使用 LM Studio 的 OpenAI 兼容 Chat Completions 入口，不直接使用不支持自定义 tools 的原生 `/api/v1/chat`。

生图使用 [Images API](https://developers.openai.com/api/reference/resources/images/methods/generate) 的 `POST /images/generations`，兼容 base64 或图片 URL 响应；不预置或猜测生图模型。自动模式未配置服务时使用本地 SVG，显式选择 AI 生图时配置不足会显示错误。生图最多等待 120 秒、下载限制 16MB。调用会消耗所选服务额度，API 兼容性需以该服务文档为准。

## 目录结构

```
main/       Electron 主进程（db / agentRuntime / orchestrator / memory / workspace / ipc / mockProvider）
preload/    contextBridge 安全桥（window.covan）
renderer/   React 三栏 UI（stores / components / lib）
shared/     主↔渲染共享类型与 IPC 通道常量（接口契约）
scripts/    原生运行时冒烟 + Electron UI 回归测试
../SPEC.md  单一事实来源（数据模型/契约/协议/UI 规范）
../PRD.md   产品需求文档（另有 .docx）
../ARCHITECTURE.md  技术方案（另有 .docx）
```

## 隐私与安全

- SQLite 库、头像、工作区保存在本机 `userData` 目录，无遥测；聊天内容、使用到的工作区内容、个人资料与共同记忆会发送给对应模型服务，头像提示词会发送给所选生图服务
- ⚠️ API Key 当前以**明文**存于本地 SQLite，请勿与他人共享该目录；safeStorage 加密已列入路线图（见 PRD §9 M3）
- 工作区文件工具被限制在对应 Bot 的目录内（resolve + 前缀校验防逃逸）；应用工具仅暴露 Bot 设定、用户记忆及私聊，不向模型返回 Provider 密钥
- 私聊仅转发咨询问题，不自动转发主会话；接收方只开放工作区读取/列表工具，禁止修改资料和递归私聊。每轮最多 3 次咨询，每个主会话最多同时运行 3 个
