import { Router } from 'express';
import { z } from 'zod';
import { validate, optionalAuth, requireAuth, requirePermission, badRequest, forbidden, notFound, param, attachUserRefs } from '@core/foundation';
import type { PrismaClient, Annotation } from '@prisma/client';
import { toAnnotationItem } from '../services/serialize.js';
import {
  annotationListWhere,
  canReviewAnnotation,
  resolveReviewBy,
} from '../services/annotationAcl.js';
import { applyAnnotationDecision } from '../services/annotationReview.js';
import type { UserSummaryPort as UserQueryPort } from '@core/contracts';

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

/** 批量补批注作者名(不 join user 表) */
const attachAnnotationUsers = (rows: Annotation[], users: UserQueryPort) =>
  attachUserRefs(rows, users, (r) => r.userId, (r, author) => ({
    ...toAnnotationItem(r),
    user: author,
  }));

export function createAnnotationsRouter(prisma: PrismaClient, users: UserQueryPort): Router {
  const annotationsRouter = Router();

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

      const rows = await prisma.annotation.findMany({
        where: { articleId: article.id, ...visibility },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      res.json({ items: await attachAnnotationUsers(rows, users) });
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
        });

        const authors = await users.getUserSummaries([created.userId]);
        res.status(201).json({
          annotation: {
            ...toAnnotationItem(created),
            user: authors[0] ? { id: authors[0].id, name: authors[0].name } : undefined,
          },
        });
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

        const body = req.body as z.infer<typeof reviewSchema>;
        const reviewBy = resolveReviewBy({
          reviewerId: req.user!.id,
          articleAuthorId: existing.article.authorId,
          reviewerRole: req.user!.role,
        });

        const updated = await applyAnnotationDecision(prisma, {
          id,
          status: body.status,
          reviewBy,
          reviewerId: req.user!.id,
          agentNote: body.agentNote,
        });

        const authors = await users.getUserSummaries([updated.userId]);
        res.json({
          annotation: {
            ...toAnnotationItem(updated),
            user: authors[0] ? { id: authors[0].id, name: authors[0].name } : undefined,
          },
        });
      } catch (e) {
        next(e);
      }
    },
  );

  return annotationsRouter;
}
