import type { RequestHandler } from 'express';
import type { AuthorTier, Permission, UserRole } from '@agentforge/shared';
import { can } from '@agentforge/shared';
import { verifyAccessToken } from '../lib/jwt.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  authorTier: AuthorTier;
  adminLevel: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function fromPayload(payload: ReturnType<typeof verifyAccessToken>): AuthUser {
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    authorTier: payload.authorTier || (payload.role === 'author' ? 'standard' : 'none'),
    adminLevel: payload.adminLevel ?? (payload.role === 'admin' ? 1 : 0),
  };
}

export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  try {
    req.user = fromPayload(verifyAccessToken(header.slice(7)));
  } catch {
    // 忽略无效 token
  }
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized());
    return;
  }
  try {
    req.user = fromPayload(verifyAccessToken(header.slice(7)));
    next();
  } catch {
    next(unauthorized());
  }
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}

export function requirePermission(...perms: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    const principal = {
      role: req.user.role,
      authorTier: req.user.authorTier,
      adminLevel: req.user.adminLevel,
    };
    const ok = perms.every((p) => can(principal, p));
    if (!ok) {
      next(forbidden('权限不足'));
      return;
    }
    next();
  };
}

export function requireAdminLevel(min: number): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (req.user.role !== 'admin' || (req.user.adminLevel ?? 0) < min) {
      next(forbidden('管理员级别不足'));
      return;
    }
    next();
  };
}
