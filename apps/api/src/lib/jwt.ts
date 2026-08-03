import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AuthorTier, UserRole } from '@agentforge/shared';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  authorTier?: AuthorTier;
  adminLevel?: number;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET 未配置或过短（至少 16 字符）');
  }
  return s;
}

/** 解析 `15m` / `7d` 等时长为毫秒；非法则抛错 */
export function parseDurationMs(raw: string): number {
  const m = /^(\d+)([smhd])$/i.exec(raw.trim());
  if (!m) {
    throw new Error(`无效过期时长: ${raw}`);
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return n * mult[unit]!;
}

export function signAccessToken(payload: JwtPayload): string {
  // 短时 access：优先 JWT_ACCESS_EXPIRES_IN；兼容旧 JWT_EXPIRES_IN；默认 15m
  const expiresIn =
    process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m';
  return jwt.sign(payload, secret(), { expiresIn } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, secret());
  if (typeof decoded !== 'object' || decoded === null || !('sub' in decoded)) {
    throw new Error('无效 token');
  }
  return decoded as JwtPayload;
}

/** 生成高熵 refresh 明文（仅下发客户端一次） */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** refresh 明文 → sha256 hex，入库用 */
export function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** refresh 过期时刻（默认 7d） */
export function refreshExpiresAt(now = Date.now()): Date {
  const raw = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  return new Date(now + parseDurationMs(raw));
}
