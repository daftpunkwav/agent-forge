import { can } from '@core/contracts';
import type { AuthUser } from '@core/foundation';

/** 列表可见性：游客仅 approved；登录用户 approved+自己的；作者/管理员看该文全部 */
export function annotationListWhere(opts: {
  viewerId?: string;
  isArticleAuthor: boolean;
  isAdmin: boolean;
}): Record<string, unknown> {
  if (opts.isArticleAuthor || opts.isAdmin) return {};
  if (opts.viewerId) {
    return { OR: [{ status: 'approved' }, { userId: opts.viewerId }] };
  }
  return { status: 'approved' };
}

/**
 * 审核 ACL：该文作者，或具备 moderation.review / admin.full 的管理员
 * （普通作者仅能审自己的文章；elite 的 moderation.review 不跨文）
 */
export function canReviewAnnotation(opts: {
  user: AuthUser;
  articleAuthorId: string;
}): boolean {
  if (opts.user.id === opts.articleAuthorId) return true;
  if (opts.user.role !== 'admin') return false;
  const principal = {
    role: opts.user.role,
    authorTier: opts.user.authorTier,
    adminLevel: opts.user.adminLevel,
  };
  return can(principal, 'moderation.review') || can(principal, 'admin.full');
}

/** 写入 reviewBy：文章作者优先记 author，否则 admin */
export function resolveReviewBy(opts: {
  reviewerId: string;
  articleAuthorId: string;
  reviewerRole: string;
}): 'author' | 'admin' {
  if (opts.reviewerId === opts.articleAuthorId) return 'author';
  if (opts.reviewerRole === 'admin') return 'admin';
  // 理论上仅作者或管理员可审；兜底按作者
  return 'author';
}
