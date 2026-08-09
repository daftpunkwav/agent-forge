---
type: 前端功能
title: 动画引擎（模板 → 场景 → SVG 渲染）
description: AnimationViewer/useAnimationPlayer 播放器、registry 模板映射、buildScene 八种场景生成、SceneCanvas SVG 渲染与新增模板配方。
tags: [frontend, animation, svg, scenes]
---

# 动画引擎

可分步参数化动画（非自由画布）：作者用模板 + 步骤参数定义动画，读者端 `AnimationViewer` 按 `stepIndex → 帧` 播放。权威说明见 `docs/animation-system.md`。代码在 `apps/web/src/components/anim/`（core / primitives / templates / registry）。

## 数据流

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart LR
    A["AnimationDef {template, steps[]}"] --> R["registry.ts<br/>TEMPLATE_VISUAL_KIND + ALIASES"]
    R --> B["buildScene.ts<br/>buildSceneFromSteps"]
    B --> C["SceneModel {kind, nodes, edges, frames[]}"]
    C --> D["AnimationViewer + useAnimationPlayer"]
    D --> E["SceneCanvas（SVG 帧渲染）"]
    D --> F["AnimationControls（播放条）"]
```

## 模板 → 视觉种类（registry.ts）

| 模板（shared `AnimationTemplate`） | VisualKind |
|-----------------------------------|-----------|
| react / loop | ring（环状循环） |
| cot | chain（链式） |
| tot | tree（树状搜索） |
| got | graph（关系图） |
| mcp | dataflow（请求/响应数据流） |
| tool / harness | flow（流程图） |
| memory | layers（分层图） |
| （历史别名 `TEMPLATE_KIND_ALIASES`：prompting / llm-basics / transformers / tokenization / fine-tuning / prompt-eng） | chain（兼容映射） |
| （历史别名：evaluation / frameworks-langchain / frameworks-autogen / frameworks-crewai） | flow（兼容映射） |
| 未知 / 空 | timeline（时间线回退） |

- `resolveVisualKind(template)` / `resolveDefaultSteps(template)`（缺省回退 react）。
- `DEFAULT_STEPS`（templates/defaultSteps.ts）：9 个模板各带语义化 type（input/thought/action/observation/answer、sense/plan/act/observe、branch/eval 等），ReAct 默认 9 步两轮循环。
- `VISUAL_KIND_DOCS`：作者端可视化类型说明。

## buildScene（core/buildScene.ts）

纯函数 `steps × template → SceneModel`（nodes/edges/frames 1:1 于 steps）。帧字段：`activeNodeIds/activeEdgeIds/doneNodeIds/doneEdgeIds/pathNodeIds`、`packet {edgeId, t}`（流动粒子）、`centerTitle/centerSubtitle`、`cycle/maxCycles`、`finished`、`caption`、`logLine`。各场景要点：

- **ring**（ReAct/loop）：固定节点环；`maxCycles` = thought/action/sense/act 步数；cycle 在 thought/sense 步递增；input/answer 清 active；answer/stop → finished（全 done、清 active）；packet 沿环边 0.55。
- **chain**（CoT/默认）：节点线性排布，帧推进 active/done + packet；`pathNodeIds` 累计。
- **tree**（ToT）：固定 6 节点（root、分支 A/B/C、eval、best）；branch 步按 a→b→c 轮转；eval 高亮三分支；expand 走 b 路径；answer 到 best。
- **graph**（GoT）：固定 6 节点 6 边；progressive 6 帧（`Math.min(i,5)` 钳制）；packet 在末边。
- **flow**（tool/harness）：节点 zigzag 布局、交替曲线边；帧推进同 chain。
- **dataflow**（MCP）：client/server 双盒 + req（直边）/res（曲边）两条泳道；帧方向按角色（result/resource → res）；packet 沿 x 插值 + 弧线凸起。
- **layers**（memory）：5 层短/工作/长/检索/注入纵向堆叠；帧按角色映射层（`role.includes(id)`），fallback `Math.min(i,4)`。

## 渲染（primitives/SceneCanvas.tsx）

- `W=720 H=360` viewBox；CSS 变量 `--edge-color/--node-color` + `roleColor(role)`（ROLE_COLORS 20+ 角色）；箭头 marker；ring 径向光晕。
- 帧分派：RingCanvas / DataflowCanvas / LayersCanvas / GraphCanvas（tree/graph）/ FlowCanvas（chain/flow/timeline）。
- 节点/边带 `data-agent-term/text/topic/hint`（悬停讲解目标，见 [Agent UI](./agent-ui.md)）；active 脉冲、done 用 color-mix 降饱和、finished 换 chart-3 描边。
- 粒子：`PacketOnArc`（环，角度插值 + 增量归正）、`PacketOnEdge`（直线线性插值）、dataflow 手动 lerp + `±12*sin(t*π)` 弧。
- `SceneStage`：帧 + caption + `viz-log` 执行轨迹（`aria-label="执行轨迹"`，stepIndex 前后区分 active/done）。
- `layoutMath.ts`：`pt`（归一化→像素）、`ringPoint`、`curvePath`（二次贝塞尔 + 垂直偏移）、`arcPath`（增量归 (0,2π]、large-arc/sweep）、`pointOnLine`。

## 播放器

- `useAnimationPlayer({totalSteps, autoPlayDelay=1800, loop})`：play/pause/toggle/step/stepBack/reset/goTo/setSpeed（0.5–2x）；ref 同步防闭包过期；totalSteps 变化重置到起点。
- `AnimationViewer`：`buildSceneFromSteps` memo → `frame = frames[currentStep]`；header 显示 `template · kind`、CYCLE n/max、COMPLETE；`TemplateAnimation({template})` 供无嵌入动画的兜底（fallbackTemplate 或未知 id）。
- `AnimationControls`：↺ ‹ ▶/❚❚ › + 步数 + 速度选择。

## 文章嵌入

- 语法：`:::animation{id="..."}:::` 围栏（shared `ANIMATION_FENCE`）。
- `ArticleBody`：`splitMarkdownWithAnimations` 拆分 → `animMap` 按 id 查动画 → 未知 id 回退 `TemplateAnimation(template=id)`；无嵌入且有 `fallbackTemplate`（ArticlePage 的 `SLUG_TEMPLATE` 按 slug 映射种子模板）则前置渲染。

## 新增动画模板配方

1. `packages/shared` `AnimationTemplate` 联合类型 + `ANIMATION_TEMPLATES`（id/label/desc）→ 2. `templates/defaultSteps.ts` 加 `DEFAULT_STEPS[template]` → 3. `registry.ts` `TEMPLATE_VISUAL_KIND` 加映射 → 4. 若需新视觉 → `core/types.ts` VisualKind + `buildScene.ts` 场景构建器 + `SceneCanvas.tsx` 帧渲染（详见 `docs/animation-system.md` 的四步检查清单）。两端需重建 shared。

## 相关页面

- 作者端编辑页：[页面清单](./pages.md)（AnimationEditorPage）
- 嵌入渲染：[Markdown 管线](./markdown-pipeline.md)
- shared 常量：[packages/shared](../packages/shared.md)
