/**
 * 身份与权限矩阵
 *
 * 身份：
 * - guest  未登录（运行时身份，不入库）
 * - reader 读者（默认注册）
 * - author 作者（含 authorTier: standard | elite）
 * - admin  管理员（adminLevel: 1–100，100 为最高）
 */

export type UserRole = 'reader' | 'author' | 'admin';
export type AuthorTier = 'none' | 'standard' | 'elite';
export type RuntimeIdentity = 'guest' | UserRole;

export type Permission =
  | 'content.read'
  | 'content.comment'
  | 'annotation.read'
  | 'annotation.write'
  | 'topic.read'
  | 'topic.post'
  | 'author.apply'
  | 'author.elite_apply'
  | 'author.workspace'
  | 'domain.manage'
  | 'user.manage'
  | 'moderation.review'
  | 'admin.full';

const BASE: Record<UserRole, Permission[]> = {
  reader: [
    'content.read',
    'content.comment',
    'annotation.read',
    'annotation.write',
    'topic.read',
    'topic.post',
    'author.apply',
  ],
  author: [
    'content.read',
    'content.comment',
    'annotation.read',
    'annotation.write',
    'topic.read',
    'topic.post',
    'author.workspace',
    'author.elite_apply',
  ],
  admin: [
    'content.read',
    'content.comment',
    'annotation.read',
    'annotation.write',
    'topic.read',
    'topic.post',
    'author.workspace',
    'domain.manage',
    'user.manage',
    'moderation.review',
    'admin.full',
  ],
};

export interface Principal {
  role: RuntimeIdentity;
  authorTier?: AuthorTier;
  /** 0 = 非管理员；1–100，100 最高 */
  adminLevel?: number;
}

export function can(principal: Principal | null | undefined, perm: Permission): boolean {
  if (!principal || principal.role === 'guest') {
    return perm === 'content.read' || perm === 'annotation.read' || perm === 'topic.read';
  }
  const list = BASE[principal.role] || [];
  if (!list.includes(perm)) return false;
  // 优秀作者额外：可审核自己文章的 Agent 批注策略（业务层再细判）
  if (perm === 'moderation.review' && principal.role === 'author') {
    return principal.authorTier === 'elite';
  }
  // 管理员分级：domain/user 管理需要 level >= 50；full 需要 100
  if (principal.role === 'admin') {
    const lvl = principal.adminLevel ?? 1;
    if (perm === 'admin.full') return lvl >= 100;
    if (perm === 'user.manage' || perm === 'domain.manage') return lvl >= 50;
  }
  return true;
}

export function isAuthorLike(p: Principal | null | undefined): boolean {
  if (!p) return false;
  return p.role === 'author' || p.role === 'admin';
}

export function isAdminLike(p: Principal | null | undefined, minLevel = 1): boolean {
  if (!p || p.role !== 'admin') return false;
  return (p.adminLevel ?? 1) >= minLevel;
}

export function roleLabel(role: RuntimeIdentity, authorTier?: AuthorTier, adminLevel?: number): string {
  if (role === 'guest') return '游客';
  if (role === 'reader') return '读者';
  if (role === 'author') {
    return authorTier === 'elite' ? '优秀作者' : '作者';
  }
  if (role === 'admin') {
    const lvl = adminLevel ?? 1;
    if (lvl >= 100) return '超级管理员';
    if (lvl >= 50) return '高级管理员';
    return '管理员';
  }
  return role;
}
