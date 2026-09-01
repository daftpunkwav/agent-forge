import { Router } from 'express';
import { z } from 'zod';
import { validate, requireAuth, requirePermission, requireRole, badRequest, conflict, param } from '@core/foundation';
import type { PrismaClient } from '@prisma/client';
import { applyApplicationDecision } from '../services/applicationReview.js';

const applySchema = z.object({
  field: z.string().min(1).max(120),
  bio: z.string().min(10, '请至少写 10 字自我介绍').max(2000),
  kind: z.enum(['author', 'elite']).optional(),
});

export function createApplicationsRouter(prisma: PrismaClient): Router {
  const applicationsRouter = Router();

  applicationsRouter.post('/', requireAuth, validate(applySchema), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof applySchema>;
      const kind = body.kind || 'author';

      if (kind === 'author') {
        if (req.user!.role === 'author' || req.user!.role === 'admin') {
          throw badRequest('你已经是作者或管理员');
        }
      } else {
        // 优秀作者：必须已是作者且未 elite
        if (req.user!.role !== 'author') {
          throw badRequest('请先成为作者后再申请优秀作者');
        }
        if (req.user!.authorTier === 'elite') {
          throw badRequest('你已是优秀作者');
        }
      }

      const pendingGuard = `${req.user!.id}:${kind}`;
      try {
        const app = await prisma.$transaction(async (tx) => {
          const pending = await tx.authorApplication.findFirst({
            where: { userId: req.user!.id, status: 'pending', kind },
          });
          if (pending) throw conflict('你已有待审核的同类申请');
          return tx.authorApplication.create({
            data: {
              userId: req.user!.id,
              field: body.field,
              bio: body.bio,
              kind,
              pendingGuard,
            },
          });
        });
        res.status(201).json({ application: app });
      } catch (e) {
        // P2002：并发双提交撞 pendingGuard
        if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
          throw conflict('你已有待审核的同类申请');
        }
        throw e;
      }
    } catch (e) {
      next(e);
    }
  });

  applicationsRouter.get('/', requireAuth, requireRole('admin'), async (_req, res, next) => {
    try {
      const items = await prisma.authorApplication.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, name: true, role: true, authorTier: true },
          },
        },
      });
      res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  applicationsRouter.patch(
    '/:id',
    requireAuth,
    requirePermission('user.manage'),
    validate(
      z.object({
        status: z.enum(['approved', 'rejected']),
      }),
    ),
    async (req, res, next) => {
      try {
        const { status } = req.body as { status: 'approved' | 'rejected' };
        const app = await applyApplicationDecision(prisma, {
          id: param(req, 'id'),
          status,
        });
        res.json({ application: app });
      } catch (e) {
        next(e);
      }
    },
  );

  return applicationsRouter;
}
