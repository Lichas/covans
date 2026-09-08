# Covan — 多 Bot 智能体聊天桌面应用

类 Grok Bot 的 Electron + React 桌面应用：创建多个有独立人设、记忆、模型配置与文件工作区的 Bot，与它们单聊，或把它们拉进群组讨论。双场景定位：**工作协作分队**（开发/产品/研究）与 **虚拟伴侣陪伴**。Agent runtime 基于 [pi（earendil-works/pi-mono）](https://github.com/earendil-works/pi) 的统一 LLM 抽象层，支持 30+ 模型供应商。

## 功能一览

- **多 Bot 管理**：名称/头像/标签/描述/人设 prompt，内置 8 套人设模板（高级全栈、架构设计师、Code Reviewer、测试员、产品经理、设计师、虚拟女友·小美女、自定义）
- **群聊编排**：创建群聊、指定「协调 Bot」主持讨论（JSON 决策协议决定谁发言），支持 @提及强制发言、最多 5 人截断、失败兜底
- **独立记忆**：每个 Bot 的长期记忆（对话中自动提取 + 手动增删），下次对话自动注入 system prompt
- **独立工作区**：每个 Bot 一个文件目录，agent 可通过 workspace_read / workspace_write / workspace_list 工具读写（路径逃逸防护）
- **多 LLM Provider**：OpenAI / Anthropic / Google / OpenRouter / Kimi Coding Plan / 智谱 / DeepSeek / 任意 OpenAI 兼容端点（Ollama、vLLM、公司网关）/ 内置 Mock（离线体验）；每 Bot 可绑定不同 provider 与模型
- **流式输出 / 随时停止 / 错误重试**；主题跟随系统（浅色/深色）

## 运行

```bash
# 要求 Node >= 22.19（pi 包 engines 约束；Electron 38 内置 Node 22）
npm install --ignore-scripts   # pi 官方推荐；better-sqlite3 需随后重建
npm rebuild better-sqlite3     # 为本机 Node 构建原生模块（开发模式用系统 Node 跑 esbuild/类型检查时需要）

npm run dev      # 开发模式（electron-vite dev，热更新）
npm run build    # 构建 out/
npm run smoke    # 纯 Node 冒烟测试：mock provider 全链路（建 bot→建群→编排发言→记忆写入）
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

## 目录结构

```
main/       Electron 主进程（db / agentRuntime / orchestrator / memory / workspace / ipc / mockProvider）
preload/    contextBridge 安全桥（window.covan）
renderer/   React 三栏 UI（stores / components / lib）
shared/     主↔渲染共享类型与 IPC 通道常量（接口契约）
scripts/    smoke.mjs 冒烟测试
../SPEC.md  单一事实来源（数据模型/契约/协议/UI 规范）
../PRD.md   产品需求文档（另有 .docx）
../ARCHITECTURE.md  技术方案（另有 .docx）
```

## 隐私与安全

- 全部数据（SQLite 库、头像、工作区）仅存本机 `userData` 目录，无遥测
- ⚠️ API Key 当前以**明文**存于本地 SQLite，请勿与他人共享该目录；safeStorage 加密已列入路线图（见 PRD §9 M3）
- agent 工具被限制在对应 Bot 的工作区内（resolve + 前缀校验防逃逸）
