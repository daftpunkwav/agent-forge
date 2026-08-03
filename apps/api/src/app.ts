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
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // 仅当显式 TRUST_PROXY=1 时信任反向代理；直连暴露时关闭以防伪造 XFF 绕过限流
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);

  app.use(helmet());
  app.use(
    cors({
      origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
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

  app.use(generalLimiter);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'agentforge-api', ts: new Date().toISOString() });
  });

  const agentLimiter = rateLimit({
    windowMs: 60_000,
    max: 40,
    message: { error: { code: 'RATE_LIMIT', message: 'Agent 请求过于频繁' } },
  });

  app.use('/api/v1/auth', authLimiter, authRouter);
  app.use('/api/v1/articles', articlesRouter);
  app.use('/api/v1/animations', animationsRouter);
  app.use('/api/v1/author-applications', applicationsRouter);
  app.use('/api/v1/domains', domainsRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/agent', agentLimiter, agentRouter);
  app.use('/api/v1/topics', topicsRouter);

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
