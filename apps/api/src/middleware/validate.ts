import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

type Target = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: Target = 'body'): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req[target]);
    if (!parsed.success) {
      next(parsed.error);
      return;
    }
    // 显式断言到「可索引赋值」的形状，避免 any 丢失类型保护
    (req as unknown as Record<Target, unknown>)[target] = parsed.data;
    next();
  };
}
