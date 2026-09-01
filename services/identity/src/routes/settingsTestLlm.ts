import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, parsePrefs, AppError } from '@core/foundation';
import type { ByokConfig } from '@core/contracts';
import type { PrismaClient } from '@prisma/client';
import type { LlmGatewayPort } from '@core/contracts';

export function mountSettingsTestLlmRoutes(
  router: Router,
  deps: { prisma: PrismaClient; llm: LlmGatewayPort },
): void {
  const { prisma, llm } = deps;

  const testLlmLimiter = rateLimit({
    windowMs: 60_000,
    max: 40,
    message: { error: { code: 'RATE_LIMIT', message: '模型探测过于频繁' } },
  });

  router.post('/test-llm', requireAuth, testLlmLimiter, async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      const preferences = parsePrefs(user?.preferences);
      const byok = (preferences.byok as ByokConfig) || undefined;
      const provider = llm.resolveProvider(byok);
      if (!provider) {
        res.status(400).json({
          error: { code: 'NO_PROVIDER', message: '请先启用并填写完整的 BYOK，或配置服务端默认 Key' },
        });
        return;
      }
      const result = await llm.callLlm(
        {
          mode: 'fast',
          maxTokens: 32,
          messages: [
            { role: 'system', content: 'Reply with exactly: OK' },
            { role: 'user', content: 'ping' },
          ],
        },
        provider,
      );
      res.json({
        ok: true,
        model: result.model,
        format: result.format,
        providerId: provider.id,
        sample: result.text.slice(0, 120),
      });
    } catch (e) {
      if (e instanceof AppError && e.code === 'BYOK_URL_REJECTED') {
        next(e);
        return;
      }
      const message = llm.llmErrorMessage(e);
      if (message || e instanceof TypeError) {
        res.status(502).json({
          error: {
            code: 'LLM_ERROR',
            message: message || '无法连接模型服务，请检查网络后重试',
          },
        });
        return;
      }
      next(e);
    }
  });
}
