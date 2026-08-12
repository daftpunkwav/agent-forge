/**
 * 动画模板登记表：template → VisualKind 的单一入口。
 * 新增模板时：1) shared AnimationTemplate 2) DEFAULT_STEPS 3) 本表 VISUAL_KIND。
 */
import type { AnimationStep, AnimationTemplate } from '@core/contracts';
import { ANIMATION_TEMPLATES } from '@core/contracts';
import type { VisualKind } from './core/types';
import { DEFAULT_STEPS } from './templates/defaultSteps';

/** 正式模板 → 视觉种类 */
export const TEMPLATE_VISUAL_KIND: Record<AnimationTemplate, VisualKind> = {
  react: 'ring',
  loop: 'ring',
  cot: 'chain',
  tot: 'tree',
  got: 'graph',
  mcp: 'dataflow',
  tool: 'flow',
  harness: 'flow',
  memory: 'layers',
};

/**
 * 种子 / 历史别名（超出 AnimationTemplate 联合类型）。
 * 仅用于已发布内容兼容，新内容应使用正式模板 id。
 */
export const TEMPLATE_KIND_ALIASES: Record<string, VisualKind> = {
  prompting: 'chain',
  'llm-basics': 'chain',
  transformers: 'chain',
  tokenization: 'chain',
  'fine-tuning': 'chain',
  'prompt-eng': 'chain',
  evaluation: 'flow',
  'frameworks-langchain': 'flow',
  'frameworks-autogen': 'flow',
  'frameworks-crewai': 'flow',
};

export function resolveVisualKind(template?: string): VisualKind {
  if (!template) return 'timeline';
  if (Object.prototype.hasOwnProperty.call(TEMPLATE_VISUAL_KIND, template)) {
    return TEMPLATE_VISUAL_KIND[template as AnimationTemplate];
  }
  return TEMPLATE_KIND_ALIASES[template] || 'timeline';
}

export function resolveDefaultSteps(template?: string): AnimationStep[] {
  if (template && Object.prototype.hasOwnProperty.call(DEFAULT_STEPS, template)) {
    return DEFAULT_STEPS[template as AnimationTemplate];
  }
  return DEFAULT_STEPS.react;
}

/** 编辑器下拉：正式模板列表（来自 shared） */
export { ANIMATION_TEMPLATES, DEFAULT_STEPS };
