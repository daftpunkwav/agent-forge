# 动画系统说明

## 架构

```
components/anim/
  core/
    types.ts          # VisualKind / VizNode / VizEdge / VizFrame
    buildScene.ts     # 步骤 → 场景模型
  primitives/
    layoutMath.ts     # 环/弧/曲线几何
    SceneCanvas.tsx   # SVG 渲染器（ring/chain/tree/graph/flow/dataflow/layers）
  templates/defaultSteps.ts
  AnimationViewer.tsx # 播放器 + 分发
  AnimationControls.tsx
  anim-engine.css
```

## 可视化类型 (VisualKind)

| kind | 用途 | 模板示例 |
|------|------|----------|
| ring | 环状循环 | react, loop |
| chain | 链式推理 | cot, prompting |
| tree | 树搜索 | tot |
| graph | 关系图 | got |
| flow | 流程图 | tool, harness |
| dataflow | 动态请求/响应包 | mcp |
| layers | 分层结构 | memory |

## ReAct 环

固定三相节点 **Thought → Action → Observation** 围成环：

1. `input`：中心显示 Question，环未激活  
2. 每轮 `thought` 增加 cycle，高亮 Thought + 入边流动  
3. `action` / `observation` 依次高亮  
4. `answer`：中心 Answer，环完成，退出循环  

作者步骤请使用 `type: thought | action | observation | answer`。

## 扩展新图种

1. 在 `types.ts` 增加 `VisualKind`  
2. 在 `buildScene.ts` 写 `buildXxxScene`  
3. 在 `SceneCanvas.tsx` 增加渲染分支  
4. 在 `TEMPLATE_KIND` 映射模板 id  
