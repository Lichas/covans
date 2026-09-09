# Bugfix 记录

这里只记录值得长期保留的缺陷知识：症状、根因、修复和防回归方式。面向用户的变化写入根目录 `CHANGELOG.md`，不在这里重复发布说明。

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
