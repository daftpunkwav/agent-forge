/** tools 聚合导出 —— 全部为工厂形态(注入端口),由 runtime.ts 组装 */
export { parseToolCall, hasToolCall } from './parseToolCall.js';
export { createToolRegistry } from './registry.js';
export type { ToolRegistry } from './registry.js';
export { createToolLoop } from './toolLoop.js';
export type { RunToolLoopOpts, ToolLoopResult, ToolLoop } from './toolLoop.js';
export type { ParsedToolCall, ToolLoopEvent, ToolDefinition } from './types.js';
export { createGetArticleTool, GET_ARTICLE_MAX_CHARS } from './getArticle.js';
export { createSearchArticlesTool } from './searchArticles.js';
