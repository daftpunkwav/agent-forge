import 'dotenv/config';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { validateEnv } from './lib/env.js';

const port = Number(process.env.PORT || 3001);

// R-07：启动期 env 校验——关键依赖缺失直接拒启动；可选依赖（LLM）warn 降级不阻断
validateEnv();

const app = createApp();
const server = app.listen(port, () => {
  logger.info({ port }, 'agentforge-api listening');
});

/**
 * R-03：优雅关闭——先停止接新连接，宽限在途请求完成，再断开 Prisma。
 * K8s/compose 滚动发布默认发 SIGTERM；超时兜底强退，防止悬挂连接卡住退出。
 */
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown: stop accepting new connections');

  // 兜底：10s 内退不干净就强退（不等待 LLM 上游 30s 超时自然结束）
  const forceTimer = setTimeout(() => {
    logger.error({ signal }, 'shutdown: forced exit after grace period');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  server.close(async () => {
    try {
      await prisma.$disconnect();
      logger.info('shutdown: prisma disconnected, bye');
      process.exit(0);
    } catch (e) {
      logger.error({ err: String(e) }, 'shutdown: prisma disconnect failed');
      process.exit(1);
    }
  });

  // Node ≥18.2：立刻结束空闲 keep-alive 连接；SSE 等在途连接由宽限期与兜底 timer 处理
  server.closeIdleConnections?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
