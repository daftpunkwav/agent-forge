import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { listPublicProviders, maskApiKey } from '../lib/llm/providers.js';
import { API_FORMATS, type ByokConfig } from '../lib/llm/types.js';

export const settingsRouter = Router();

const AGENT_STYLES = ['professional', 'friendly', 'sassy', 'concise', 'socratic'] as const;

const byokSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().max(500).optional().default(''),
  apiKey: z.string().max(500).optional().default(''),
  model: z.string().max(120).optional().default(''),
  format: z.enum(['anthropic_messages', 'openai_chat', 'openai_responses']).optional(),
  name: z.string().max(80).optional(),
  vision: z.boolean().optional(),
});

function parsePrefs(raw?: string | null): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function publicByok(byok: unknown) {
  const b = (byok || {}) as Partial<ByokConfig>;
  const key = typeof b.apiKey === 'string' ? b.apiKey : '';
  return {
    enabled: Boolean(b.enabled),
    baseUrl: b.baseUrl || '',
    model: b.model || '',
    format: b.format || 'anthropic_messages',
    name: b.name || 'BYOK',
    vision: b.vision !== false,
    apiKeyMasked: key ? maskApiKey(key) : '',
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
      serverProviders: listPublicProviders(),
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
        let apiKey = prev.apiKey || '';
        if (body.clearByokKey) apiKey = '';
        // 仅当提交了非空且非掩码占位时更新 key
        if (body.byok.apiKey && !body.byok.apiKey.includes('••••')) {
          apiKey = body.byok.apiKey;
        }
        preferences.byok = {
          enabled: body.byok.enabled,
          baseUrl: body.byok.baseUrl || '',
          model: body.byok.model || '',
          format: body.byok.format || 'anthropic_messages',
          name: body.byok.name || 'BYOK',
          vision: body.byok.vision !== false,
          apiKey,
        } satisfies ByokConfig;
      }

      await prisma.user.update({
        where: { id: req.user!.id },
        data: { preferences: JSON.stringify(preferences) },
      });

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
settingsRouter.post('/test-llm', requireAuth, async (req, res, next) => {
  try {
    const { callLlm, resolveProvider } = await import('../lib/llm/providers.js');
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    const preferences = parsePrefs(user?.preferences);
    const byok = preferences.byok as ByokConfig | undefined;
    const provider = resolveProvider(byok);
    if (!provider) {
      res.status(400).json({
        error: { code: 'NO_PROVIDER', message: '请先启用并填写完整的 BYOK，或配置服务端默认 Key' },
      });
      return;
    }
    const result = await callLlm(
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
    next(e);
  }
});
