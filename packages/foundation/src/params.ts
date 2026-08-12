import type { Request } from 'express';

/** Express 5 中 params 可能为 string | string[] */
export function param(req: Request, name: string): string {
  const v = req.params[name];
  if (Array.isArray(v)) return v[0] || '';
  return v || '';
}
