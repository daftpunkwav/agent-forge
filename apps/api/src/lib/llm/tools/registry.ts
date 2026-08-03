/**
 * 白名单工具注册表：仅允许列出的工具名；参数经 Zod 校验。
 */
import { logger } from '../../logger.js';
import { getArticleTool } from './getArticle.js';
import { searchArticlesTool } from './searchArticles.js';
import type { ToolContext, ToolDefinition } from './types.js';

const TOOLS: ToolDefinition[] = [searchArticlesTool, getArticleTool];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function listToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

export function isAllowlistedTool(name: string): boolean {
  return BY_NAME.has(name);
}

export type ExecuteToolResult = {
  ok: boolean;
  observation: string;
  ms: number;
};

/**
 * 执行白名单工具：未知名 / Zod 失败 → observation 错误串，不抛。
 * 调用方应传入带超时的 AbortSignal。
 */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext = {},
): Promise<ExecuteToolResult> {
  const started = Date.now();
  const tool = BY_NAME.get(name);
  if (!tool) {
    const ms = Date.now() - started;
    logger.info({ event: 'tool_call', name, ok: false, ms, reason: 'not_allowlisted' }, 'tool denied');
    return {
      ok: false,
      observation: `Error: unknown or disallowed tool "${name}". Allowed: ${listToolNames().join(', ')}`,
      ms,
    };
  }

  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const ms = Date.now() - started;
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'args'}: ${i.message}`)
      .join('; ');
    logger.info({ event: 'tool_call', name, ok: false, ms, reason: 'invalid_args' }, 'tool args invalid');
    return {
      ok: false,
      observation: `Error: invalid args for ${name}: ${detail}`,
      ms,
    };
  }

  try {
    const observation = await tool.execute(parsed.data as never, ctx);
    const ms = Date.now() - started;
    logger.info({ event: 'tool_call', name, ok: true, ms }, 'tool ok');
    return { ok: true, observation, ms };
  } catch (err) {
    const ms = Date.now() - started;
    const timedOut =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError' || /aborted|timeout/i.test(err.message));
    logger.info(
      { event: 'tool_call', name, ok: false, ms, reason: timedOut ? 'timeout' : 'error' },
      'tool failed',
    );
    return {
      ok: false,
      observation: timedOut
        ? `Error: tool ${name} timed out`
        : `Error: tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      ms,
    };
  }
}
