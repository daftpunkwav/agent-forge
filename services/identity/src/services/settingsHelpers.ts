import { z } from 'zod';
import { decryptByokConfig } from '@core/foundation';
import type { ByokConfig } from '@core/contracts';
import type { LlmGatewayPort } from '@core/contracts';

export const AGENT_STYLES = ['professional', 'friendly', 'sassy', 'concise', 'socratic'] as const;

export const byokSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().max(500).optional().default(''),
  apiKey: z.string().max(500).optional().default(''),
  model: z.string().max(120).optional().default(''),
  format: z.enum(['anthropic_messages', 'openai_chat', 'openai_responses']).optional(),
  name: z.string().max(80).optional(),
  vision: z.boolean().optional(),
});

export const AGENT_STYLE_LABELS: Record<string, string> = {
  professional: '专业',
  friendly: '热情',
  sassy: '毒舌',
  concise: '简洁',
  socratic: '苏格拉底',
};

export function publicByokView(byok: unknown, llm: LlmGatewayPort) {
  const b = (byok || {}) as Partial<ByokConfig>;
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
  };
}
