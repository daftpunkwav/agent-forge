import { describe, expect, it, vi } from 'vitest';
import { applyAnnotationDecision } from './annotationReview.js';

describe('applyAnnotationDecision', () => {
  it('pending 批注审核成功', async () => {
    const prisma = {
      annotation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'n1',
          status: 'approved',
          reviewBy: 'author',
        }),
      },
    } as unknown as import('@prisma/client').PrismaClient;
    const row = await applyAnnotationDecision(prisma, {
      id: 'n1',
      status: 'approved',
      reviewBy: 'author',
      reviewerId: 'u1',
    });
    expect(row.status).toBe('approved');
    expect(prisma.annotation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n1', status: 'pending' } }),
    );
  });

  it('并发第二次审核 → 已审核', async () => {
    const prisma = {
      annotation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ id: 'n1', status: 'approved' }),
        findUniqueOrThrow: vi.fn(),
      },
    } as unknown as import('@prisma/client').PrismaClient;
    await expect(
      applyAnnotationDecision(prisma, {
        id: 'n1',
        status: 'rejected',
        reviewBy: 'admin',
        reviewerId: 'u2',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: '该批注已审核' });
    expect(prisma.annotation.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
