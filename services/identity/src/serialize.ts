/** identity 域 DTO 序列化：用户公开信息(仅访问 User 归属表) */
import type { User } from '@prisma/client';
import type { PublicUser, AuthorTier, UserRole } from '@core/contracts';

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as UserRole,
    authorTier: (u.authorTier as AuthorTier) || 'none',
    adminLevel: u.adminLevel ?? 0,
    bio: u.bio || undefined,
    avatarUrl: u.avatarUrl || undefined,
    headline: u.headline || undefined,
    website: u.website || undefined,
    createdAt: u.createdAt.toISOString(),
  };
}
