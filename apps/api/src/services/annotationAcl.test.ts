import { describe, expect, it } from 'vitest';
import {
  annotationListWhere,
  canReviewAnnotation,
  resolveReviewBy,
} from './annotationAcl.js';
import type { AuthUser } from '../middleware/auth.js';

function user(partial: Partial<AuthUser> & Pick<AuthUser, 'id' | 'role'>): AuthUser {
  return {
    email: 't@example.com',
    authorTier: 'none',
    adminLevel: 0,
    ...partial,
  };
}

describe('annotationListWhere', () => {
  it('游客仅 approved', () => {
    expect(annotationListWhere({ isArticleAuthor: false, isAdmin: false })).toEqual({
      status: 'approved',
    });
  });

  it('登录读者：approved + 自己的', () => {
    expect(
      annotationListWhere({ viewerId: 'u1', isArticleAuthor: false, isAdmin: false }),
    ).toEqual({ OR: [{ status: 'approved' }, { userId: 'u1' }] });
  });

  it('文章作者或管理员看全部', () => {
    expect(annotationListWhere({ viewerId: 'a1', isArticleAuthor: true, isAdmin: false })).toEqual(
      {},
    );
    expect(annotationListWhere({ viewerId: 'adm', isArticleAuthor: false, isAdmin: true })).toEqual(
      {},
    );
  });
});

describe('canReviewAnnotation', () => {
  const authorId = 'author-1';

  it('文章作者可审', () => {
    expect(
      canReviewAnnotation({
        user: user({ id: authorId, role: 'author', authorTier: 'standard' }),
        articleAuthorId: authorId,
      }),
    ).toBe(true);
  });

  it('其他读者不可审', () => {
    expect(
      canReviewAnnotation({
        user: user({ id: 'reader-2', role: 'reader' }),
        articleAuthorId: authorId,
      }),
    ).toBe(false);
  });

  it('其他作者即使 elite 不可跨文审', () => {
    expect(
      canReviewAnnotation({
        user: user({ id: 'other', role: 'author', authorTier: 'elite' }),
        articleAuthorId: authorId,
      }),
    ).toBe(false);
  });

  it('管理员可审', () => {
    expect(
      canReviewAnnotation({
        user: user({ id: 'adm', role: 'admin', adminLevel: 1 }),
        articleAuthorId: authorId,
      }),
    ).toBe(true);
  });
});

describe('resolveReviewBy', () => {
  it('作者审 → author', () => {
    expect(
      resolveReviewBy({ reviewerId: 'a1', articleAuthorId: 'a1', reviewerRole: 'author' }),
    ).toBe('author');
  });

  it('管理员审 → admin', () => {
    expect(
      resolveReviewBy({ reviewerId: 'adm', articleAuthorId: 'a1', reviewerRole: 'admin' }),
    ).toBe('admin');
  });

  it('作者本人是管理员仍记 author', () => {
    expect(
      resolveReviewBy({ reviewerId: 'a1', articleAuthorId: 'a1', reviewerRole: 'admin' }),
    ).toBe('author');
  });
});
