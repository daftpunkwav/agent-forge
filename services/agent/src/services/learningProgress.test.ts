import { describe, expect, it, vi } from 'vitest';
import { upsertLearningProgress } from './learningProgress.js';

describe('upsertLearningProgress', () => {
  it('首次写入：create 与 update 使用同一套 progress', async () => {
    const prisma = {
      learningProgress: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: 'p1', progress: 0.8, mastery: 'learning' }),
      },
    } as unknown as import('@prisma/client').PrismaClient;
    await upsertLearningProgress(prisma, { userId: 'u1', articleId: 'a1', progress: 0.8 });
    expect(prisma.learningProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ progress: 0.8, mastery: 'learning' }),
        update: expect.objectContaining({ progress: 0.8, mastery: 'learning' }),
      }),
    );
  });

  it('进度单调：不会低于已有值', async () => {
    const prisma = {
      learningProgress: {
        findUnique: vi.fn().mockResolvedValue({ progress: 0.7, mastery: 'learning' }),
        upsert: vi.fn().mockResolvedValue({ progress: 0.7 }),
      },
    } as unknown as import('@prisma/client').PrismaClient;
    await upsertLearningProgress(prisma, { userId: 'u1', articleId: 'a1', progress: 0.2 });
    expect(prisma.learningProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ progress: 0.7 }),
      }),
    );
  });

  it('mastered 不可降级', async () => {
    const prisma = {
      learningProgress: {
        findUnique: vi.fn().mockResolvedValue({ progress: 1, mastery: 'mastered' }),
        upsert: vi.fn().mockResolvedValue({ mastery: 'mastered' }),
      },
    } as unknown as import('@prisma/client').PrismaClient;
    await upsertLearningProgress(prisma, {
      userId: 'u1',
      articleId: 'a1',
      mastery: 'learning',
    });
    expect(prisma.learningProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ mastery: 'mastered' }),
      }),
    );
  });

  it('唯一约束冲突时重试', async () => {
    const conflict = Object.assign(new Error('unique'), { code: 'P2002' });
    const prisma = {
      learningProgress: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ progress: 0.3, mastery: 'learning' }),
        upsert: vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ id: 'p1', progress: 0.5 }),
      },
    } as unknown as import('@prisma/client').PrismaClient;
    const row = await upsertLearningProgress(prisma, { userId: 'u1', articleId: 'a1', progress: 0.5 });
    expect(row.progress).toBe(0.5);
    expect(prisma.learningProgress.upsert).toHaveBeenCalledTimes(2);
  });
});
