# MCP 服务（预留）

AgentForge 将通过 **Model Context Protocol (MCP)** 把站内能力暴露给外部 Agent Host。

## 状态

| 项 | 状态 |
|----|------|
| HTTP 探测 `GET /api/v1/mcp/status` | 已预留 |
| MCP Server 进程 | 未实现（本目录骨架） |
| Tools：知识检索 / 文章摘要 | 规划中 |
| Tools：作者草稿辅助 | 规划中 |
| Resources：领域目录 | 规划中 |

## 设计目标

1. **只读优先**：先暴露 `search_articles`、`get_article`、`list_domains`。
2. **鉴权**：与平台 JWT / 服务账号对接；游客仅公共知识。
3. **与站内 Agent 解耦**：悬停快讲与面板助手走现有 `/api/v1/agent`；MCP 供外部宿主（Cursor、Claude Desktop 等）。
4. **安全**：工具参数 Zod 校验、速率限制、禁止任意 SQL/路径穿越。

## 建议目录（未来）

```
services/mcp/
  src/
    index.ts          # MCP stdio / SSE 入口
    tools/
      articles.ts
      domains.ts
    auth.ts
  package.json
```

## 与平台身份

- guest → 公共已发布内容
- reader / author / admin → 按 `packages/shared` 权限矩阵过滤 tools

当前请勿在生产启用未完成的 MCP 进程。
