import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { logger } from './lib/logger.js';
import { authRouter } from './routes/auth.js';
import { articlesRouter } from './routes/articles.js';
import { animationsRouter } from './routes/animations.js';
import { applicationsRouter } from './routes/applications.js';
import { agentRouter } from './routes/agent.js';
import { domainsRouter } from './routes/domains.js';
import { settingsRouter } from './routes/settings.js';
import { topicsRouter } from './routes/topics.js';
import { annotationsRouter } from './routes/annotations.js';
import { errorHandler } from './middleware/errorHandler.js';
import { prisma } from './lib/prisma.js';

export function createApp() {
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
    res.json({ ok: true, service: 'agentforge-api', ts: new Date().toISOString() });
  });

  // R-03：readiness 深检查——DB 不可用时 503，让 LB/编排系统摘流而非打挂
  app.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  app.use(generalLimiter);

  app.use('/api/v1/auth', authLimiter, authRouter);
  app.use('/api/v1/articles', articlesRouter);
  app.use('/api/v1/animations', animationsRouter);
  app.use('/api/v1/author-applications', applicationsRouter);
  app.use('/api/v1/domains', domainsRouter);
  app.use('/api/v1/settings', settingsRouter);
  // R-10：Agent 限流分桶定义已下沉到 routes/agent.ts（按端点挂不同桶），
  // app.ts 只做装配；Agent 域仍受上方 generalLimiter 约束。
  app.use('/api/v1/agent', agentRouter);
  app.use('/api/v1/topics', topicsRouter);
  app.use('/api/v1/annotations', annotationsRouter);

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
