import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth, requireAuth, requirePermission } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { toAnnotationItem } from '../services/serialize.js';
import {
  annotationListWhere,
  canReviewAnnotation,
  resolveReviewBy,
} from '../services/annotationAcl.js';
import { param } from '../lib/params.js';

const createSchema = z
  .object({
    articleId: z.string().min(1).optional(),
    articleSlug: z.string().min(1).optional(),
    anchorText: z.string().min(1).max(2000),
    sectionId: z.string().max(200).optional(),
    body: z.string().min(1).max(4000),
  })
  .refine((v) => Boolean(v.articleId || v.articleSlug), {
    message: '需要 articleId 或 articleSlug',
  });

const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  agentNote: z.string().max(2000).optional(),
});

export const annotationsRouter = Router();

annotationsRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const articleIdQ = typeof req.query.articleId === 'string' ? req.query.articleId : undefined;
    const articleSlugQ =
      typeof req.query.articleSlug === 'string' ? req.query.articleSlug : undefined;
    if (!articleIdQ && !articleSlugQ) {
      throw badRequest('需要 articleId 或 articleSlug');
    }

    const article = articleIdQ
      ? await prisma.article.findUnique({
          where: { id: articleIdQ },
          select: { id: true, authorId: true },
        })
      : await prisma.article.findUnique({
          where: { slug: articleSlugQ! },
          select: { id: true, authorId: true },
        });
    if (!article) throw notFound('文章不存在');

    const viewer = req.user;
    const visibility = annotationListWhere({
      viewerId: viewer?.id,
      isArticleAuthor: Boolean(viewer && viewer.id === article.authorId),
      isAdmin: viewer?.role === 'admin',
    });

    const items = await prisma.annotation.findMany({
      where: { articleId: article.id, ...visibility },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    res.json({ items: items.map(toAnnotationItem) });
  } catch (e) {
    next(e);
  }
});

annotationsRouter.post(
  '/',
  requireAuth,
  requirePermission('annotation.write'),
  validate(createSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createSchema>;
      const article = body.articleId
        ? await prisma.article.findUnique({ where: { id: body.articleId }, select: { id: true } })
        : await prisma.article.findUnique({
            where: { slug: body.articleSlug! },
            select: { id: true },
          });
      if (!article) throw badRequest('文章不存在');

      const created = await prisma.annotation.create({
        data: {
          articleId: article.id,
          userId: req.user!.id,
          anchorText: body.anchorText,
          sectionId: body.sectionId ?? '',
          body: body.body,
          status: 'pending',
        },
        include: { user: { select: { id: true, name: true } } },
      });

      res.status(201).json({ annotation: toAnnotationItem(created) });
    } catch (e) {
      next(e);
    }
  },
);

annotationsRouter.patch(
  '/:id',
  requireAuth,
  validate(reviewSchema),
  async (req, res, next) => {
    try {
      const id = param(req, 'id');
      const existing = await prisma.annotation.findUnique({
        where: { id },
        include: { article: { select: { authorId: true } } },
      });
      if (!existing) throw notFound('批注不存在');

      if (
        !canReviewAnnotation({
          user: req.user!,
          articleAuthorId: existing.article.authorId,
        })
      ) {
        throw forbidden('无权审核该批注');
      }

      if (existing.status !== 'pending') {
        throw badRequest('该批注已审核');
      }

      const body = req.body as z.infer<typeof reviewSchema>;
      const reviewBy = resolveReviewBy({
        reviewerId: req.user!.id,
        articleAuthorId: existing.article.authorId,
        reviewerRole: req.user!.role,
      });

      const updated = await prisma.annotation.update({
        where: { id },
        data: {
          status: body.status,
          reviewBy,
          reviewedAt: new Date(),
          reviewerId: req.user!.id,
          ...(body.agentNote != null ? { agentNote: body.agentNote } : {}),
        },
        include: { user: { select: { id: true, name: true } } },
      });

      res.json({ annotation: toAnnotationItem(updated) });
    } catch (e) {
      next(e);
    }
  },
);
