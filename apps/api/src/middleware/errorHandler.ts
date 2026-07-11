import type { ErrorRequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { ZodError } from 'zod';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.errors.map((e) => e.message).join('; ') || '参数校验失败',
      },
    });
    return;
  }

  console.error('[api]', err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProd ? '服务器内部错误' : String(err?.message || err),
    },
  });
};
