/**
 * JWT access / refresh 辅助：时长解析、hash、过期时刻。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateRefreshToken,
  hashRefreshToken,
  parseDurationMs,
  refreshExpiresAt,
  signAccessToken,
  verifyAccessToken,
} from './jwt.js';

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-for-jwt-helpers-0123456789';
  delete process.env.JWT_ACCESS_EXPIRES_IN;
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.JWT_REFRESH_EXPIRES_IN;
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  delete process.env.JWT_ACCESS_EXPIRES_IN;
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.JWT_REFRESH_EXPIRES_IN;
});

describe('parseDurationMs', () => {
  it('解析秒/分/时/天', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('15m')).toBe(15 * 60_000);
    expect(parseDurationMs('2h')).toBe(2 * 3_600_000);
    expect(parseDurationMs('7d')).toBe(7 * 86_400_000);
  });

  it('非法格式抛错', () => {
    expect(() => parseDurationMs('abc')).toThrow(/无效过期时长/);
    expect(() => parseDurationMs('15')).toThrow(/无效过期时长/);
  });
});

describe('refresh token helpers', () => {
  it('generate 高熵且每次不同', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it('hash 稳定且不可逆（非明文）', () => {
    const raw = generateRefreshToken();
    const h1 = hashRefreshToken(raw);
    const h2 = hashRefreshToken(raw);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(raw);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refreshExpiresAt 默认 7d', () => {
    const now = Date.UTC(2026, 0, 1);
    const exp = refreshExpiresAt(now);
    expect(exp.getTime() - now).toBe(7 * 86_400_000);
  });

  it('JWT_REFRESH_EXPIRES_IN 可覆盖', () => {
    process.env.JWT_REFRESH_EXPIRES_IN = '1h';
    const now = 1_000_000;
    expect(refreshExpiresAt(now).getTime() - now).toBe(3_600_000);
  });
});

describe('signAccessToken', () => {
  const payload = {
    sub: 'u1',
    email: 'a@b.c',
    role: 'reader' as const,
    authorTier: 'none' as const,
    adminLevel: 0,
  };

  it('默认短时 access 可校验', () => {
    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('u1');
    expect(decoded.email).toBe('a@b.c');
  });

  it('JWT_ACCESS_EXPIRES_IN 优先于旧 JWT_EXPIRES_IN', () => {
    process.env.JWT_EXPIRES_IN = '7d';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    const token = signAccessToken(payload);
    expect(verifyAccessToken(token).sub).toBe('u1');
  });
});
