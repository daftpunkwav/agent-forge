/**
 * 悬停缓存 L2 服务端（C-02：自 routes/agent.ts 拆分）
 * - 默认 TTL 2h：热区会话复用、控制成本
 * - 高命中（hits≥8）延长至 24h：热点知识点少打 LLM
 * - 超过 hard cap 一律失效；写库前 isCompleteHoverAnswer 质检
 * - 仅缓存完整 final，中断/半截永不入库
 */
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { isSafeHoverPublicAnswer } from '../lib/llm/agentPrompt.js';

const HOVER_CACHE_TTL_DEFAULT_MS = 2 * 60 * 60 * 1000;
const HOVER_CACHE_TTL_HOT_MS = 24 * 60 * 60 * 1000;
const HOVER_CACHE_HOT_HITS = 8;

/**
 * 缓存 key 版本号：语义或样式影响缓存内容时 +1（历史：v1 无样式维度 → v7 堵口令泄漏）。
 * 升级后旧 key 自然过期，无需手工清库。
 * 注意：后端 key（sha256 入库）与前端 L1 key（明文 style::topic）不同——
 * L1/L2 独立查询，两端 key 无需一致；L1 不版本化，随 L2 升级自然失效。
 */
const HOVER_CACHE_KEY_VERSION = 'v7';

export function hoverCacheKey(topic: string, style: string): string {
  const norm = topic.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 400);
  return createHash('sha256').update(`${HOVER_CACHE_KEY_VERSION}::${style}::${norm}`).digest('hex').slice(0, 48);
}

export async function getHoverCache(topic: string, style: string): Promise<string | null> {
  const key = hoverCacheKey(topic, style);
  const row = await prisma.hoverExplainCache.findUnique({ where: { cacheKey: key } });
  if (!row) {
    logger.info({ event: 'hover_cache_miss', key }, 'hover cache miss');
    return null;
  }
  // 质检：历史脏数据（含思考过程）直接删掉，避免反复毒害
  if (!isSafeHoverPublicAnswer(row.answer)) {
    logger.warn({ event: 'hover_cache_dirty', key }, 'hover cache dirty row dropped');
    void prisma.hoverExplainCache
      .delete({ where: { cacheKey: key } })
      .catch((e) => logger.warn({ err: String(e), key }, 'hover cache: drop dirty row failed'));
    return null;
  }
  const age = Date.now() - row.updatedAt.getTime();
  const ttl = row.hits >= HOVER_CACHE_HOT_HITS ? HOVER_CACHE_TTL_HOT_MS : HOVER_CACHE_TTL_DEFAULT_MS;
  if (age > ttl) {
    logger.info({ event: 'hover_cache_expired', key }, 'hover cache expired');
    return null;
  }
  logger.info({ event: 'hover_cache_hit', key, hits: row.hits }, 'hover cache hit');
  void prisma.hoverExplainCache
    .update({ where: { cacheKey: key }, data: { hits: { increment: 1 } } })
    .catch((e) => logger.warn({ err: String(e), key }, 'hover cache: hits increment failed'));
  return row.answer;
}

export async function setHoverCache(topic: string, style: string, answer: string) {
  if (!isSafeHoverPublicAnswer(answer)) return;
  const key = hoverCacheKey(topic, style);
  try {
    await prisma.hoverExplainCache.upsert({
      where: { cacheKey: key },
      create: { cacheKey: key, topic: topic.slice(0, 200), answer: answer.slice(0, 1200) },
      update: { answer: answer.slice(0, 1200), topic: topic.slice(0, 200) },
    });
  } catch (e) {
    // 缓存写失败不应影响主链路，但要留痕以便发现反复失败
    logger.warn({ err: String(e), key }, 'hover cache: write failed');
  }
}

/**
 * R-06：缓存读隔离——读失败视为 miss（返回 null），由调用方降级到 LLM。
 * 缓存是优化层，绝不能成为关键路径的单点。
 */
export async function getHoverCacheSafe(topic: string, style: string): Promise<string | null> {
  maybePruneHoverCache();
  try {
    return await getHoverCache(topic, style);
  } catch (e) {
    logger.warn({ err: String(e) }, 'hover cache: read failed, degrade to LLM path');
    return null;
  }
}

/**
 * R-12：节流清理过期悬停缓存（30 分钟至多一次，不阻塞主链路）。
 * 复用 B-07 同款节流模式（agentConversation.ts）；硬保留期 7 天，
 * 未被再次查询的 key 不再无限滞留。
 */
let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 30 * 60 * 1000;
const HARD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 天硬保留期

function maybePruneHoverCache(): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  void prisma.hoverExplainCache
    .deleteMany({ where: { updatedAt: { lt: new Date(now - HARD_RETENTION_MS) } } })
    .then((r) => r.count && logger.info({ event: 'hover_cache_prune', count: r.count }, 'hover cache pruned'))
    .catch((e) => logger.warn({ err: String(e) }, 'hover cache prune failed'));
}
