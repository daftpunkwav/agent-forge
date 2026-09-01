/**
 * 学习进度写入：create/update 使用同一套单调语义，并在唯一约束冲突时重试。
 * 归属本域表 LearningProgress；文章存在性由调用方经 ArticleQueryPort 校验。
 */
import type { PrismaClient } from '@prisma/client';

function isUniqueConflict(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002');
}

export async function upsertLearningProgress(
  prisma: PrismaClient,
  input: { userId: string; articleId: string; progress?: number; mastery?: string },
) {
  const { userId, articleId, progress, mastery } = input;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await prisma.learningProgress.findUnique({
      where: { userId_articleId: { userId, articleId } },
    });
    const nextProgress =
      progress == null ? (existing?.progress ?? 0.3) : Math.max(existing?.progress ?? 0, progress);
    let nextMastery = mastery || existing?.mastery || 'learning';
    if (existing?.mastery === 'mastered' && nextMastery !== 'mastered') {
      nextMastery = 'mastered';
    }
    try {
      return await prisma.learningProgress.upsert({
        where: { userId_articleId: { userId, articleId } },
        create: { userId, articleId, progress: nextProgress, mastery: nextMastery },
        update: { progress: nextProgress, mastery: nextMastery },
      });
    } catch (e) {
      if (isUniqueConflict(e) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error('learning progress upsert retries exhausted');
}
