import { Router } from 'express';
import { z } from 'zod';
import {
  validate,
  requireAuth,
  parsePrefs,
  encryptByokKey,
  isEncryptedByokKey,
  resolveByokApiKeyToStore,
  assertSafeByokBaseUrl,
} from '@core/foundation';
import { API_FORMATS, type ByokConfig } from '@core/contracts';
import type { PrismaClient } from '@prisma/client';
import type { LlmGatewayPort } from '@core/contracts';
import {
  AGENT_STYLES,
  AGENT_STYLE_LABELS,
  byokSchema,
  publicByokView,
} from '../services/settingsHelpers.js';
import { mountSettingsTestLlmRoutes } from './settingsTestLlm.js';

export function createSettingsRouter(deps: {
  prisma: PrismaClient;
  llm: LlmGatewayPort;
  onPrefsChanged?: (info: { userId: string }) => void;
}): Router {
  const { prisma, llm, onPrefsChanged } = deps;
  const settingsRouter = Router();

  settingsRouter.get('/me', requireAuth, async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      const preferences = parsePrefs(user?.preferences);
      res.json({
        preferences: {
          agentStyle: preferences.agentStyle || 'professional',
          autoplayAnim: preferences.autoplayAnim ?? false,
          animSpeed: preferences.animSpeed ?? 1,
          byok: publicByokView(preferences.byok, llm),
        },
        agentStyles: AGENT_STYLES.map((id) => ({
          id,
          label: AGENT_STYLE_LABELS[id] || id,
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
          let apiKey = resolveByokApiKeyToStore(prev.apiKey, body.byok.apiKey || '');
          if (body.clearByokKey) apiKey = '';
          const safeBaseUrl = assertSafeByokBaseUrl(body.byok.baseUrl || '');
          preferences.byok = {
            enabled: body.byok.enabled,
            baseUrl: safeBaseUrl,
            model: body.byok.model || '',
            format: body.byok.format || 'anthropic_messages',
            name: body.byok.name || 'BYOK',
            vision: body.byok.vision !== undefined ? body.byok.vision : (prev.vision ?? true),
            apiKey: isEncryptedByokKey(apiKey) ? apiKey : apiKey ? encryptByokKey(apiKey) : '',
          } satisfies ByokConfig;
        }

        await prisma.user.update({
          where: { id: req.user!.id },
          data: { preferences: JSON.stringify(preferences) },
        });
        onPrefsChanged?.({ userId: req.user!.id });

        res.json({
          preferences: {
            agentStyle: preferences.agentStyle || 'professional',
            autoplayAnim: preferences.autoplayAnim ?? false,
            animSpeed: preferences.animSpeed ?? 1,
            byok: publicByokView(preferences.byok, llm),
          },
        });
      } catch (e) {
        next(e);
      }
    },
  );

  mountSettingsTestLlmRoutes(settingsRouter, { prisma, llm });

  return settingsRouter;
}
