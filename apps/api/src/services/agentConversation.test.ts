/**
 * 会话访问控制与生命周期（A-05）：
 * 登录仅本人会话、匿名仅无主会话、过期匿名会话新建、正常复用。
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
    const conv = await ensureConversation('me', 'c-other');
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
    const conv = await ensureConversation(undefined, 'c-owned');
    expect(conv.id).toBe('new-conv');
    expect(prisma.agentConversation.create).toHaveBeenCalled();
  });

  it('过期匿名会话视为无效 → 新建（带 7d 过期）', async () => {
    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-expired',
      userId: null,
      expiresAt: new Date(Date.now() - 1000),
    } as never);
    const conv = await ensureConversation(undefined, 'c-expired');
    expect(conv.id).toBe('new-conv');
    const arg = vi.mocked(prisma.agentConversation.create).mock.calls[0][0] as {
      data: { expiresAt: Date };
    };
    expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('合法复用：登录用户本人会话 / 匿名无主未过期会话', async () => {
    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-mine',
      userId: 'me',
    } as never);
    expect((await ensureConversation('me', 'c-mine')).id).toBe('c-mine');
    expect(prisma.agentConversation.create).not.toHaveBeenCalled();

    vi.mocked(prisma.agentConversation.findUnique).mockResolvedValue({
      id: 'c-guest',
      userId: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    expect((await ensureConversation(undefined, 'c-guest')).id).toBe('c-guest');
    expect(prisma.agentConversation.create).not.toHaveBeenCalled();
  });

  it('不传 conversationId → 直接新建', async () => {
    const conv = await ensureConversation('me');
    expect(conv.id).toBe('new-conv');
  });
});
