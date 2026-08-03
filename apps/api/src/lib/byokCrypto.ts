/**
 * BYOK apiKey 静态加密（A-03）
 * - 用 AES-256-GCM 对称加密后存库（密文 + iv + tag 一并存储）
 * - 密钥优先取 BYOK_ENCRYPTION_KEY（≥16 字符），缺失时回退 JWT_SECRET 派生
 * - 兼容历史明文：非本格式前缀的旧数据原样返回（读取不炸，下次写入自动升级为密文）
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { ByokConfig } from './llm/types.js';
import { logger } from './logger.js';

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function key(): Buffer {
  const raw = process.env.BYOK_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error('BYOK_ENCRYPTION_KEY 或 JWT_SECRET 未配置（至少 16 字符）');
  }
  // 派生密钥：固定上下文字符串避免与 JWT 直接复用同一 key
  return createHash('sha256').update(`byok-encryption-v1:${raw}`).digest();
}

export function encryptByokKey(plain: string): string {
  if (!plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptByokKey(stored: string): string {
  if (!stored) return stored;
  // 历史明文数据（未加密）：原样返回，仅在新写入时自动升级为密文
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    const parts = stored.slice(PREFIX.length).split('.');
    if (parts.length !== 3) return '';
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (e) {
    // 解密失败（密钥变更等）：视为无 key，绝不把密文当明文外泄
    logger.warn({ err: String(e) }, 'BYOK key decrypt failed');
    return '';
  }
}

/** 解密 BYOK 配置中的 apiKey（浅拷贝，不改动原对象） */
export function decryptByokConfig(byok?: ByokConfig | null): ByokConfig | null {
  if (!byok || !byok.apiKey) return byok ?? null;
  return { ...byok, apiKey: decryptByokKey(byok.apiKey) };
}

/**
 * 设置保存时取「应入库的明文 key」：旧值可能是密文（A-03 后）也可能是历史明文。
 * 二次保存（留空不修改）时必须先解密，否则会对密文再加密，导致 BYOK 静默失效。
 */
export function resolveByokApiKeyToStore(prevApiKey: string | undefined, submitted: string): string {
  const prev = decryptByokKey(prevApiKey || '');
  return submitted && !submitted.includes('••••') ? submitted : prev;
}
