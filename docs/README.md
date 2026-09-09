# Covan 文档导航

这里是 Covan 的唯一文档入口。项目采用 **Spec-driven AI development**：先明确行为契约，再修改实现和测试。

## 文档分工

| 文档 | 回答的问题 | 权威性 |
| --- | --- | --- |
| [PRD](PRD.md) | 为什么做、为谁做、用户验收标准是什么 | 产品范围 |
| [SPEC](SPEC.md) | 当前已实现的行为、数据、IPC 与边界条件 | **实现的单一事实来源** |
| [ARCHITECTURE](ARCHITECTURE.md) | 模块如何协作、为何这样设计 | 技术决策 |
| [DESIGN](DESIGN.md) | 信息架构、交互和视觉准则 | 体验决策 |
| [ROADMAP](ROADMAP.md) | 下一步候选项、优先级与未完成工作 | 计划，不代表已实现 |
| [BUGFIXES](BUGFIXES.md) | 关键故障的症状、根因、修复与回归测试 | 维护记录 |
| [CHANGELOG](../CHANGELOG.md) | 用户在每个版本能感知到的变化 | 发布记录 |

`archive/` 仅保存历史交付快照，不作为开发依据。

## 冲突处理

1. 当文档冲突时，已实现行为以 `SPEC.md` 和可执行测试为准。
2. PRD 说明产品意图，不复制数据库字段或 TypeScript 签名。
3. Architecture 说明技术决策，不再定义一套与 SPEC 平行的接口。
4. Roadmap 中的内容都是未完成项；完成后应移出，并同步 SPEC 与 CHANGELOG。
5. 如代码与 SPEC 不一致，不新建“临时说明”。在同一变更中修正代码或 SPEC。

## 变更路由

| 变更类型 | 必须更新 |
| --- | --- |
| 新用户能力 | PRD 验收标准、SPEC、相关测试、CHANGELOG |
| 数据库 / IPC / Agent 协议 | SPEC、契约类型、migration/回归测试；必要时更新 Architecture |
| 视觉或交互原则 | DESIGN、UI 回归测试、CHANGELOG |
| Bugfix | 回归测试、BUGFIXES；用户可感知时更新 CHANGELOG |
| 仅重构 | Architecture（若边界变化）和测试；不虚构产品变化 |

AI 贡献者的必须流程见根目录 [AGENTS.md](../AGENTS.md)。
