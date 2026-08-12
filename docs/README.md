# AgentForge 文档索引

> 文档按内容分类存放。**源码与测试为权威**,文档用于理解设计与决策。
> 仓库结构与用法见根 `README.md`;实现状态见 `PLAN.md`。

## 系统设计(architecture/)

当前状态的权威设计文档,随代码维护:

| 文档 | 说明 |
|------|------|
| [overview.md](architecture/overview.md) | 整体架构:monorepo 分层、模块职责、数据流 |
| [agent-modes.md](architecture/agent-modes.md) | 双 Agent 体系:悬停 Agent 与 Agent 面板 |
| [animation-system.md](architecture/animation-system.md) | 动画系统架构与模板扩展 |
| [identity-permissions.md](architecture/identity-permissions.md) | 身份、权限与交流模型 |
| [security.md](architecture/security.md) | 安全清单(已实现/待办) |

## 部署运维(operations/)

| 文档 | 说明 |
|------|------|
| [postgres.md](operations/postgres.md) | 生产数据库 PostgreSQL 切换与启动 |
| [multi-instance-deployment.md](operations/multi-instance-deployment.md) | 多实例部署与韧性组件语义(P2-4) |
| [deployment.md](operations/deployment.md) | 生产部署指南:暴露面收缩、反向代理+TLS、CSP、环境变量 |

## 待办与路线图(roadmap/)

| 文档 | 说明 |
|------|------|
| [httponly-cookie-migration.md](roadmap/httponly-cookie-migration.md) | 待办:HttpOnly Cookie 会话迁移 |
| [tool-loop-roadmap.md](roadmap/tool-loop-roadmap.md) | 待办:Tool-loop 深化与 MCP |

## 开发进度

- [dev-progress.md](dev-progress.md) — 已实现 / 未实现 / 建议(报告日期 2026-08-04)

## 审查报告(reviews/)

时点快照,**不随代码维护**,仅供追溯:

| 文档 | 审查日期 | 范围 |
|------|---------|------|
| [code-review-2026-07-23.md](reviews/code-review-2026-07-23.md) | 2026-07-23 | 全仓库代码质量初查 |
| [code-review-2026-08-02.md](reviews/code-review-2026-08-02.md) | 2026-08-02 | 代码质量复查 |
| [agent-core-review-2026-08-03.md](reviews/agent-core-review-2026-08-03.md) | 2026-08-03 | Agent 核心专项审查 |
| [architecture-review-2026-08-04.md](reviews/architecture-review-2026-08-04.md) | 2026-08-04 | 架构与设计审查 |
| [architecture-decoupling-review-2026-08-09.md](reviews/architecture-decoupling-review-2026-08-09.md) | 2026-08-09 | 架构脱耦与韧性审查(含 P0/P1/P2 改造方案) |
| [comprehensive-review-2026-08-04.md](reviews/comprehensive-review-2026-08-04.md) | 2026-08-04 | 全面审查 Round 1 |
| [comprehensive-review-2026-08-04-round2.md](reviews/comprehensive-review-2026-08-04-round2.md) | 2026-08-04 | 全面审查 Round 2 增量 |

> 后两份 comprehensive-review 另有 HTML 渲染版(`.html` 同目录)。
