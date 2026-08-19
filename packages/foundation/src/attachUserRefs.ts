/**
 * 作者引用补齐(跨服务通用 helper)。
 * 各服务(identity 之外)序列化时,作者名经注入的 UserQueryPort 批量取——
 * 本函数封装「取 authorIds → 批量查 → 建 Map → 逐行 join」,消除多服务复制。
 * 返回逐行调用 map 的结果,author 为已补名字的作者引用(未知时 undefined)。
 */
import type { UserSummaryPort } from '@core/contracts';

export async function attachUserRefs<T, R>(
  rows: T[],
  users: Pick<UserSummaryPort, 'getUserSummaries'>,
  keyOf: (row: T) => string | undefined,
  map: (row: T, author: { id: string; name: string } | undefined) => R,
): Promise<R[]> {
  const ids = [...new Set(rows.map(keyOf).filter(Boolean) as string[])];
  const authors = await users.getUserSummaries(ids);
  const byId = new Map(authors.map((a) => [a.id, a.name]));
  return rows.map((row) => {
    const id = keyOf(row);
    const author =
      id && byId.has(id) ? { id, name: byId.get(id)! } : undefined;
    return map(row, author);
  });
}
