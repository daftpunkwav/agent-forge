import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth.js';
import { forbidden, notFound } from '../lib/errors.js';
import { toAnimationDef } from '../services/serialize.js';
import { param } from '../lib/params.js';

const stepSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  desc: z.string().optional(),
  type: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  template: z.string().min(1),
  steps: z.array(stepSchema).min(1),
  config: z.record(z.unknown()).optional(),
});

const updateSchema = createSchema.partial();

export const animationsRouter = Router();

animationsRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const where =
      mine && req.user
        ? { authorId: req.user.id }
        : req.user?.role === 'admin'
          ? {}
          : req.user
            ? { authorId: req.user.id }
            : { authorId: '__none__' };

    const items = await prisma.animationDef.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ items: items.map(toAnimationDef) });
  } catch (e) {
    next(e);
  }
});

animationsRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const item = await prisma.animationDef.findUnique({ where: { id: param(req, 'id') } });
    if (!item) throw notFound('动画不存在');
    res.json({ animation: toAnimationDef(item) });
  } catch (e) {
    next(e);
  }
});

animationsRouter.post(
  '/',
  requireAuth,
  requireRole('author', 'admin'),
  validate(createSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createSchema>;
      const item = await prisma.animationDef.create({
        data: {
          name: body.name,
          template: body.template,
          steps: JSON.stringify(body.steps),
          config: JSON.stringify(body.config || {}),
          authorId: req.user!.id,
        },
      });
      res.status(201).json({ animation: toAnimationDef(item) });
    } catch (e) {
      next(e);
    }
  },
);

animationsRouter.patch(
  '/:id',
  requireAuth,
  requireRole('author', 'admin'),
  validate(updateSchema),
  async (req, res, next) => {
    try {
      const existing = await prisma.animationDef.findUnique({ where: { id: param(req, 'id') } });
      if (!existing) throw notFound('动画不存在');
      if (existing.authorId !== req.user!.id && req.user!.role !== 'admin') {
        throw forbidden();
      }
      const body = req.body as z.infer<typeof updateSchema>;
      const item = await prisma.animationDef.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          template: body.template,
          steps: body.steps ? JSON.stringify(body.steps) : undefined,
          config: body.config ? JSON.stringify(body.config) : undefined,
        },
      });
      res.json({ animation: toAnimationDef(item) });
    } catch (e) {
      next(e);
    }
  },
);
