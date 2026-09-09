# Covan AI 开发指南

本文件是 AI 编码 Agent 进入仓库后的第一入口。目标是让每次修改都可以从规格追溯到代码和测试。

## 开始任务前

1. 先阅读 [docs/README.md](docs/README.md)，理解文档权威顺序。
2. 阅读 [docs/SPEC.md](docs/SPEC.md) 中与任务相关的章节。
3. 根据任务再查阅 PRD、Architecture 或 Design，不必加载无关文档。
4. 用 `rg` 检查实现和测试，不要只根据文档猜测现状。

## Spec-driven 流程

1. 明确要改变的可观测行为和验收条件。
2. 如果行为契约变化，先或同时更新 `docs/SPEC.md`。
3. 修改共享类型与 IPC 时，主进程、preload、renderer 必须同步，不允许只改一端。
4. 为新行为添加最小但能防止回归的测试。
5. 运行与风险相称的验证，最低要求是 `npm run typecheck` 和 `npm run smoke`。UI/IPC 变更还要运行相关 Electron 回归。
6. 按 [docs/README.md](docs/README.md#变更路由) 同步文档。用户可感知的变化写入 `CHANGELOG.md`，关键缺陷写入 `docs/BUGFIXES.md`。

## 代码边界

- `main/`：Electron 主进程、SQLite、Provider/Agent 运行时、编排与工具。
- `preload/`：唯一可对 renderer 暴露的 Electron 桥接。
- `renderer/`：React UI 与 Zustand 状态，禁止直接访问 Node.js、SQLite 或密钥。
- `shared/`：主进程与 renderer 共用的类型和 IPC 通道，是编译期契约。
- `scripts/`：冒烟、本地模型与真实 Electron UI 回归；测试使用临时 profile，不得污染用户数据。

## 安全与数据

- 不读取、打印、提交用户的 API Key、私聊内容或 `userData` 数据库。
- 不将真实付费 Provider 用于默认测试；优先使用 Mock 或 loopback 服务。
- 不删除未跟踪文件、用户数据或无关修改。
- Provider Key 当前仍是 SQLite 明文存储；在 safeStorage migration 完成前，不宣称已加密。

## 常用命令

```bash
npm run typecheck
npm run smoke
npm run test:ui
npm run test:context
npm run test:multimodal
./start.command
./restart.command
```

不要为一次任务新建额外的 `notes-final.md` 或 `spec-v2.md`。将信息更新到已有权威文档。
