/**
 * LLM 参数单一真相来源（C-03）。
 * - 调用方（agent.ts / settings.ts）从本表取值显式传入 maxTokens/temperature；
 * - providers.ts 内部仅保留「调用方未传参时」的防御性兜底，不再按 mode 自行猜测。
 */
export const LLM_TOKEN_LIMITS = {
  /** 悬停快讲：短、直给 */
  hover: { maxTokens: 220, temperature: 0.15 },
  /** 悬停空答案时的极简兜底重试（无记忆、关 thinking） */
  hoverRetry: { maxTokens: 220, temperature: 0.1 },
  /** 面板快答（chat fast） */
  chatFast: { maxTokens: 600, temperature: 0.3 },
  /** 面板/详情深度讲解（chat deep / click deep） */
  chatDeep: { maxTokens: 2048, temperature: 0.55 },
  /** 选中片段深度讲解（click deep） */
  clickDeep: { maxTokens: 2048, temperature: 0.55 },
} as const;

/** 同步 LLM 调用超时（A-02）：上游挂起不拖垮连接 */
export const LLM_CALL_TIMEOUT_MS = 30_000;

/** hover 兜底重试的短超时：它是次要路径，不应与主请求一样久 */
export const HOVER_RETRY_TIMEOUT_MS = 12_000;

/** 同步调用对 5xx/网络错误的单次重试退避（B-05） */
export const LLM_RETRY_BACKOFF_MS = 500;

/** ReAct tool-loop 最大迭代次数（可用 TOOL_LOOP_MAX_ITERS 覆盖） */
export const TOOL_LOOP_MAX_ITERS = Math.max(
  1,
  Math.min(20, parseInt(process.env.TOOL_LOOP_MAX_ITERS || '5', 10) || 5),
);

/** 单次工具执行超时（毫秒） */
export const TOOL_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.TOOL_TIMEOUT_MS || '8000', 10) || 8000,
);
