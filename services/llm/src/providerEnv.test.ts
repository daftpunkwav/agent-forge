import { describe, expect, it } from 'vitest';
import { buildProvidersFromEnv, resetProviderCache } from './providerEnv.js';

describe('providerEnv', () => {
  it('无 env 时 buildProvidersFromEnv 返回空数组', () => {
    const prev = { ...process.env };
    delete process.env.STEPFUN_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GENERIC_LLM_API_KEY;
    resetProviderCache();
    expect(buildProvidersFromEnv()).toEqual([]);
    process.env = prev;
    resetProviderCache();
  });
});
