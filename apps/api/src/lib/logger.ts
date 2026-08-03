import { pino } from 'pino';

/**
 * 结构化日志：生产输出 JSON（便于日志采集），开发输出 pino-pretty 可读格式。
 * 级别由 LOG_LEVEL 控制（默认 info；排障可设 debug）。
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'agentforge-api' },
  ...(process.env.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
