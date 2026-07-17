import type { ErrorRequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { Prisma } from '@prisma/client';
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

  // Prisma 已知错误统一映射：P2002 唯一约束冲突、P2003 外键引用不存在、P2025 记录不存在
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: '唯一约束冲突：相同记录已存在' },
      });
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: '引用的关联记录不存在' },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: '记录不存在' },
      });
      return;
    }
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
