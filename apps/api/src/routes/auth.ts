import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, verifyPassword } from '../lib/hash.js';
import { signAccessToken } from '../lib/jwt.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { toPublicUser } from '../services/serialize.js';
import type { AuthorTier, UserRole } from '@agentforge/shared';

const registerSchema = z.object({
  email: z.string().email('邮箱格式无效'),
  password: z.string().min(8, '密码至少 8 位').max(128),
  name: z.string().min(1, '请填写昵称').max(64),
});

const loginSchema = z.object({
  email: z.string().email('邮箱格式无效'),
  password: z.string().min(1, '请填写密码'),
});

const profileSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  bio: z.string().max(2000).optional(),
  headline: z.string().max(200).optional(),
  website: z.string().max(300).optional(),
  avatarUrl: z.string().max(500).optional(),
  allowAgentAnnotationReview: z.boolean().optional(),
});

function tokenFor(user: {
  id: string;
  email: string;
  role: string;
  authorTier: string;
  adminLevel: number;
}) {
  return signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role as UserRole,
    authorTier: (user.authorTier as AuthorTier) || 'none',
    adminLevel: user.adminLevel ?? 0,
  });
}

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const { email, password, name } = req.body as z.infer<typeof registerSchema>;
    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) {
      throw conflict('该邮箱已注册');
    }
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        role: 'reader',
        authorTier: 'none',
        adminLevel: 0,
      },
    });
    res.status(201).json({ accessToken: tokenFor(user), user: toPublicUser(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      throw unauthorized('邮箱或密码错误');
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw unauthorized('邮箱或密码错误');
    }
    res.json({ accessToken: tokenFor(user), user: toPublicUser(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw unauthorized();
    res.json({ user: toPublicUser(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.patch('/me', requireAuth, validate(profileSchema), async (req, res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const body = req.body as z.infer<typeof profileSchema>;
    const data: Record<string, unknown> = {};
    if (body.name != null) data.name = body.name;
    if (body.bio != null) data.bio = body.bio;
    if (body.headline != null) data.headline = body.headline;
    if (body.website != null) data.website = body.website;
    if (body.avatarUrl != null) data.avatarUrl = body.avatarUrl;
    if (body.allowAgentAnnotationReview != null) {
      data.allowAgentAnnotationReview = body.allowAgentAnnotationReview;
    }
    if (!Object.keys(data).length) throw badRequest('无更新字段');
    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    res.json({ user: toPublicUser(user), accessToken: tokenFor(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', requireAuth, (_req, res) => {
  res.json({ ok: true });
});
