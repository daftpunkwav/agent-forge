/**
 * Agent 会话管理（C-02：自 routes/agent.ts 拆分）
 * 会话生命周期、过期匿名会话清理、消息持久化与滚动摘要（超限删除最旧消息）。
 * 匿名会话须绑定 guestKey，防止仅凭 conversationId 续写（IDOR）。
 * 工厂注入 PrismaClient——仅访问 agent 归属表(AgentConversation/AgentMessage)。
 */
import { randomBytes } from 'node:crypto';
import { logger } from '@core/foundation';

const GUEST_CONV_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createAgentConversation(prisma: import('@prisma/client').PrismaClient) {
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

  /** 生成匿名会话 guestKey（客户端应持久化并随请求回传） */
  function createGuestKey(): string {
    return randomBytes(24).toString('base64url');
  }

  /**
   * 确保会话存在并校验 ACL。
   * - 登录：仅本人会话
   * - 匿名：须 guestKey 匹配；无 guestKey 的历史会话不可续写（防 IDOR）
   */
  async function ensureConversation(
    userId: string | undefined,
    opts?: EnsureConversationOpts | string,
  ) {
    // 兼容旧签名 ensureConversation(userId, conversationId?)
    const options: EnsureConversationOpts =
      typeof opts === 'string' ? { conversationId: opts } : opts || {};
    const { conversationId, guestKey } = options;

    void maybePurgeGuestConversations();

    if (conversationId) {
      const existing = await prisma.agentConversation.findUnique({ where: { id: conversationId } });
      if (existing) {
        if (userId) {
          if (existing.userId === userId) return existing;
          // 他人会话 → 新建
        } else if (!existing.userId) {
          // 匿名：过期 → 新建
          if (existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
            // fall through
          } else if (existing.guestKey && guestKey && existing.guestKey === guestKey) {
            return existing;
          } else if (!existing.guestKey) {
            // 历史无 guestKey 的匿名会话：不可续写（关闭 IDOR 面）
            // fall through to create
          }
          // guestKey 不匹配 → 新建
        }
      }
    }

    const data: {
      userId: string | null;
      title: string;
      expiresAt: Date | null;
      guestKey?: string | null;
    } = {
      userId: userId || null,
      title: '对话',
      expiresAt: userId ? null : new Date(Date.now() + GUEST_CONV_TTL_MS),
    };
    if (!userId) {
      data.guestKey = guestKey?.trim() || createGuestKey();
    }
    return prisma.agentConversation.create({ data });
  }

  async function loadRecentMessages(conversationId: string, take = 12) {
    return prisma.agentMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async function persistTurn(
    conversationId: string,
    userMsg: string,
    assistant: { content: string; thinking?: string },
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.agentMessage.createMany({
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
      const count = await tx.agentMessage.count({ where: { conversationId } });
      if (count > 24) {
        const old = await tx.agentMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          take: 8,
        });
        const snippet = old
          .map((m) => `${m.role}: ${m.content.slice(0, 80)}`)
          .join(' | ')
          .slice(0, 500);
        const conv = await tx.agentConversation.findUnique({
          where: { id: conversationId },
          select: { summary: true },
        });
        const merged = [conv?.summary, snippet].filter(Boolean).join(' | ');
        const summary = merged.length <= 500 ? merged : merged.slice(merged.length - 500);
        await tx.agentConversation.update({
          where: { id: conversationId },
          data: { summary, updatedAt: new Date() },
        });
        if (old.length) {
          await tx.agentMessage.deleteMany({
            where: { id: { in: old.map((m) => m.id) } },
          });
        }
      } else {
        await tx.agentConversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
      }
    });
  }

  return { createGuestKey, ensureConversation, loadRecentMessages, persistTurn };
}

export type AgentConversation = ReturnType<typeof createAgentConversation>;

export type EnsureConversationOpts = {
  conversationId?: string;
  /** 匿名必填（新建或续写）；登录用户忽略 */
  guestKey?: string;
};
