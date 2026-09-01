import { describe, expect, it } from 'vitest';
import { providerApiKey, sealProvider } from './providerSecret.js';
import type { ProviderConfig } from './types.js';

const raw: ProviderConfig = {
  id: 'byok',
  name: 'BYOK',
  baseUrl: 'https://x.com',
  apiKey: 'sk-live-secret',
  model: 'm',
  format: 'anthropic_messages',
  vision: true,
};

describe('providerSecret', () => {
  it('封存后可枚举 apiKey 为空，JSON 不含明文', () => {
    const sealed = sealProvider(raw);
    expect(sealed.apiKey).toBe('');
    expect(JSON.stringify(sealed)).not.toContain('sk-live-secret');
    expect(providerApiKey(sealed)).toBe('sk-live-secret');
  });

  it('二次封存不丢失密钥', () => {
    const sealed = sealProvider(sealProvider(raw));
    expect(providerApiKey(sealed)).toBe('sk-live-secret');
  });

  it('测试用明文 Provider 仍可读', () => {
    expect(providerApiKey(raw)).toBe('sk-live-secret');
  });
});
