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

export function signAccessToken(payload: JwtPayload): string {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(payload, secret(), { expiresIn } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, secret());
  if (typeof decoded !== 'object' || decoded === null || !('sub' in decoded)) {
    throw new Error('无效 token');
  }
  return decoded as JwtPayload;
}
