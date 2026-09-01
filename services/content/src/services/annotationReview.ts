/**
 * 批注审核：以 status=pending 为条件原子更新，避免并发审核互相覆盖。
 */
import type { PrismaClient } from '@prisma/client';
import { badRequest, notFound } from '@core/foundation';

export async function applyAnnotationDecision(
  prisma: PrismaClient,
  input: {
    id: string;
    status: 'approved' | 'rejected';
    reviewBy: string;
    reviewerId: string;
    agentNote?: string;
  },
) {
  const claimed = await prisma.annotation.updateMany({
    where: { id: input.id, status: 'pending' },
    data: {
      status: input.status,
      reviewBy: input.reviewBy,
      reviewedAt: new Date(),
      reviewerId: input.reviewerId,
      ...(input.agentNote != null ? { agentNote: input.agentNote } : {}),
    },
  });
  if (claimed.count === 0) {
    const existing = await prisma.annotation.findUnique({ where: { id: input.id } });
    if (!existing) throw notFound('批注不存在');
    throw badRequest('该批注已审核');
  }
  return prisma.annotation.findUniqueOrThrow({ where: { id: input.id } });
}
