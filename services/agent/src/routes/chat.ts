/**
 * 面板对话：同步 + SSE（含 ReAct tool-loop）。从 agent 路由拆出。
 */
import type { RequestHandler, Router } from 'express';
import {
  logger,
  optionalAuth,
  validate,
  createSseSession,
  endSseSession,
  sseWrite,
} from '@core/foundation';
import { extractVisibleAnswer } from '@core/foundation';
import type { LlmResponse, ProviderConfig, StreamChunk } from '@core/contracts';
import { LLM_TOKEN_LIMITS } from '@core/contracts';
import { looksLikeHoverPlanning } from '@core/contracts';
import { chatSchema } from '../schemas.js';
import { createStreamConsumer } from '../lib/streamConsumers.js';
import { AGENT_MODE_META } from '../lib/agentPrompt.js';
import type { AgentRuntime } from '../runtime.js';
import { writeAgentSseError } from './agentSseHelpers.js';

export function mountChatRoutes(
  agentRouter: Router,
  runtime: AgentRuntime,
  agentChatLimiter: RequestHandler,
): void {
  const { toolLoop, orchestrator, deps } = runtime;
  const { llm } = deps;
  const { finalizeChatTurn, llmError, prepareChat } = orchestrator;

  agentRouter.post(
    '/chat',
    agentChatLimiter,
    optionalAuth,
    validate(chatSchema),
    async (req, res, next) => {
      try {
        const body = req.body as Parameters<typeof prepareChat>[0];
        const { provider, chain, style, mode, reactEnabled, conv, system, userContent } = await prepareChat(
          body,
          req.user?.id,
        );
        const limits = LLM_TOKEN_LIMITS[mode === 'fast' ? 'chatFast' : 'chatDeep'];

        if (reactEnabled) {
          let loopResult;
          try {
            loopResult = await toolLoop.runToolLoop({
              provider,
              system,
              userContent,
              maxTokens: limits.maxTokens,
              temperature: limits.temperature,
            });
          } catch (e) {
            throw llmError(e);
          }
          const answer = loopResult.answer || '抱歉，这一轮没有生成有效讲解，换个问法再试一次。';
          await finalizeChatTurn(conv.id, req.user?.id, body.message, answer, loopResult.thinking);
          res.json({
            reply: answer,
            thinking: loopResult.thinking,
            conversationId: conv.id,
            guestKey: conv.guestKey || undefined,
            model: loopResult.model,
            format: loopResult.format,
            style,
            providerId: provider.id,
            reasoningMode: 'react',
            toolIterations: loopResult.iterations,
            meta: AGENT_MODE_META.react,
          });
          return;
        }

        let result: LlmResponse;
        let servedBy: ProviderConfig;
        try {
          const r = await llm.callLlmWithFallback(
            {
              mode,
              maxTokens: limits.maxTokens,
              temperature: limits.temperature,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: userContent },
              ],
            },
            chain,
          );
          result = r.result;
          servedBy = r.provider;
        } catch (e) {
          throw llmError(e);
        }

        const visible = extractVisibleAnswer(result.thinking || '', result.text || '');
        if (visible.answer && looksLikeHoverPlanning(visible.answer)) {
          logger.warn({ event: 'deep_planning_leak', mode }, 'deep answer looks like planning');
        }
        const answer = visible.answer || '抱歉，这一轮没有生成有效讲解，换个问法再试一次。';
        await finalizeChatTurn(conv.id, req.user?.id, body.message, answer, visible.thinking);

        res.json({
          reply: answer,
          thinking: visible.thinking,
          conversationId: conv.id,
          guestKey: conv.guestKey || undefined,
          model: result.model,
          format: result.format,
          style,
          providerId: servedBy.id,
          reasoningMode: 'deep_teach',
          meta: mode === 'fast' ? AGENT_MODE_META.fast : AGENT_MODE_META.deep,
        });
      } catch (e) {
        next(e);
      }
    },
  );

  agentRouter.post(
    '/chat/stream',
    agentChatLimiter,
    optionalAuth,
    validate(chatSchema),
    async (req, res, _next) => {
      const sse = createSseSession(req, res);
      let llmStream: AsyncGenerator<StreamChunk, void, unknown> | undefined;
      try {
        const body = req.body as Parameters<typeof prepareChat>[0];
        const { provider, chain, style, mode, reactEnabled, conv, system, userContent } = await prepareChat(
          body,
          req.user?.id,
        );
        const limits = LLM_TOKEN_LIMITS[mode === 'fast' ? 'chatFast' : 'chatDeep'];

        if (reactEnabled) {
          sseWrite(res, {
            type: 'meta',
            model: provider.model,
            format: provider.format,
            providerId: provider.id,
            mode,
            style,
            conversationId: conv.id,
            guestKey: conv.guestKey || undefined,
            reasoningMode: 'react',
            meta: AGENT_MODE_META.react,
          });
          try {
            const loopResult = await toolLoop.runToolLoop({
              provider,
              system,
              userContent,
              maxTokens: limits.maxTokens,
              temperature: limits.temperature,
              signal: sse.signal,
              onEvent: (ev) => {
                if (sse.gone() || sse.signal.aborted) return;
                if (ev.type === 'tool_call') {
                  sseWrite(res, { type: 'tool_call', name: ev.name, args: ev.args });
                } else if (ev.type === 'tool_result') {
                  sseWrite(res, {
                    type: 'tool_result',
                    name: ev.name,
                    ok: ev.ok,
                    preview: ev.preview,
                  });
                } else if (ev.type === 'thinking') {
                  sseWrite(res, { type: 'thinking', text: ev.text });
                } else if (ev.type === 'delta') {
                  sseWrite(res, { type: 'delta', text: ev.text });
                }
              },
            });
            if (sse.gone() || sse.signal.aborted) return;
            const answer = loopResult.answer || '抱歉，这一轮没有生成有效讲解，换个问法再试一次。';
            await finalizeChatTurn(conv.id, req.user?.id, body.message, answer, loopResult.thinking);
            sseWrite(res, { type: 'final', answer, thinking: loopResult.thinking });
            sseWrite(res, { type: 'done' });
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return;
            if (sse.signal.aborted || sse.gone()) return;
            throw e;
          }
          return;
        }

        const consumer = createStreamConsumer({
          mode: mode === 'fast' ? 'fast' : 'deep',
          abort: () => sse.abort(),
          onStatus: () => sseWrite(res, { type: 'status', status: 'thinking' }),
          onThinking: (text) => sseWrite(res, { type: 'thinking', text }),
          onText: (text) => sseWrite(res, { type: 'delta', text }),
        });

        try {
          const resolved = await llm.resolveStreamWithFallback(
            {
              mode,
              maxTokens: limits.maxTokens,
              temperature: limits.temperature,
              signal: sse.signal,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: userContent },
              ],
            },
            chain,
          );
          const servedBy = resolved.provider;
          llmStream = resolved.stream;

          sseWrite(res, {
            type: 'meta',
            model: servedBy.model,
            format: servedBy.format,
            providerId: servedBy.id,
            mode,
            style,
            conversationId: conv.id,
            guestKey: conv.guestKey || undefined,
            reasoningMode: 'deep_teach',
            meta: mode === 'fast' ? AGENT_MODE_META.fast : AGENT_MODE_META.deep,
          });

          for await (const chunk of resolved.stream) {
            if (sse.gone() || sse.signal.aborted) {
              sse.abort();
              return;
            }
            if (consumer.handle(chunk) === 'break') break;
          }
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') return;
          if (sse.signal.aborted || sse.gone()) return;
          throw e;
        }

        if (sse.gone() || sse.signal.aborted) {
          return;
        }
        const { thinkingAcc, textAcc, safeThinking } = consumer.result();
        const visible = extractVisibleAnswer(thinkingAcc, textAcc);
        if (visible.answer && looksLikeHoverPlanning(visible.answer)) {
          logger.warn({ event: 'deep_planning_leak', mode }, 'deep answer looks like planning');
        }
        const answer = visible.answer || '抱歉，这一轮没有生成有效讲解，换个问法再试一次。';
        const thinking = safeThinking || visible.thinking;
        await finalizeChatTurn(conv.id, req.user?.id, body.message, answer, thinking);
        if (mode === 'fast') {
          sseWrite(res, { type: 'final', answer, thinking: '' });
        } else {
          sseWrite(res, {
            type: 'final',
            answer,
            thinking,
          });
        }
        sseWrite(res, { type: 'done' });
      } catch (e) {
        writeAgentSseError(sse, res, llm, e, '生成失败，请稍后重试');
      } finally {
        await endSseSession(sse, llmStream);
      }
    },
  );
}
