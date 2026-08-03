/**
 * BYOK apiKey 静态加密（A-03）回归：roundtrip、明文兼容、解密失败安全降级。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptByokConfig,
  decryptByokKey,
  encryptByokKey,
  resolveByokApiKeyToStore,
} from './byokCrypto.js';

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-for-byok-crypto-0123456789';
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  delete process.env.BYOK_ENCRYPTION_KEY;
});

describe('byokCrypto', () => {
  it('roundtrip：加密后非明文，解密恢复原文', () => {
    const plain = 'sk-ant-1234567890abcdef';
    const enc = encryptByokKey(plain);
    expect(enc).not.toBe(plain);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(decryptByokKey(enc)).toBe(plain);
  });
  it('空 key 原样返回', () => {
    expect(encryptByokKey('')).toBe('');
    expect(decryptByokKey('')).toBe('');
  });
  it('历史明文数据兼容：原样返回，不炸读取路径', () => {
    expect(decryptByokKey('sk-plain-old')).toBe('sk-plain-old');
  });
  it('非法密文解密失败 → 返回空串，绝不外泄密文', () => {
    expect(decryptByokKey('enc:v1:not-a-valid-cipher')).toBe('');
    expect(decryptByokKey('enc:v1:!!!.!!!.!!!')).toBe('');
  });
  it('decryptByokConfig 浅拷贝解密 apiKey', () => {
    const cfg = {
      enabled: true,
      baseUrl: 'https://x.com',
      apiKey: encryptByokKey('sk-cfg'),
      model: 'm',
      format: 'anthropic_messages' as const,
    };
    const out = decryptByokConfig(cfg);
    expect(out?.apiKey).toBe('sk-cfg');
    expect(out).not.toBe(cfg);
    expect(cfg.apiKey).toContain('enc:v1:'); // 原对象不被污染
  });
  it('无 JWT_SECRET / BYOK_ENCRYPTION_KEY 时抛错（与 JWT 校验一致）', () => {
    delete process.env.JWT_SECRET;
    expect(() => encryptByokKey('sk-123')).toThrow('BYOK_ENCRYPTION_KEY 或 JWT_SECRET 未配置');
  });
  it('密钥轮换：A 加密 B 解密 → 空串不崩溃（BYOK 静默回退服务端默认）', () => {
    const enc = encryptByokKey('sk-rotate-me');
    process.env.JWT_SECRET = 'another-secret-key-for-rotation-0987654321';
    expect(decryptByokKey(enc)).toBe('');
  });
});

describe('resolveByokApiKeyToStore（C1 回归：设置二次保存不得对密文再加密）', () => {
  it('旧值已是密文 + 留空提交 → 解密回明文供重新加密', () => {
    const enc = encryptByokKey('sk-original');
    expect(resolveByokApiKeyToStore(enc, '')).toBe('sk-original');
  });
  it('旧值是历史明文 + 留空提交 → 原样返回', () => {
    expect(resolveByokApiKeyToStore('sk-plain-old', '')).toBe('sk-plain-old');
  });
  it('提交新 key → 使用新 key（覆盖旧值）', () => {
    const enc = encryptByokKey('sk-original');
    expect(resolveByokApiKeyToStore(enc, 'sk-new-key')).toBe('sk-new-key');
  });
  it('提交掩码占位（前端留空占位）→ 保留旧明文', () => {
    const enc = encryptByokKey('sk-original');
    expect(resolveByokApiKeyToStore(enc, '••••')).toBe('sk-original');
  });
  it('无旧值 + 空提交 → 空串', () => {
    expect(resolveByokApiKeyToStore('', '')).toBe('');
  });
});
