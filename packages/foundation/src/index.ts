/** @core/foundation —— 纯基础设施(无业务契约)。各服务与宿主的共享库。 */

export { AppError, badRequest, unauthorized, forbidden, notFound, conflict } from './errors.js';
export { logger } from './logger.js';
export { hashPassword, verifyPassword } from './hash.js';
export {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshExpiresAt,
  parseDurationMs,
} from './jwt.js';
export type { JwtPayload } from './jwt.js';
export { param } from './params.js';
export { parsePrefs } from './prefs.js';
export {
  initSse,
  sseWrite,
  startSseHeartbeat,
  createSseSession,
  endSseSession,
  softStreamHoverAnswer,
} from './sse.js';
export type { SseSession } from './sse.js';
export {
  isEncryptedByokKey,
  encryptByokKey,
  decryptByokKey,
  decryptByokConfig,
  resolveByokApiKeyToStore,
} from './byokCrypto.js';
export { assertSafeByokBaseUrl, isSafeByokBaseUrl, isPrivateOrSpecialIpv4 } from './byokUrlPolicy.js';
export { extractVisibleAnswer } from './llmAnswerExtract.js';

// HTTP 中间件与请求校验
export { validate } from './validate.js';
export {
  optionalAuth,
  requireAuth,
  requireRole,
  requirePermission,
  requireAdminLevel,
} from './auth.js';
export type { AuthUser } from './auth.js';
export { errorHandler } from './errorHandler.js';
