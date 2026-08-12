import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import { assertSafeByokBaseUrl, isPrivateOrSpecialIpv4, isSafeByokBaseUrl } from './byokUrlPolicy.js';

describe('isPrivateOrSpecialIpv4', () => {
  it('识别环回与私网', () => {
    expect(isPrivateOrSpecialIpv4('127.0.0.1')).toBe(true);
    expect(isPrivateOrSpecialIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateOrSpecialIpv4('172.16.5.1')).toBe(true);
    expect(isPrivateOrSpecialIpv4('192.168.1.1')).toBe(true);
    expect(isPrivateOrSpecialIpv4('169.254.169.254')).toBe(true);
    expect(isPrivateOrSpecialIpv4('100.64.0.1')).toBe(true);
  });
  it('放行公网', () => {
    expect(isPrivateOrSpecialIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateOrSpecialIpv4('1.1.1.1')).toBe(false);
  });
});

describe('assertSafeByokBaseUrl', () => {
  it('空串放行', () => {
    expect(assertSafeByokBaseUrl('')).toBe('');
    expect(assertSafeByokBaseUrl('   ')).toBe('');
  });
  it('公网 https 放行并剥尾斜杠', () => {
    expect(assertSafeByokBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
  });
  it('公网 http 放行（兼容自建网关）', () => {
    expect(assertSafeByokBaseUrl('http://llm.example.com/v1')).toBe('http://llm.example.com/v1');
  });
  it('拒绝 localhost / 私网 / metadata', () => {
    const bad = [
      'http://127.0.0.1:8080',
      'http://localhost:3001',
      'https://192.168.0.1/v1',
      'http://10.0.0.5',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://foo.localhost/v1',
    ];
    for (const u of bad) {
      expect(() => assertSafeByokBaseUrl(u)).toThrow(AppError);
      expect(isSafeByokBaseUrl(u)).toBe(false);
    }
  });
  it('拒绝 IPv4-mapped IPv6(点分与十六进制两种归一化形式,防 SSRF 绕过)', () => {
    const bad = [
      'http://[::ffff:127.0.0.1]:8080/',
      'http://[::ffff:7f00:1]:8080/',
      'http://[::ffff:169.254.169.254]/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://[::ffff:10.0.0.5]/',
      'http://[::ffff:a00:5]/',
    ];
    for (const u of bad) {
      expect(() => assertSafeByokBaseUrl(u)).toThrow(AppError);
      expect(isSafeByokBaseUrl(u)).toBe(false);
    }
    // 公网 mapped 形式应放行
    expect(isSafeByokBaseUrl('http://[::ffff:8.8.8.8]:8080/')).toBe(true);
  });
  it('拒绝非 http(s) 与带凭证 URL', () => {
    expect(() => assertSafeByokBaseUrl('file:///etc/passwd')).toThrow(AppError);
    expect(() => assertSafeByokBaseUrl('https://user:pass@api.example.com')).toThrow(AppError);
    expect(() => assertSafeByokBaseUrl('not-a-url')).toThrow(AppError);
  });
});
