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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any)[target] = parsed.data;
    next();
  };
}
