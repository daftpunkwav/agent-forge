/**
 * identity 域跨服务查询(供宿主组合根实现 UserQueryPort)。
 * 边界：只访问 identity 归属表(User/RefreshToken/AuthorApplication)。
 * 未来微服务化时,宿主可用 HTTP 客户端替换这些实现,identity 内部零改动。
 */
import type { PrismaClient } from '@prisma/client';
import { parsePrefs } from '@core/foundation';
import type { ByokConfig } from '@core/contracts';

/** 批量用户摘要(content/community 序列化作者用) */
export async function getUserSummaries(
  prisma: PrismaClient,
  ids: string[],
): Promise<{ id: string; name: string }[]> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: uniq } },
    select: { id: true, name: true },
  });
  return rows;
}

/** 单用户偏好(含 BYOK 密文;agent 解密后供 LLM 网关),用户不存在返回 null */
export async function getUserPreferences(
  prisma: PrismaClient,
  userId: string,
): Promise<{
  agentStyle?: string;
  autoplayAnim?: boolean;
  animSpeed?: number;
  byok?: ByokConfig | null;
} | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const prefs = parsePrefs(user.preferences);
  return {
    agentStyle: typeof prefs.agentStyle === 'string' ? prefs.agentStyle : undefined,
    autoplayAnim: typeof prefs.autoplayAnim === 'boolean' ? prefs.autoplayAnim : undefined,
    animSpeed: typeof prefs.animSpeed === 'number' ? prefs.animSpeed : undefined,
    byok: (prefs.byok as ByokConfig | undefined) ?? null,
  };
}
