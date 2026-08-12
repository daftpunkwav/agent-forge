/**
 * Agent 服务进程级常量：tool-loop 与 hover 兜底重试的超时/迭代预算。
 * 与 LLM 网关(llm 服务)无关,故不放 llm/config；LLM_TOKEN_LIMITS 在 @core/contracts。
 */

/** hover 兜底重试的短超时：它是次要路径，不应与主请求一样久 */
export const HOVER_RETRY_TIMEOUT_MS = 12_000;

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

/** ReAct tool-loop 整体时限（R-08）：须小于前端 tools 模式超时 90s，留出 final 余量 */
export const TOOL_LOOP_OVERALL_MS = Math.max(
  5000,
  parseInt(process.env.TOOL_LOOP_OVERALL_MS || '75000', 10) || 75000,
);
