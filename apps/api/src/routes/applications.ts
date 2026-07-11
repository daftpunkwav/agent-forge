import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { param } from '../lib/params.js';

const applySchema = z.object({
  field: z.string().min(1).max(120),
  bio: z.string().min(10, '请至少写 10 字自我介绍').max(2000),
});

export const applicationsRouter = Router();

applicationsRouter.post('/', requireAuth, validate(applySchema), async (req, res, next) => {
  try {
    if (req.user!.role === 'author' || req.user!.role === 'admin') {
      throw badRequest('你已经是作者或管理员');
    }
    const pending = await prisma.authorApplication.findFirst({
      where: { userId: req.user!.id, status: 'pending' },
    });
    if (pending) throw conflict('你已有待审核的申请');

    const body = req.body as z.infer<typeof applySchema>;
    const app = await prisma.authorApplication.create({
      data: {
        userId: req.user!.id,
        field: body.field,
        bio: body.bio,
      },
    });
    res.status(201).json({ application: app });
  } catch (e) {
    next(e);
  }
});

applicationsRouter.get(
  '/',
  requireAuth,
  requireRole('admin'),
  async (_req, res, next) => {
    try {
      const items = await prisma.authorApplication.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, name: true, role: true } } },
      });
      res.json({ items });
    } catch (e) {
      next(e);
    }
  },
);

applicationsRouter.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  validate(
    z.object({
      status: z.enum(['approved', 'rejected']),
    }),
  ),
  async (req, res, next) => {
    try {
      const existing = await prisma.authorApplication.findUnique({
        where: { id: param(req, 'id') },
      });
      if (!existing) throw notFound('申请不存在');
      if (existing.status !== 'pending') {
        throw badRequest('该申请已处理');
      }
      const { status } = req.body as { status: 'approved' | 'rejected' };

      const app = await prisma.$transaction(async (tx) => {
        const updated = await tx.authorApplication.update({
          where: { id: existing.id },
          data: { status, reviewedAt: new Date() },
        });
        if (status === 'approved') {
          await tx.user.update({
            where: { id: existing.userId },
            data: { role: 'author' },
          });
        }
        return updated;
      });
      res.json({ application: app });
    } catch (e) {
      next(e);
    }
  },
);
