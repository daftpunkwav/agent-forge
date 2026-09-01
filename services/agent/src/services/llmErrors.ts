import { logger, AppError } from '@core/foundation';
import type { LlmGatewayPort } from '@core/contracts';

/** LLM 调用错误映射为客户端安全 AppError */
export function mapLlmError(llm: Pick<LlmGatewayPort, 'isLlmCallError'>, err: unknown): AppError {
  if (err instanceof AppError) return err;
  const info = llm.isLlmCallError(err) ? err : null;
  if (info) {
    logger.error({ err: info.diagnostic, status: info.status }, 'LLM call failed');
    return new AppError(502, 'LLM_ERROR', info.messageForClient);
  }
  logger.error(
    {
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { raw: String(err) },
    },
    'LLM call failed',
  );
  return new AppError(502, 'LLM_ERROR', '模型调用失败，请稍后重试');
}

export function noProviderError(): AppError {
  return new AppError(
    400,
    'NO_PROVIDER',
    '未配置模型：请登录后在「设置 → BYOK」填写 Base URL、API Key、模型与 API 格式。',
  );
}
