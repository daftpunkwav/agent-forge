import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { logger, errorHandler } from '@core/foundation';
import { compose } from './compose.js';
import type { PrismaClient } from '@prisma/client';
import type { LlmGateway } from '@core/llm';

export interface CreateAppOptions {
  prisma: PrismaClient;
  llm: LlmGateway;
  /** 偏好/BYOK 变更 → 失效 agent 用户上下文缓存 */
  onPrefsChanged?: (info: { userId: string }) => void;
}

export function createApp(opts: CreateAppOptions) {
  const app = express();

  // 仅当显式 TRUST_PROXY=1 时信任反向代理；直连暴露时关闭以防伪造 XFF 绕过限流
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);

  app.use(helmet());
  app.use(
    cors({
      origin: (process.env.CORS_ORIGIN || 'http://localhost:5280').split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // requestId + 请求日志：贯穿错误处理（errorHandler 引用 res.locals.requestId）
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID().slice(0, 8);
    next();
  });
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          ms: Date.now() - start,
          requestId: res.locals.requestId,
        },
        'request',
      );
    });
    next();
  });

  const generalLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: { code: 'RATE_LIMIT', message: '请求过于频繁，请稍后再试' } },
  });

  // R-03：liveness 浅检查——必须在限流器之前，LB 高频探测不吃限流预算
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'api', ts: new Date().toISOString() });
  });

  // R-03：readiness 深检查——DB 不可用时 503，让 LB/编排系统摘流而非打挂
  app.get('/ready', async (_req, res) => {
    try {
      await opts.prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  app.use(generalLimiter);

  // 组合根装配：各业务域 Router 由 compose 注入(依赖 ports,无跨服务源码耦合)
  const { mounts } = compose(opts.prisma, opts.llm, { onPrefsChanged: opts.onPrefsChanged });
  for (const m of mounts) {
    // auth 路由沿用独立限流桶，避免注册/登录占满通用配额
    app.use(m.prefix, ...(m.prefix === '/api/v1/auth' ? [authLimiter] : []), m.router);
  }

  // MCP 协议入口预留（未来接 services/mcp）
  app.get('/api/v1/mcp/status', (_req, res) => {
    res.json({
      ok: true,
      protocol: 'mcp',
      status: 'reserved',
      message: 'MCP Server 骨架已预留，详见 services/mcp',
    });
  });

  app.use(errorHandler);
  return app;
}
