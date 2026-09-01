import { describe, expect, it, vi } from 'vitest';
import { applyApplicationDecision } from './applicationReview.js';

function mockPrisma(tx: {
  authorApplication: { updateMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  user: { update: ReturnType<typeof vi.fn> };
}) {
  return {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as import('@prisma/client').PrismaClient;
}

describe('applyApplicationDecision', () => {
  it('pending 申请批准：占位成功并提升角色', async () => {
    const tx = {
      authorApplication: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'a1',
          userId: 'u1',
          kind: 'author',
          status: 'approved',
        }),
      },
      user: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = mockPrisma(tx);
    const app = await applyApplicationDecision(prisma, { id: 'a1', status: 'approved' });
    expect(app.status).toBe('approved');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'author', authorTier: 'standard' },
    });
  });

  it('并发第二次处理：updateMany count=0 → 已处理，不改用户', async () => {
    const tx = {
      authorApplication: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ id: 'a1', status: 'approved' }),
      },
      user: { update: vi.fn() },
    };
    const prisma = mockPrisma(tx);
    await expect(
      applyApplicationDecision(prisma, { id: 'a1', status: 'rejected' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: '该申请已处理' });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('申请不存在', async () => {
    const tx = {
      authorApplication: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      user: { update: vi.fn() },
    };
    const prisma = mockPrisma(tx);
    await expect(
      applyApplicationDecision(prisma, { id: 'missing', status: 'approved' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
