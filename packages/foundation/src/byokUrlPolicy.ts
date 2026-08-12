/**
 * BYOK 出站 URL 策略（SSRF 防护）。
 * 仅约束用户可控的 BYOK baseUrl；服务端 env Provider 不受此限制。
 */
import { badRequest } from './errors.js';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

/** 是否为私有 / 链路本地 / 环回 / 特殊用途 IPv4 */
export function isPrivateOrSpecialIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16（含云 metadata）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 组播 / 保留
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::') return true;
  // fe80::/10 链路本地；fc00::/7 ULA；::ffff:127.0.0.1 等
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('::ffff:')) {
    // IPv4-mapped IPv6。URL.hostname 会把点分十进制归一化为十六进制压缩
    //（如 [::ffff:127.0.0.1] → [::ffff:7f00:1]），两种形式都要判定。
    const v4 = h.slice('::ffff:'.length);
    if (v4.includes('.')) {
      return isPrivateOrSpecialIpv4(v4);
    }
    // 十六进制形式：2 段 × 16bit → 还原为 4 段十进制再判定
    const hexParts = v4.split(':');
    if (hexParts.length === 2 && hexParts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) {
      const hi = hexParts[0].padStart(4, '0');
      const lo = hexParts[1].padStart(4, '0');
      const decoded = [
        parseInt(hi.slice(0, 2), 16),
        parseInt(hi.slice(2, 4), 16),
        parseInt(lo.slice(0, 2), 16),
        parseInt(lo.slice(2, 4), 16),
      ].join('.');
      return isPrivateOrSpecialIpv4(decoded);
    }
  }
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isPrivateOrSpecialIpv4(h)) return true;
  if (isBlockedIpv6(h)) return true;
  return false;
}

/**
 * 校验并规范化 BYOK baseUrl。
 * 空字符串视为「未配置」直接返回 ''。
 * 非法时抛 AppError(400, BYOK_URL_REJECTED)。
 */
export function assertSafeByokBaseUrl(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw badRequest('BYOK baseUrl 不是合法 URL', 'BYOK_URL_REJECTED');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw badRequest('BYOK baseUrl 仅允许 http 或 https', 'BYOK_URL_REJECTED');
  }

  // 禁止带用户名密码的 URL（防日志/代理泄漏）
  if (parsed.username || parsed.password) {
    throw badRequest('BYOK baseUrl 不允许包含用户名或密码', 'BYOK_URL_REJECTED');
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw badRequest('BYOK baseUrl 禁止指向本机、内网或元数据地址', 'BYOK_URL_REJECTED');
  }

  // 规范化：去掉尾斜杠，便于下游 resolve*Url
  return trimmed.replace(/\/+$/, '');
}

/** 不抛错版：供 Zod refine / 前端预检 */
export function isSafeByokBaseUrl(raw: string): boolean {
  try {
    assertSafeByokBaseUrl(raw);
    return true;
  } catch {
    return false;
  }
}
