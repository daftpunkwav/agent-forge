import type { z } from 'zod';

/** 工具执行上下文（预留扩展：userId / abort） */
export type ToolContext = {
  signal?: AbortSignal;
};

/** 注册表统一用 ZodTypeAny，避免具体 schema 泛型方差问题 */
export type ToolDefinition = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  execute: (args: never, ctx: ToolContext) => Promise<string>;
};

export type ParsedToolCall = {
  name: string;
  args: unknown;
};

export type ToolLoopEvent =
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; preview?: string }
  | { type: 'thinking'; text: string }
  | { type: 'delta'; text: string };
