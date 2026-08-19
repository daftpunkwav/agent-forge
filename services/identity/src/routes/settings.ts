import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import {
  validate,
  requireAuth,
  parsePrefs,
  decryptByokConfig,
  encryptByokKey,
  isEncryptedByokKey,
  resolveByokApiKeyToStore,
  assertSafeByokBaseUrl,
  AppError,
} from '@core/foundation';
import { API_FORMATS, type ByokConfig } from '@core/contracts';
import type { PrismaClient } from '@prisma/client';
import type { LlmGatewayPort } from '@core/contracts';

const AGENT_STYLES = ['professional', 'friendly', 'sassy', 'concise', 'socratic'] as const;

export function createSettingsRouter(deps: {
  prisma: PrismaClient;
  llm: LlmGatewayPort;
  /** 偏好/BYOK 变更后回调(宿主注入,用于失效 agent 上下文缓存);无则忽略 */
  onPrefsChanged?: (info: { userId: string }) => void;
}): Router {
  const { prisma, llm, onPrefsChanged } = deps;
  const settingsRouter = Router();

  /** test-llm 打上游：与 Agent 同级限流，避免绕过 agentLimiter */
  const testLlmLimiter = rateLimit({
    windowMs: 60_000,
    max: 40,
    message: { error: { code: 'RATE_LIMIT', message: '模型探测过于频繁' } },
  });

  const byokSchema = z.object({
    enabled: z.boolean(),
    baseUrl: z.string().max(500).optional().default(''),
    apiKey: z.string().max(500).optional().default(''),
    model: z.string().max(120).optional().default(''),
    format: z.enum(['anthropic_messages', 'openai_chat', 'openai_responses']).optional(),
    name: z.string().max(80).optional(),
    vision: z.boolean().optional(),
  });

  function publicByok(byok: unknown) {
    const b = (byok || {}) as Partial<ByokConfig>;
    // A-03：库中为密文，脱敏展示前先解密
    const key = decryptByokConfig(b as ByokConfig)?.apiKey || '';
    return {
      enabled: Boolean(b.enabled),
      baseUrl: b.baseUrl || '',
      model: b.model || '',
      format: b.format || 'anthropic_messages',
      name: b.name || 'BYOK',
      vision: b.vision !== false,
      apiKeyMasked: key ? llm.maskApiKey(key) : '',
      hasApiKey: Boolean(key),
      // 不回传完整 key
    };
  }

  settingsRouter.get('/me', requireAuth, async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      const preferences = parsePrefs(user?.preferences);
      res.json({
        preferences: {
          agentStyle: preferences.agentStyle || 'professional',
          autoplayAnim: preferences.autoplayAnim ?? false,
          animSpeed: preferences.animSpeed ?? 1,
          byok: publicByok(preferences.byok),
        },
        agentStyles: AGENT_STYLES.map((id) => ({
          id,
          label:
            id === 'professional'
              ? '专业'
              : id === 'friendly'
                ? '热情'
                : id === 'sassy'
                  ? '毒舌'
                  : id === 'concise'
                    ? '简洁'
                    : '苏格拉底',
        })),
        apiFormats: API_FORMATS,
        serverProviders: llm.listPublicProviders(),
      });
    } catch (e) {
      next(e);
    }
  });

  settingsRouter.patch(
    '/me',
    requireAuth,
    validate(
      z.object({
        agentStyle: z.enum(AGENT_STYLES).optional(),
        autoplayAnim: z.boolean().optional(),
        animSpeed: z.number().min(0.5).max(2).optional(),
        byok: byokSchema.optional(),
        /** 若 true 且 apiKey 为空，清除已存 key */
        clearByokKey: z.boolean().optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
        const preferences = parsePrefs(user?.preferences);
        const body = req.body as {
          agentStyle?: string;
          autoplayAnim?: boolean;
          animSpeed?: number;
          byok?: z.infer<typeof byokSchema>;
          clearByokKey?: boolean;
        };

        if (body.agentStyle !== undefined) preferences.agentStyle = body.agentStyle;
        if (body.autoplayAnim !== undefined) preferences.autoplayAnim = body.autoplayAnim;
        if (body.animSpeed !== undefined) preferences.animSpeed = body.animSpeed;

        if (body.byok) {
          const prev = (preferences.byok || {}) as Partial<ByokConfig>;
          // 二次保存（留空不修改）时 prev 已是密文——必须解密后入库，避免对密文再加密；
          // 解密失败（密钥轮换）时保留原密文，绝不落空销毁
          let apiKey = resolveByokApiKeyToStore(prev.apiKey, body.byok.apiKey || '');
          if (body.clearByokKey) apiKey = '';
          // SSRF：写入前校验 baseUrl（空串表示未配置，允许）
          const safeBaseUrl = assertSafeByokBaseUrl(body.byok.baseUrl || '');
          preferences.byok = {
            enabled: body.byok.enabled,
            baseUrl: safeBaseUrl,
            model: body.byok.model || '',
            format: body.byok.format || 'anthropic_messages',
            name: body.byok.name || 'BYOK',
            // 未提交 vision 时保留旧值，避免部分更新把用户的 vision:false 重置为 true
            vision: body.byok.vision !== undefined ? body.byok.vision : (prev.vision ?? true),
            // A-03：写入前静态加密，数据库不留明文 key；已是密文（解密失败保留）则原样入库
            apiKey: isEncryptedByokKey(apiKey) ? apiKey : apiKey ? encryptByokKey(apiKey) : '',
          } satisfies ByokConfig;
        }

        await prisma.user.update({
          where: { id: req.user!.id },
          data: { preferences: JSON.stringify(preferences) },
        });
        // R-11：偏好/BYOK 变更后主动失效 agent 用户上下文短缓存。
        // 跨服务边界：不直接依赖 agent 实现,经注入回调由宿主组合根转发。
        onPrefsChanged?.({ userId: req.user!.id });

        res.json({
          preferences: {
            agentStyle: preferences.agentStyle || 'professional',
            autoplayAnim: preferences.autoplayAnim ?? false,
            animSpeed: preferences.animSpeed ?? 1,
            byok: publicByok(preferences.byok),
          },
        });
      } catch (e) {
        next(e);
      }
    },
  );

  /** 测试当前 BYOK / 服务端配置是否可用 */
  settingsRouter.post('/test-llm', requireAuth, testLlmLimiter, async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      const preferences = parsePrefs(user?.preferences);
      // A-03：库中为密文，测试前先解密
      const byok = decryptByokConfig((preferences.byok as ByokConfig) || null) || undefined;
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
      // BYOK URL 策略拒绝：400（非上游故障）
      if (e instanceof AppError && e.code === 'BYOK_URL_REJECTED') {
        next(e);
        return;
      }
      // 上游 LLM 失败：给 502 与脱敏文案（A-01），与 agent llmError 语义一致。
      // TypeError = fetch 网络层失败（连不上/中断），同样视为上游问题而非服务器 bug（旧行为保持）。
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

  return settingsRouter;
}
