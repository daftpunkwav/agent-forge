/**
 * 从模型输出中解析 prompt-based TOOL_CALL 行。
 * 协议：单独一行 `TOOL_CALL: {"name":"...","args":{...}}`
 */
import type { ParsedToolCall } from './types.js';

const TOOL_CALL_LINE = /TOOL_CALL:\s*(\{[^\n]*\})/;

export function parseToolCall(text: string): ParsedToolCall | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const m = raw.match(TOOL_CALL_LINE);
  if (!m?.[1]) return null;
  try {
    const obj = JSON.parse(m[1]) as { name?: unknown; args?: unknown };
    if (typeof obj.name !== 'string' || !obj.name.trim()) return null;
    return {
      name: obj.name.trim(),
      args: obj.args ?? {},
    };
  } catch {
    return null;
  }
}

/** 若含 TOOL_CALL 则视为工具轮，不应当最终答案展示 */
export function hasToolCall(text: string): boolean {
  return parseToolCall(text) != null;
}
