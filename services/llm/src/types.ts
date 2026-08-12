/** LLM Provider 抽象 — 类型契约统一收敛于 @core/contracts(跨服务共享),此处仅 re-export 保持兼容 */
export type {
  ApiFormat,
  AgentStyle,
  ByokConfig,
  ChatMessage,
  LlmRequest,
  LlmResponse,
  ProviderConfig,
  StreamChunk,
} from '@core/contracts';
export { API_FORMATS } from '@core/contracts';
