/**
 * 会话访问控制与生命周期（A-05）：
 * 登录仅本人会话、匿名须 guestKey 匹配、过期匿名会话新建、正常复用。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    agentConversation: {
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    agentMessage: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma.js';
import { ensureConversation } from './agentConversation.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.agentConversation.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(prisma.agentConversation.create).mockResolvedValue({ id: 'new-conv' } as never);
});

describe('ensureConversation', () => {
  it('登录用户不可访问他人会话 → 新建', async () => {
    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-other',
      userId: 'someone-else',
    } as never);
    const conv = await ensureConversation('me', { conversationId: 'c-other' });
    expect(conv.id).toBe('new-conv');
    expect(prisma.agentConversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'me', expiresAt: null }),
    });
  });

  it('匿名不可访问有主会话 → 新建', async () => {
    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-owned',
      userId: 'someone',
    } as never);
    const conv = await ensureConversation(undefined, {
      conversationId: 'c-owned',
      guestKey: 'gk-aaaaaaaaaaaaaaaa',
    });
    expect(conv.id).toBe('new-conv');
    expect(prisma.agentConversation.create).toHaveBeenCalled();
  });

  it('过期匿名会话视为无效 → 新建（带 7d 过期 + guestKey）', async () => {
    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-expired',
      userId: null,
      guestKey: 'gk-aaaaaaaaaaaaaaaa',
      expiresAt: new Date(Date.now() - 1000),
    } as never);
    const conv = await ensureConversation(undefined, {
      conversationId: 'c-expired',
      guestKey: 'gk-aaaaaaaaaaaaaaaa',
    });
    expect(conv.id).toBe('new-conv');
    const arg = vi.mocked(prisma.agentConversation.create).mock.calls[0][0] as {
      data: { expiresAt: Date; guestKey: string };
    };
    expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(arg.data.guestKey).toBe('gk-aaaaaaaaaaaaaaaa');
  });

  it('合法复用：登录用户本人会话 / 匿名 guestKey 匹配', async () => {
    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-mine',
      userId: 'me',
    } as never);
    expect((await ensureConversation('me', { conversationId: 'c-mine' })).id).toBe('c-mine');
    expect(prisma.agentConversation.create).not.toHaveBeenCalled();

    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-guest',
      userId: null,
      guestKey: 'gk-bbbbbbbbbbbbbbbb',
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    expect(
      (
        await ensureConversation(undefined, {
          conversationId: 'c-guest',
          guestKey: 'gk-bbbbbbbbbbbbbbbb',
        })
      ).id,
    ).toBe('c-guest');
    expect(prisma.agentConversation.create).not.toHaveBeenCalled();
  });

  it('匿名 guestKey 不匹配或历史无 key → 新建（防 IDOR）', async () => {
    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-guest',
      userId: null,
      guestKey: 'gk-correct-key-here',
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    expect(
      (
        await ensureConversation(undefined, {
          conversationId: 'c-guest',
          guestKey: 'gk-wrong-key-herexx',
        })
      ).id,
    ).toBe('new-conv');

    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-legacy',
      userId: null,
      guestKey: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    expect(
      (
        await ensureConversation(undefined, {
          conversationId: 'c-legacy',
          guestKey: 'gk-any-key-will-do1',
        })
      ).id,
    ).toBe('new-conv');
  });

  it('不传 conversationId → 直接新建', async () => {
    const conv = await ensureConversation('me');
    expect(conv.id).toBe('new-conv');
  });
});
