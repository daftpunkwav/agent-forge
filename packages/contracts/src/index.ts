/** 共享契约(品牌中立)——对外唯一入口 */
// 悬停净化(行为,被 web 与 agent 共同消费)
export {
  HOVER_CARD_MAX_SENTENCES,
  HOVER_CARD_MAX_CHARS,
  stripSelfRevisionDraft,
  isLikelyHoverTeaching,
  finalizeHoverCardText,
  progressiveHoverAnswer,
  extractHoverAnswer,
  isCompleteHoverAnswer,
  looksLikeHoverPlanning,
  isSystemEcho,
  isSafeHoverPublicAnswer,
  sanitizeHoverDisplay,
  // 前端别名
  stripSelfRevisionClient,
  isSafeHoverDisplay,
  isLikelyHoverTeachingClient,
} from './hoverSanitize.js';

// 权限矩阵
export type { UserRole, AuthorTier, RuntimeIdentity, Permission, Principal } from './permissions.js';
export { can, isAuthorLike, isAdminLike, roleLabel } from './permissions.js';

// 领域 DTO / LLM 类型 / 端口契约(按 concern 拆子文件,此处聚合)
export * from './dto.js';
export * from './llm-types.js';
export * from './ports.js';
