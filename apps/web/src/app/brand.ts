/**
 * 品牌唯一入口 —— 全仓唯一允许出现产品名的地方。
 * 中性源码约定:除本文件外,业务代码不得硬编码任何品牌名。
 * 未来改名只需改此文件(及 index.html 注入源)。
 */
export const BRAND = {
  /** 产品名(站点标题/导航/页脚) */
  name: 'Grimoire',
  /** 标语/副标题 */
  tagline: '交互式 Agent / LLM 学习平台',
  /** SEO title 模板 */
  title: 'Grimoire — 交互式 Agent / LLM 学习平台',
  /** SEO description */
  description: 'Grimoire —— 高质量 Agent / LLM 教程,富文本长文与可分步动画,悬停即问 Agent 讲解。',
  /** 页脚版权 */
  footer: 'Grimoire 2026 · 持续迭代中',
} as const;
