import { describe, expect, it, vi } from 'vitest';
import { resolveLinkedArticleId } from './articleLink.js';

describe('resolveLinkedArticleId', () => {
  it('无关联 → null', async () => {
    const articles = {
      getArticlesByIds: vi.fn(),
      getArticleIdBySlug: vi.fn(),
    };
    await expect(resolveLinkedArticleId(articles, {})).resolves.toBeNull();
    expect(articles.getArticlesByIds).not.toHaveBeenCalled();
  });

  it('articleId 存在则采用端口校验后的 id', async () => {
    const articles = {
      getArticlesByIds: vi.fn().mockResolvedValue([{ id: 'art-1', title: 't', slug: 's' }]),
      getArticleIdBySlug: vi.fn(),
    };
    await expect(resolveLinkedArticleId(articles, { articleId: 'art-1' })).resolves.toBe('art-1');
    expect(articles.getArticleIdBySlug).not.toHaveBeenCalled();
  });

  it('裸 articleId 不存在 → 关联文章不存在', async () => {
    const articles = {
      getArticlesByIds: vi.fn().mockResolvedValue([]),
      getArticleIdBySlug: vi.fn(),
    };
    await expect(resolveLinkedArticleId(articles, { articleId: 'nope' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '关联文章不存在',
    });
  });

  it('articleSlug 经端口解析', async () => {
    const articles = {
      getArticlesByIds: vi.fn(),
      getArticleIdBySlug: vi.fn().mockResolvedValue('art-2'),
    };
    await expect(resolveLinkedArticleId(articles, { articleSlug: 'hello' })).resolves.toBe('art-2');
  });
});
