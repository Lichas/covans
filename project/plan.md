# Plan — Grok Bot 风格 Electron 多 Bot 聊天应用

## 需求拆解（来自用户 + 截图参考）
1. 多 Bot 创建与管理（名称、头像、人设/系统提示、标签、描述）
2. 群聊：把多个 Bot 拉进一个群组讨论，支持主动/顺序回复机制、@提及
3. 每个 Bot 独立的：记忆（长期记忆条目）、设定（人设 prompt、模型、参数）、工作区（文件目录）
4. 双用途：工作协作分队（开发/产品/研究）+ 虚拟伴侣陪伴聊天（女友人设等）
5. Agent Runtime：基于 pi（pi-mono, badlogic 的统一 LLM 抽象 agent runtime），支持多 LLM provider（OpenAI / Anthropic / Gemini / OpenRouter / 本地 OpenAI 兼容端点等）
6. 交付 PRD（产品需求文档）+ 技术方案文档（.docx）
7. 完整交付：可运行的 Electron + React 项目源码 + 构建说明

## 参考 UI（截图）
- macOS 三栏布局：左侧会话列表（搜索框、置顶 Bot 头像、群聊标识 +N、未读点）、中间消息流（用户/Bot 气泡、图片消息，不展示群调度系统条）、右侧 Bot 或群聊设置面板
- 通用设置页：账户、外观（主题/语言跟随系统）、系统、Bot（时区、自动审核开关与规则）
- 顶部「+」创建：新建 Bot / 创建群聊 / 新建聊天

## 阶段

### Stage 0 — 调研（explore subagent）
- 调研 pi-mono（pi agent runtime）的包结构、API、如何配置多 provider、如何自定义 system prompt / 工具 / 会话
- 输出：集成要点摘要（写代码时直接使用）
- 技能：无（纯网络调研）

### Stage 1 — PRD + 技术方案（report-writing skill）
- 产出 PRD.md：背景、目标用户、用户故事、功能需求（FR）、非功能需求、信息架构、交互流程、边界情况、路线图
- 产出 ARCHITECTURE.md：Electron 主/预加载/渲染进程设计、数据模型（SQLite + 文件工作区）、pi agent 集成层、群聊编排协议、记忆系统、安全与 IPC 边界
- 最终转 .docx（docx skill）

### Stage 2 — 项目脚手架（vibecoding-general-swarm + coder subagent）
- electron + electron-vite + React 18 + TypeScript + Tailwind + shadcn 风格组件
- 主进程：窗口、SQLite（better-sqlite3）、工作区文件管理、IPC
- preload：contextBridge 安全 API
- renderer：三栏 UI 复刻参考图

### Stage 3 — 核心功能（coder subagents 并行/串行）
- Bot CRUD + 头像生成占位、人设模板库（开发分队模板 + 伴侣模板）
- pi agent 集成层：provider 配置、流式输出、每 Bot 独立 agent 实例
- 群聊编排器：主动并发/顺序回复、@提及、前文总结 + 最新 5 条消息、消息路由
- 记忆系统：自动摘要 + 手动记忆条目 + 注入 system prompt
- 工作区：每 Bot 一个目录，agent 可读写（pi 工具）
- 设置页：主题、provider 密钥、自动审核规则

### Stage 4 — 验证与打包
- 构建（electron-vite build）、类型检查、冒烟测试（mock provider）
- README（运行/构建指南）、交付 zip 到 /mnt/agents/output/

## 交付物
- /mnt/agents/output/grokbot-clone/ 完整项目源码（zip）
- PRD.docx + 技术方案.docx
- README.md
