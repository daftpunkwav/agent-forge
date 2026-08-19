/** content 领域归一化:标题 → slug(非序列化,故与 DTO mapper 分离) */
import { randomBytes } from 'node:crypto';
export function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  // 兜底用随机短串而非时间戳：同一毫秒两次保存也会生成不同 slug
  return base || `article-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}
