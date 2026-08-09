/**
 * Agent 用户记忆（C-02：自 routes/agent.ts 拆分）
 * 用户上下文加载（风格/记忆/BYOK）、话题记忆、重要偏好记忆（含数量上限）。
 */
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { parsePrefs } from '../lib/prefs.js';
import { decryptByokConfig } from '../lib/byokCrypto.js';
import { formatMemoryBlock } from '../lib/llm/agentPrompt.js';
import type { ByokConfig } from '../lib/llm/types.js';

const MAX_PREF_MEMORIES = 20;

/**
 * R-11：hover 高频路径用户上下文短缓存（进程内，TTL 60s）。
 * loadUserContext 每次执行 3 条 DB 查询 + BYOK 解密，而记忆/进度在 60s 内几乎不变。
 * 设置变更时调用 invalidateUserContext 主动失效；多副本部署时 TTL 是最坏不一致窗口（文档化即可）。
 */
const CTX_TTL_MS = 60_000;
/** R-11：进程内缓存条目硬上限，超出按写入序淘汰最旧，防长期运行无限增长 */
const CTX_MAX_ENTRIES = 5000;
type UserCtx = Awaited<ReturnType<typeof loadUserContextInner>>;
const ctxCache = new Map<string, { at: number; value: UserCtx }>();

export function invalidateUserContext(userId: string): void {
  for (const k of ctxCache.keys()) if (k.startsWith(`${userId}::`)) ctxCache.delete(k);
}

/** 带短缓存壳：无 userId 或缓存未命中时走真实查询 */
export async function loadUserContext(userId?: string, route?: string): Promise<UserCtx> {
  if (!userId) return loadUserContextInner(userId, route);
  const key = `${userId}::${route || ''}`;
  const hit = ctxCache.get(key);
  if (hit && Date.now() - hit.at < CTX_TTL_MS) return hit.value;
  // 过期条目立即删除，避免惰性过期导致 Map 无限增长
  if (hit) ctxCache.delete(key);
  const value = await loadUserContextInner(userId, route);
  ctxCache.set(key, { at: Date.now(), value });
  // 超出硬上限：删除最旧一条（Map 保持插入序，首键即最旧）
  if (ctxCache.size > CTX_MAX_ENTRIES) {
    const oldest = ctxCache.keys().next();
    if (!oldest.done) ctxCache.delete(oldest.value);
  }
  return value;
}

/** pref: 前缀记忆数量上限，超出按 updatedAt 淘汰最旧（B-08） */
async function trimPrefMemories(userId: string) {
  try {
    const count = await prisma.agentMemory.count({
      where: { userId, key: { startsWith: 'pref:' } },
    });
    if (count <= MAX_PREF_MEMORIES) return;
    const overflow = await prisma.agentMemory.findMany({
      where: { userId, key: { startsWith: 'pref:' } },
      orderBy: { updatedAt: 'asc' },
      take: count - MAX_PREF_MEMORIES,
      select: { id: true },
    });
    if (overflow.length) {
      await prisma.agentMemory.deleteMany({
        where: { id: { in: overflow.map((m) => m.id) } },
      });
    }
  } catch (e) {
    logger.warn({ err: String(e), userId }, 'trim pref memories failed');
  }
}

export async function maybeSaveImportantMemory(
  userId: string | undefined,
  userMsg: string,
  answer: string,
) {
  if (!userId) return;
  // 用户明确要求记住 / 偏好
  if (/请记住|记住：|我的偏好|以后.*用/.test(userMsg)) {
    // B-08：稳定哈希 key——同一消息重复写只覆盖不新增，杜绝无限增长
    const key = `pref:${createHash('sha256').update(userMsg).digest('hex').slice(0, 16)}`;
    try {
      await prisma.agentMemory.upsert({
        where: { userId_key: { userId, key } },
        create: {
          userId,
          key,
          value: `${userMsg.slice(0, 120)} → ${answer.slice(0, 200)}`,
          kind: 'preference',
        },
        update: { value: `${userMsg.slice(0, 120)} → ${answer.slice(0, 200)}` },
      });
      await trimPrefMemories(userId);
    } catch (e) {
      logger.warn({ err: String(e), userId }, 'save important memory failed');
    }
  }
}

async function loadUserContextInner(userId?: string, route?: string) {
  if (!userId) {
    return {
      style: 'professional',
      memoryBlock: formatMemoryBlock({
        mastered: [],
        learning: [],
        notes: [],
        route,
      }),
      byok: null as ByokConfig | null,
    };
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const pref = parsePrefs(user?.preferences);
  const style = (typeof pref.agentStyle === 'string' && pref.agentStyle) || 'professional';
  // A-03：库中为密文，读取时解密供 resolveProvider 使用
  const byok = decryptByokConfig((pref.byok as ByokConfig) || null);

  const [memories, progress] = await Promise.all([
    prisma.agentMemory.findMany({ where: { userId }, take: 40, orderBy: { updatedAt: 'desc' } }),
    prisma.learningProgress.findMany({
      where: { userId },
      include: { article: { select: { title: true, slug: true } } },
      take: 50,
    }),
  ]);

  const mastered = progress
    .filter((p) => p.mastery === 'mastered' || p.progress >= 0.85)
    .map((p) => p.article.title);
  const learning = progress
    .filter((p) => p.mastery !== 'mastered' && p.progress < 0.85)
    .map((p) => p.article.title);
  const notes = memories
    .filter((m) => m.kind !== 'fact' || !m.key.startsWith('seen:'))
    .map((m) => `${m.key}: ${m.value.slice(0, 120)}`);
  const recentTopics = memories
    .filter((m) => m.key.startsWith('seen:'))
    .map((m) => m.value.replace(/^用户.*?：/, '').slice(0, 40))
    .slice(0, 8);

  return {
    style,
    byok,
    memoryBlock: formatMemoryBlock({
      style,
      mastered,
      learning,
      notes,
      recentTopics,
      route,
    }),
  };
}

export async function rememberTopic(userId: string | undefined, topic: string, mode: string) {
  if (!userId || !topic.trim()) return;
  const key = `seen:${topic.slice(0, 80)}`;
  try {
    await prisma.agentMemory.upsert({
      where: { userId_key: { userId, key } },
      create: {
        userId,
        key,
        value: `用户在 ${mode} 模式询问过：${topic.slice(0, 200)}`,
        kind: 'fact',
      },
      update: {
        value: `用户再次询问（${mode}）：${topic.slice(0, 200)}`,
        kind: 'fact',
      },
    });
  } catch (e) {
    // fire-and-forget 写入：失败不打断主链路，但留痕
    logger.warn({ err: String(e), userId }, 'remember topic failed');
  }
}
