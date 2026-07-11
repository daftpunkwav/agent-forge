# AgentForge — Agent学习平台 实施计划

## 项目概述

**项目名称：** AgentForge（Agent锻造坊）

**目标：** 构建一个精美的交互式Agent/AI学习平台，以动画可视化抽象Agent概念，配合系统化文章，帮助开发者从零到一掌握Agent开发。

**设计参考：** `D:\daftpunkwav\04-MyProjects\Blogs\GaoKaiBlog` — Shell-based布局、CSS变量主题系统、Tailwind CDN、Lucide图标、暖色品牌色。

---

## 当前进度

### 已完成 ✅

| 模块 | 状态 | 说明 |
|------|------|------|
| 项目基础结构 | ✅ | 目录、Git仓库、基础文件 |
| 样式系统 | ✅ | theme-vars.css + components.css + animations.css |
| 动画播放器核心 | ✅ | AnimationPlayer类（play/pause/step/reset/speed） |
| 6个动画组件 | ✅ | react-viz, cot-viz, tot-viz, got-viz, loop-viz, mcp-viz |
| 动画控件 | ✅ | animation-controls.js（播放栏UI） |
| SPA路由系统 | ✅ | hash路由 + 页面过渡动画 |
| 主题管理 | ✅ | ThemeManager（light/dark + localStorage） |
| TOC系统 | ✅ | 自动生成目录 + IntersectionObserver滚动监听 |
| 17个页面文件 | ✅ | 见下方已创建列表 |

### 已完成页面文件 ✅

```
pages/home.html
pages/knowledge/react.html
pages/knowledge/cot.html
pages/knowledge/got.html
pages/knowledge/tot.html
pages/knowledge/mcp.html
pages/knowledge/context.html
pages/knowledge/memory.html
pages/knowledge/evaluation.html
pages/knowledge/tool-use.html
pages/knowledge/prompt-eng.html
pages/knowledge/frameworks/langchain.html
pages/knowledge/frameworks/autogen.html
pages/knowledge/frameworks/crewai.html
pages/llm/basics.html
pages/llm/transformers.html
components/article-layout.html
```

### 待完成 🔲

| 模块 | 状态 | 说明 |
|------|------|------|
| 知识总览页 | 🔲 | pages/knowledge/overview.html |
| 新闻资讯页 | 🔲 | pages/news.html |
| 登录页 | 🔲 | pages/login.html |
| 注册页 | 🔲 | pages/register.html |
| 设置页 | 🔲 | pages/settings.html |
| 个人主页 | 🔲 | pages/profile.html |
| LLM文章：分词 | 🔲 | pages/llm/tokenization.html |
| LLM文章：微调 | 🔲 | pages/llm/fine-tuning.html |
| LLM文章：Prompting | 🔲 | pages/llm/prompting.html |
| Agent浮动按钮组件 | 🔲 | components/agent-float-btn.html |
| 代码块组件 | 🔲 | components/code-block.html |
| 标签组件 | 🔲 | components/tag-pill.html |
| 后端API | 🔲 | Phase 2 — Node.js + Express + Prisma |
| Agent集成 | 🔲 | Phase 3 — 对话面板、记忆系统、BYOK |

---

## 核心架构

### SPA路由

```
#/                    → 主页
#/login               → 登录
#/register            → 注册
#/settings            → 设置
#/profile             → 个人主页
#/knowledge           → Agent知识总览
#/knowledge/react     → ReAct模式
#/knowledge/cot       → CoT思维链
#/knowledge/got       → GoT图谱思维
#/knowledge/tot       → ToT思维树
#/knowledge/mcp       → MCP协议
#/knowledge/context   → 上下文管理
#/knowledge/memory    → 记忆系统
#/knowledge/evaluation → 评估系统
#/knowledge/tool-use  → 工具调用
#/knowledge/prompt-eng → Prompt工程
#/knowledge/frameworks/langchain → LangChain
#/knowledge/frameworks/autogen  → AutoGen
#/knowledge/frameworks/crewai   → CrewAI
#/llm/basics          → LLM基础
#/llm/transformers    → Transformer架构
#/llm/tokenization    → 分词与Token
#/llm/fine-tuning     → 微调
#/llm/prompting       → Prompting技术
#/news                → 前沿资讯
```

### 主题系统

- CSS自定义属性（`:root` light / `.dark` dark）
- `ThemeManager` 类管理切换 + localStorage持久化
- 品牌色：#f1481e（暖橙）

### 动画系统

- `AnimationPlayer` 核心类：play/pause/step/stepBack/reset/goTo/setSpeed
- 6个领域可视化动画
- `AnimationControls` UI控件栏

### 文章布局

```
┌──────────────────────────────────────────────┐
│  Header (壳层提供)                            │
├────────┬─────────────────────────────────────┤
│  TOC   │  标签 + 标题 + 元信息               │
│  目录   │  动画容器 + 控件                    │
│        │  正文内容（h2/h3/p/blockquote）     │
│        │  代码块                             │
│        │  延伸阅读                           │
├────────┴─────────────────────────────────────┤
│  Footer (壳层提供)                            │
└──────────────────────────────────────────────┘
```

---

## 执行规则

### 上下文管理

- **当上下文窗口达到80%时，必须执行 `/compact` 进行主动压缩**
- 压缩后继续从当前任务恢复，不重新规划
- 每次恢复后读取本plan文档确认进度

### Git提交规则

- **完成每个有意义的功能模块后，立即执行 `git add` + `git commit`**
- Commit信息格式：`feat: 模块描述` 或 `fix: 问题描述`
- **禁止推送远端**（`git push` 永远不执行）
- 提交粒度：每创建3-5个页面文件或完成一个功能模块提交一次

### 实施顺序

1. 创建plan文档 ✅（当前步骤）
2. 创建剩余页面（overview/news/login/register/settings/profile/LLM文章）
3. 创建组件文件（agent-float-btn/code-block/tag-pill）
4. 验证路由和页面跳转
5. 最终commit
6. Phase 2：后端API（Node.js + Express + Prisma）

---

## Phase 2 后端架构（规划中）

```
api/
├── server.js                    # Express入口
├── routes/
│   ├── auth.js                  # 注册/登录/JWT
│   ├── users.js                 # 用户管理
│   ├── articles.js              # 文章管理
│   ├── agent.js                 # Agent对话接口（预留）
│   └── news.js                  # 资讯接口
├── middleware/
│   ├── auth.js                  # JWT认证中间件
│   └── rate-limit.js           # 速率限制
├── models/
│   ├── User.js
│   ├── Article.js
│   ├── Comment.js
│   ├── News.js
│   └── AgentMemory.js
└── prisma/
    └── schema.prisma            # 数据库Schema
```

## Phase 3 Agent集成（规划中）

- Agent对话面板UI
- 悬停快速介绍系统
- 用户记忆系统
- BYOK（用户自带API Key）
- 上下文系统（hover: 最快速度 / click: 中等速度高准确度）
