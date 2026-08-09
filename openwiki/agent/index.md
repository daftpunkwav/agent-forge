# 文件

- [Agent 面板对话（会话、记忆与持久化）](chat-panel.md) - /api/v1/agent/chat(+stream) 的上下文装配、会话 ACL 与匿名 TTL、历史 token 预算、滚动摘要、记忆写入启发式与进度端点。
- [悬停 Agent（Fast Direct + 双层缓存）](hover-agent.md) - 悬停讲解端到端链路：L2 缓存 v7 键与 TTL、流式早停、答案门控与空答重试、按句软流式，以及 admin 缓存清理。
- [LLM Provider 抽象（加载、解析、调用、流式）](llm-providers.md) - ProviderConfig/ByokConfig 模型、环境变量加载与启动缓存、BYOK 优先解析、callLlm 超时重试、streamLlm 三格式分派与 adapters。
- [双 Agent 体系总览](overview.md) - 悬停 Agent（Fast Direct）与面板 Agent（Deep Structured / ReAct tool-loop）的架构对比、SSE 事件协议、共享上下文装配与 /api/v1/agent 路由清单。
- [提示词工程与悬停净化（单一真相）](prompt-sanitize.md) - 五种提示词构造器、extractVisibleAnswer 门控、@agentforge/shared hoverSanitize 正则家族与卡片上限，前后端单一真相原则。
- [ReAct tool-loop（P0 工具循环）](tool-loop.md) - prompt-based TOOL_CALL 协议、runToolLoop 循环、白名单工具注册表、search_articles/get_article 工具与安全护栏。
