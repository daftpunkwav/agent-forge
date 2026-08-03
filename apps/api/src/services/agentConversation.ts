/**
 * Agent 会话管理（C-02：自 routes/agent.ts 拆分）
 * 会话生命周期、过期匿名会话清理、消息持久化与滚动摘要。
 */
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

const GUEST_CONV_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 清理过期匿名会话（级联删除 messages） */
async function purgeExpiredGuestConversations() {
  await prisma.agentConversation.deleteMany({
    where: {
      userId: null,
      expiresAt: { lt: new Date() },
    },
  });
}

let lastPurgeAt = 0;
const PURGE_INTERVAL_MS = 10 * 60 * 1000;

/** 节流清理过期匿名会话（B-07）：每 10 分钟至多扫一次，避免高并发下每个请求都触发全表扫描 */
async function maybePurgeGuestConversations() {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  try {
    await purgeExpiredGuestConversations();
  } catch (e) {
    logger.warn({ err: String(e) }, 'guest conversation purge failed');
  }
}

export async function ensureConversation(userId: string | undefined, conversationId?: string) {
  // 轻量清理：节流扫过期匿名会话
  void maybePurgeGuestConversations();

  if (conversationId) {
    const existing = await prisma.agentConversation.findUnique({ where: { id: conversationId } });
    // 访问控制：已登录仅本人会话；匿名仅允许无主（userId 为空）会话，其余按找不到处理（走下方新建）
    if (existing && (userId ? existing.userId === userId : !existing.userId)) {
      // 已过期的匿名会话视为无效，新建
      if (!userId && existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
        // fall through to create
      } else {
        return existing;
      }
    }
  }
  return prisma.agentConversation.create({
    data: {
      userId: userId || null,
      title: '对话',
      expiresAt: userId ? null : new Date(Date.now() + GUEST_CONV_TTL_MS),
    },
  });
}

export async function loadRecentMessages(conversationId: string, take = 12) {
  return prisma.agentMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function persistTurn(
  conversationId: string,
  userMsg: string,
  assistant: { content: string; thinking?: string },
) {
  await prisma.agentMessage.createMany({
    data: [
      { conversationId, role: 'user', content: userMsg.slice(0, 4000) },
      {
        conversationId,
        role: 'assistant',
        content: assistant.content.slice(0, 8000),
        thinking: (assistant.thinking || '').slice(0, 4000),
      },
    ],
  });
  // 滚动摘要：超过 20 条时压缩最旧事实
  const count = await prisma.agentMessage.count({ where: { conversationId } });
  if (count > 24) {
    const old = await prisma.agentMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 8,
    });
    const snippet = old
      .map((m) => `${m.role}: ${m.content.slice(0, 80)}`)
      .join(' | ')
      .slice(0, 500);
    await prisma.agentConversation.update({
      where: { id: conversationId },
      data: { summary: snippet, updatedAt: new Date() },
    });
  } else {
    await prisma.agentConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }
}
