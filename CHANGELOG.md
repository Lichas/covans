# Changelog

本文件记录 Covan 面向用户的变化，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 私聊的「自然追问」开关：开启时 Bot 仅在判断确有补充价值时另发最多 2 条短消息，默认开启。
- 群聊支持基于上一轮真实发言继续延展；成员每轮重新判断，避免复述，无人有新观点即停，整次用户话题最多 5 轮。
- 群聊列表项支持右键删除；确认后同时删除群消息、成员关系与关联 Agent 私聊记录。
- 新 Bot 使用随应用分发的默认头像；「关于我」支持上传、更换和恢复自己的头像。
- 应用数据和 Agent 工作区默认统一到 `~/.covans/`，首次启动自动创建，并在必要时安全复制旧本机数据。

### Changed

- 将 Electron 应用从 `project/` 提升到 Git 仓库根目录，仓库 clone 后可直接执行 `npm install` 和 `npm run dev`。
- 建立 AI 友好的 spec-driven 文档结构，明确 PRD、SPEC、Architecture、Design、Roadmap 和 Bugfix 记录的边界。

## [0.1.0] - 2026-09-09

### Added

- Electron + React 三栏多 Bot 聊天体验，支持 Markdown、流式回复、消息时间、草稿、导出与错误重试。
- OpenAI、Anthropic、Google、OpenRouter、Kimi Coding Plan、智谱、DeepSeek、LM Studio 和 OpenAI-compatible Provider，模型列表动态拉取。
- 每个 Bot 独立的人设、模型、推理强度、记忆和文件工作区。
- 「关于我」资料与共享记忆，以及 Agent 通过自然语言修改 Bot 名称、人设和头像的工具。
- 本地 SVG 与 Images API 双模式头像生成，以及 Agent 图片生成结果回传。
- 单条消息最多 8 张图片的多模态输入、图片回复、预览与 Markdown 导出。
- Agent 之间的私聊咨询、内联记录卡片和详情浮窗。
- 单聊列表右键置顶/取消置顶，顶部最多显示 3 个 Bot。
- 群聊「主动回复」和「顺序回复」机制，前文总结 + 最新 5 条上下文，回复准备头像动画。

### Changed

- Bot 模型配置移入右侧面板的独立「模型」Tab。
- 群聊不再向消息流写入“成员依次发言”等调度文字。

### Fixed

- 修复「清空聊天记录」的 preload/API 契约缺失。
- 修复 Kimi `k3` 因 Temperature 不符合模型约束而返回 400。
- 修复 LM Studio 完整 endpoint 粘贴后无法连接，以及无 Key 本地运行时的兼容问题。
- 修复停止生成后群聊后续成员仍继续回复、中文输入法误发送和同毫秒历史分页遗漏。
