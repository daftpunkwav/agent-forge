/**
 * R-07：启动期环境校验。
 * 原则：关键依赖 fail-fast（启动即失败并打印原因）；可选依赖 warn 降级（不阻断启动）。
 * - 关键：JWT_SECRET（认证全盘依赖）、DATABASE_URL（生产必须显式）
 * - 可选：LLM Provider（缺失时 Agent 域降级为「仅 BYOK 可用」，其余域正常）
 * 依赖注入：LLM 判定经端口语义(listPublicProviders)由调用方传入,不直接 import llm 内部函数。
 */
import { logger } from '@core/foundation';

export function validateEnv(opts: { hasServerProviders?: () => boolean } = {}): void {
  const problems: string[] = [];

  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret.length < 16) {
    problems.push('JWT_SECRET 未配置或过短（至少 16 字符）');
  }
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    if (jwtSecret.length < 32) {
      problems.push('生产环境 JWT_SECRET 至少 32 字符');
    }
    if (jwtSecret.includes('change-me')) {
      problems.push('生产环境禁止使用 .env.example 中的示例 JWT_SECRET');
    }
    if (!process.env.DATABASE_URL) {
      problems.push('生产环境必须显式配置 DATABASE_URL');
    }
  }

  if (problems.length) {
    for (const p of problems) logger.error({ problem: p }, 'env validation failed');
    // 关键依赖缺失：拒绝启动。这比「启动成功但运行时全部 500」更诚实、更易排障。
    process.exit(1);
  }

  // 可选依赖：仅提示降级，不阻断（经端口判定,不直接依赖 llm 内部模块级状态）
  if (opts.hasServerProviders?.() === false) {
    logger.warn(
      { event: 'llm_degraded' },
      '未配置任何服务端 LLM Provider：Agent 域降级（仅 BYOK 用户可用），其余功能正常',
    );
  }
}
