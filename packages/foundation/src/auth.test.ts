/**
 * auth 中间件单测 —— optionalAuth / requireAuth / requirePermission / requireRole。
 * 用注入式 mock JWT 校验,验证中间件的授权判定逻辑。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { optionalAuth, requireAuth, requirePermission, requireRole } from './auth.js';

vi.mock('./jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

import { verifyAccessToken } from './jwt.js';

function req(header?: string) {
  return { headers: { authorization: header }, user: undefined } as unknown as Request;
}
function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}
function next() {
  return vi.fn();
}

const TOKEN = 'valid.jwt.token';
const AUTH_HEADER = `Bearer ${TOKEN}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('optionalAuth', () => {
  it('无 Authorization → next() 且不设置 user', () => {
    const n = next();
    optionalAuth(req(), res(), n);
    expect(n).toHaveBeenCalledTimes(1);
  });

  it('有效 token → 设置 user 并 next', () => {
    vi.mocked(verifyAccessToken).mockReturnValue({
      sub: 'u1',
      email: 'a@b.c',
      role: 'reader',
      authorTier: 'none',
      adminLevel: 0,
      iat: 1,
      exp: 9999999999,
    } as never);
    const r = req(AUTH_HEADER);
    const n = next();
    optionalAuth(r, res(), n);
    expect(r.user?.id).toBe('u1');
    expect(n).toHaveBeenCalledTimes(1);
  });

  it('无效 token → 忽略,next 且 user 未设(不抛错)', () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => {
      throw new Error('invalid');
    });
    const r = req(AUTH_HEADER);
    const n = next();
    optionalAuth(r, res(), n);
    expect(r.user).toBeUndefined();
    expect(n).toHaveBeenCalledTimes(1);
  });
});

describe('requireAuth', () => {
  it('无 token → 401', () => {
    const n = next();
    requireAuth(req(), res(), n);
    expect(n).toHaveBeenCalledTimes(1);
    expect(n.mock.calls[0][0]).toMatchObject({ status: 401 });
  });

  it('有效 token → next() 无错误', () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ sub: 'u1' } as never);
    const n = next();
    requireAuth(req(AUTH_HEADER), res(), n);
    expect(n.mock.calls[0]).toEqual([]); // next() 无参
  });
});

describe('requireRole', () => {
  it('角色匹配放行;不匹配 403', () => {
    const readerReq = () => {
      const r = req(AUTH_HEADER);
      (r as { user: unknown }).user = { id: 'u1', role: 'reader' };
      return r;
    };
    const n = next();
    // reader 请求 author/admin → 403
    requireRole('author', 'admin')(readerReq(), res(), n);
    expect(n.mock.calls[0][0]).toMatchObject({ status: 403 });
    // reader 请求 reader → 放行
    const n2 = next();
    requireRole('reader')(readerReq(), res(), n2);
    expect(n2.mock.calls[0]).toEqual([]);
  });
});

describe('requirePermission', () => {
  it('有权限放行(admin 对 user.manage);reader 无权限 403', () => {
    const adminReq = () => {
      const r = req(AUTH_HEADER);
      (r as { user: unknown }).user = { id: 'u1', role: 'admin', authorTier: 'elite', adminLevel: 100 };
      return r;
    };
    const n = next();
    requirePermission('user.manage')(adminReq(), res(), n);
    expect(n.mock.calls[0]).toEqual([]);
    const readerReq = () => {
      const r = req(AUTH_HEADER);
      (r as { user: unknown }).user = { id: 'u2', role: 'reader', authorTier: 'none', adminLevel: 0 };
      return r;
    };
    const n2 = next();
    requirePermission('user.manage')(readerReq(), res(), n2);
    expect(n2.mock.calls[0][0]).toMatchObject({ status: 403 });
  });
});
