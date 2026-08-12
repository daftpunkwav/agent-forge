/**
 * LLM 网关(llm 服务)超时/重试常量。
 * 调用参数预算(LLM_TOKEN_LIMITS)收敛于 @core/contracts,此处 re-export 保持兼容；
 * tool-loop / hover 重试超时属 agent 服务职责(见 services/agent/src/lib/agentConstants.ts)。
 */
import { LLM_TOKEN_LIMITS } from '@core/contracts';

export { LLM_TOKEN_LIMITS };

/** 同步 LLM 调用超时（A-02）：上游挂起不拖垮连接 */
export const LLM_CALL_TIMEOUT_MS = 30_000;

/** 同步调用对 5xx/网络错误的单次重试退避（B-05） */
export const LLM_RETRY_BACKOFF_MS = 500;
