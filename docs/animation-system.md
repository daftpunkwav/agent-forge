# 动画系统说明

> 最后核对：2026-08-03

## 架构

```
components/anim/
  core/
    types.ts          # VisualKind / VizNode / VizEdge / VizFrame / SceneModel
    buildScene.ts     # 步骤 → 场景模型（TEMPLATE_KIND 映射）
  primitives/
    layoutMath.ts     # 环/弧/曲线几何
    SceneCanvas.tsx   # SVG 渲染器
  templates/defaultSteps.ts
  AnimationViewer.tsx # 播放器 + 分发
  AnimationControls.tsx
  anim-engine.css
```

播放控制：`hooks/useAnimationPlayer.ts`（play / pause / step / stepBack / reset / speed）。

作者可选模板（写入 `AnimationDef.template`）以 `packages/shared` 的 `AnimationTemplate` / `ANIMATION_TEMPLATES` 为准（当前：`react | cot | tot | got | loop | mcp | tool | memory | harness`）。种子文章还可使用额外 template id（如 `frameworks-*`、`llm-basics`），由 `TEMPLATE_KIND` 映射到对应 `VisualKind`。

## 可视化类型 (VisualKind)

定义在 `apps/web/src/components/anim/core/types.ts`：

| kind | 用途 | 模板示例 |
|------|------|----------|
| ring | 环状循环 | react, loop |
| chain | 链式推理 | cot, prompting, llm-basics, transformers, tokenization, fine-tuning, prompt-eng |
| tree | 树搜索 | tot |
| graph | 关系图 | got |
| flow | 流程图 | tool, harness, evaluation, frameworks-langchain/autogen/crewai |
| dataflow | 动态请求/响应包 | mcp |
| layers | 分层结构 | memory |
| timeline | 通用时间线（兜底） | 未匹配任何模板时 |

映射：`buildScene.ts` 的 `TEMPLATE_KIND`；未识别 → `timeline`。

## ReAct 环

固定三相节点 **Thought → Action → Observation** 围成环：

1. `input`：中心 Question，环未激活  
2. 每轮 `thought` 增加 cycle，高亮 Thought + 入边流动  
3. `action` / `observation` 依次高亮  
4. `answer`：中心 Answer，环完成  

作者步骤请使用 `type: thought | action | observation | answer`（及模板约定的其它 type）。

## Markdown 嵌入

文章正文使用围栏语法（常量 `ANIMATION_FENCE` = `:::animation`）：

```markdown
:::animation{id="<AnimationDef.id>"}
:::
```

渲染时替换为 `AnimationViewer`。

## 扩展新图种

1. 在 `types.ts` 增加 `VisualKind`  
2. 在 `buildScene.ts` 写 `buildXxxScene` 并加入 `TEMPLATE_KIND`  
3. 在 `SceneCanvas.tsx` 增加渲染分支  
4. 若需出现在作者编辑器下拉，同步扩展 `packages/shared` 的 `AnimationTemplate` 与 `ANIMATION_TEMPLATES`
