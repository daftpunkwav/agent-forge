/**
 * Agent 域 HTTP 路由。工厂注入 AgentRuntime——全部业务逻辑在 runtime 内,
 * 本文件只做 HTTP/SSE 适配与限流。
 */
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import {
  logger,
  validate,
  optionalAuth,
  requireAuth,
  requireRole,
  badRequest,
  createSseSession,
  endSseSession,
  sseWrite,
  softStreamHoverAnswer,
} from '@core/foundation';
import type { LlmResponse, ProviderConfig, StreamChunk } from '@core/contracts';
import { LLM_TOKEN_LIMITS } from '@core/contracts';
import { extractVisibleAnswer } from '@core/foundation';
import { chatSchema, explainSchemaFixed } from '../services/agentOrchestrator.js';
import {
  AGENT_MODE_META,
  extractHoverAnswer,
  isSafeHoverPublicAnswer,
  looksLikeHoverPlanning,
  isSystemEcho,
} from '../lib/agentPrompt.js';
import type { AgentRuntime } from '../runtime.js';

export function createAgentRouter(runtime: AgentRuntime): Router {
  const { deps, hoverCache, memory, toolLoop, orchestrator } = runtime;
  const { prisma, users, articles, llm } = deps;
  const {
    finalizeChatTurn,
    finalizeHoverAnswer,
    llmError,
    prepareChat,
    resolveHoverCacheHit,
    runExplain,
  } = orchestrator;

  const agentRouter = Router();

  // R-10：Agent 限流分桶——悬停（高频低成本，多命中缓存）与对话（低频高成本）隔离，
  // 避免悬停扫射耗尽对话配额；桶仍是 per-IP，全局并发由 R-02 舱壁兜底。
  const agentHoverLimiter = rateLimit({
    windowMs: 60_000,
    max: 90,
    message: { error: { code: 'RATE_LIMIT', message: '讲解请求过于频繁，请稍后再试' } },
  });
  const agentChatLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: { code: 'RATE_LIMIT', message: '对话请求过于频繁，请稍后再试' } },
  });
  const agentWriteLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: { code: 'RATE_LIMIT', message: '操作过于频繁，请稍后再试' } },
  });

  /** R-06：悬停缓存命中时的统一响应（同步路径） */
  function hoverCacheJson(body: { mode: 'hover' | 'click' }, style: string, cached: string) {
    return {
      explanation: cached,
      mode: body.mode,
      model: 'cache',
      format: 'cache',
      style,
      providerId: 'hover-cache',
      cached: true,
      meta: AGENT_MODE_META.fast,
    };
  }

  /** R-06：悬停缓存命中时的统一 SSE 事件序列 */
  function sseWriteHoverCache(
    res: Parameters<typeof sseWrite>[0],
    body: { mode: 'hover' | 'click' },
    style: string,
    cached: string,
  ) {
    sseWrite(res, {
      type: 'meta',
      model: 'cache',
      format: 'cache',
      providerId: 'hover-cache',
      mode: body.mode,
      style,
      cached: true,
      meta: AGENT_MODE_META.fast,
    });
    sseWrite(res, { type: 'final', answer: cached, thinking: '' });
    sseWrite(res, { type: 'done' });
  }

  agentRouter.get('/meta', (_req, res) => {
    res.json({
      modes: AGENT_MODE_META,
      formats: ['anthropic_messages', 'openai_chat', 'openai_responses'],
    });
  });

  /**
   * 清除悬停 Agent 服务端缓存（L2）。
   * 清除后所有卡片/气泡讲解均需重新调用 LLM，不再命中历史脏数据。
   */
  agentRouter.post('/cache/clear', agentWriteLimiter, requireAuth, requireRole('admin'), async (_req, res, next) => {
    try {
      const result = await prisma.hoverExplainCache.deleteMany({});
      res.json({
        ok: true,
        cleared: result.count,
        scope: 'hover-explain-l2',
        message: `已清除 ${result.count} 条悬停讲解缓存`,
      });
    } catch (e) {
      next(e);
    }
  });

  agentRouter.get('/providers', optionalAuth, async (req, res, next) => {
    try {
      let byokEnabled = false;
      if (req.user) {
        const prefs = await users.getUserPreferences(req.user.id);
        byokEnabled = Boolean(prefs?.byok?.enabled);
      }
      res.json({
        providers: llm.listPublicProviders(),
        defaultId: llm.getDefaultProvider()?.id || null,
        formats: ['anthropic_messages', 'openai_chat', 'openai_responses'],
        byokEnabled,
        modes: AGENT_MODE_META,
      });
    } catch (e) {
      next(e);
    }
  });

  agentRouter.post(
    '/explain',
    agentHoverLimiter,
    optionalAuth,
    validate(explainSchemaFixed),
    async (req, res, next) => {
      try {
        const body = req.body as Parameters<typeof runExplain>[0];

        // R-06：悬停先查缓存——命中即返回，不需要 LLM Provider；
        // 这样撤销 LLM 配置后，已缓存的讲解仍可服务（缓存即降级层）。
        const hit = await resolveHoverCacheHit(body);
        if (hit) {
          res.json(hoverCacheJson(body, hit.style, hit.answer));
          return;
        }

        const prep = await runExplain(body, req.user?.id);

        // 预查未命中：登录用户偏好风格可能覆盖默认，风格不同则按真实 style 再查一次
        const hit2 = await resolveHoverCacheHit(body, prep);
        if (hit2) {
          res.json(hoverCacheJson(body, hit2.style, hit2.answer));
          return;
        }

        let result: LlmResponse;
        let servedBy: ProviderConfig;
        try {
          // R-04：沿主备链 failover（5xx/网络/超时/429/熔断 503 触发；4xx 配置错误直接抛）
          const r = await llm.callLlmWithFallback(
            {
              mode: prep.isHover ? 'fast' : 'deep',
              maxTokens: prep.isHover ? 220 : 2048,
              temperature: prep.isHover ? 0.15 : undefined,
              messages: [
                { role: 'system', content: prep.system },
                { role: 'user', content: prep.userMsg },
              ],
            },
            prep.chain,
          );
          result = r.result;
          servedBy = r.provider;
        } catch (e) {
          throw llmError(e);
        }
        let explanation = prep.isHover
          ? extractHoverAnswer(result.thinking || '', result.text || '')
          : extractVisibleAnswer(result.thinking || '', result.text || '').answer;
        if (prep.isHover) {
          // R-04：兜底重试打向实际服务者——failover 后链首可能正故障，打链首会再次失败
          explanation = await finalizeHoverAnswer(servedBy, prep.userMsg, explanation);
          if (explanation) void hoverCache.setHoverCache(prep.topic, prep.style, explanation);
        } else if (explanation && looksLikeHoverPlanning(explanation)) {
          // A-04：deep 正文命中策划特征时留痕（深度讲解允许较长，不强制清空）
          logger.warn({ event: 'deep_planning_leak', mode: body.mode }, 'deep answer looks like planning');
        }
        void memory.rememberTopic(req.user?.id, prep.topic, body.mode);
        res.json({
          explanation,
          mode: body.mode,
          model: result.model,
          format: result.format,
          style: prep.style,
          providerId: servedBy.id,
          cached: false,
          meta: prep.isHover ? AGENT_MODE_META.fast : AGENT_MODE_META.deep,
        });
      } catch (e) {
        next(e);
      }
    },
  );

  agentRouter.post(
    '/explain/stream',
    agentHoverLimiter,
    optionalAuth,
    validate(explainSchemaFixed),
    async (req, res, _next) => {
      // SSE 会话（R-05）：initSse + 心跳 + 客户端断开自动 abort 上游；
      // 缓存命中 / 流完成 / 出错一律 endSseSession 收尾（B-10 单点化）
      const sse = createSseSession(req, res);
      let llmStream: AsyncGenerator<StreamChunk, void, unknown> | undefined;
      let servedBy: ProviderConfig | undefined;
      try {
        const body = req.body as Parameters<typeof runExplain>[0];

        // R-06：同 /explain——缓存先于 Provider，命中即流式返回缓存
        const hit = await resolveHoverCacheHit(body);
        if (hit) {
          sseWriteHoverCache(res, body, hit.style, hit.answer);
          await endSseSession(sse);
          return;
        }

        const prep = await runExplain(body, req.user?.id);

        // 预查未命中：登录用户偏好风格可能覆盖默认，风格不同则按真实 style 再查一次
        const hit2 = await resolveHoverCacheHit(body, prep);
        if (hit2) {
          sseWriteHoverCache(res, body, hit2.style, hit2.answer);
          await endSseSession(sse);
          return;
        }

        let thinkingAcc = '';
        let textAcc = '';
        // I3：仅累积通过 per-delta 门控的安全思考片段，final 用它保持流式/最终一致
        let safeThinking = '';
        /**
         * 悬停硬规则：
         * 1) 生成过程中：thinking/text 只服务端累计，客户端只收 status:thinking
         * 2) 累计中周期性 extract；一旦得到 ≥2 句安全讲解 → 早停上游 LLM
         * 3) 结束后仍空 → 极简重试一次；再空则 final.answer=""（前端失败态）
         * 4) 仅把安全讲解 soft-stream 为 delta；final.thinking 恒 ""
         */
        let lastHoverStatusAt = 0;
        let lastProbeAt = 0;
        let lastProbeLen = 0;
        let earlyAnswer = '';

        // R-04：流式 failover——首个 chunk 前失败可换备选；已产出 chunk 后不再切换（避免双份内容）
        const resolved = await llm.resolveStreamWithFallback(
          {
            mode: prep.isHover ? 'fast' : 'deep',
            maxTokens: prep.isHover ? 220 : 2048,
            temperature: prep.isHover ? 0.15 : undefined,
            // I2：统一挂 sse.signal——hover 用于早停，click/deep 用于客户端断开时取消上游
            signal: sse.signal,
            messages: [
              { role: 'system', content: prep.system },
              { role: 'user', content: prep.userMsg },
            ],
          },
          prep.chain,
        );
        servedBy = resolved.provider;
        llmStream = resolved.stream;

        sseWrite(res, {
          type: 'meta',
          model: servedBy.model,
          format: servedBy.format,
          providerId: servedBy.id,
          mode: body.mode,
          style: prep.style,
          meta: prep.isHover ? AGENT_MODE_META.fast : AGENT_MODE_META.deep,
        });

        const emitHoverThinkingStatus = () => {
          const now = Date.now();
          if (now - lastHoverStatusAt < 100) return;
          lastHoverStatusAt = now;
          sseWrite(res, { type: 'status', status: 'thinking' });
        };

        const probeEarlyAnswer = () => {
          if (!prep.isHover || earlyAnswer) return;
          const total = thinkingAcc.length + textAcc.length;
          const now = Date.now();
          if (now - lastProbeAt < 220 && total - lastProbeLen < 60) return;
          lastProbeAt = now;
          lastProbeLen = total;
          const candidate = extractHoverAnswer(thinkingAcc, textAcc);
          // 早停要求至少 2 句，避免半截单句抢跑
          const n = (candidate.match(/[。！]/g) || []).length;
          if (candidate && n >= 2 && isSafeHoverPublicAnswer(candidate)) {
            earlyAnswer = candidate;
            // B-06：早停命中打点（省 token 的可观测性）
            logger.info(
              { event: 'hover_early_stop', topic: prep.topic.slice(0, 60), chars: total },
              'hover early stop',
            );
            sse.abort();
          }
        };

        try {
          for await (const chunk of resolved.stream) {
            if (sse.gone()) {
              sse.abort();
              return;
            }
            if (earlyAnswer) break;
            if (chunk.kind === 'thinking') {
              thinkingAcc += chunk.text;
              if (prep.isHover) {
                emitHoverThinkingStatus();
                probeEarlyAnswer();
              } else {
                // A-04：思考片段命中 system 规则复述不回传客户端（final 门控是兜底，流式先拦）
                if (isSystemEcho(chunk.text)) {
                  logger.warn({ event: 'thinking_echo_blocked' }, 'thinking echo chunk dropped');
                  continue;
                }
                safeThinking += chunk.text;
                sseWrite(res, { type: 'thinking', text: chunk.text });
              }
            } else {
              textAcc += chunk.text;
              if (prep.isHover) {
                emitHoverThinkingStatus();
                probeEarlyAnswer();
              } else {
                sseWrite(res, { type: 'delta', text: chunk.text });
              }
            }
          }
        } catch (e) {
          // 早停 abort 为预期；其它错误上抛到外层
          if (!(e instanceof Error && e.name === 'AbortError') && !earlyAnswer && !sse.signal.aborted) {
            throw e;
          }
        }
        // 早停（hover）正是通过 sse.abort() 触发的，此处不能以 aborted 为返回条件；
        // 客户端断开由 writableEnded/destroyed 判定（I2 已让 click 模式信号达上游）
        if (sse.gone()) {
          return;
        }
        if (prep.isHover) {
          // R-04：兜底重试打向实际服务者——failover 后链首可能正故障，打链首会再次失败
          const answer = await finalizeHoverAnswer(
            servedBy,
            prep.userMsg,
            earlyAnswer || extractHoverAnswer(thinkingAcc, textAcc),
            () => sseWrite(res, { type: 'status', status: 'thinking' }),
          );
          if (answer) {
            void hoverCache.setHoverCache(prep.topic, prep.style, answer);
            await softStreamHoverAnswer(res, answer, 36);
          }
          sseWrite(res, {
            type: 'final',
            answer: answer || '',
            thinking: '',
            complete: Boolean(answer),
          });
        } else {
          const visible = extractVisibleAnswer(thinkingAcc, textAcc);
          // A-04：deep 正文命中策划特征时留痕（不强制清空）
          if (visible.answer && looksLikeHoverPlanning(visible.answer)) {
            logger.warn(
              { event: 'deep_planning_leak', mode: body.mode },
              'deep answer looks like planning',
            );
          }
          sseWrite(res, {
            type: 'final',
            answer: visible.answer,
            // I3：final 用流式中已过 per-delta 门控的安全 thinking，
            // 避免整串 isSystemEcho 把已展示的合法思考一并清空
            thinking: safeThinking,
          });
        }
        sseWrite(res, { type: 'done' });
        void memory.rememberTopic(req.user?.id, prep.topic, body.mode);
      } catch (e) {
        if (!(e instanceof Error && e.name === 'AbortError') && !sse.gone()) {
          // A-01：SSE 错误消息只发安全文案，不泄露 url/raw
          const message = llm.isLlmCallError(e) ? e.messageForClient : '讲解生成失败，请稍后重试';
          sseWrite(res, { type: 'error', message });
        }
      } finally {
        // B-10：统一收尾——停心跳/解绑、关闭未消费完的流（释放舱壁名额）、res.end 防重
        await endSseSession(sse, llmStream);
      }
    },
  );

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
          // R-04：沿主备链 failover
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
        // A-04：deep 正文命中策划特征时留痕（不强制清空）
        if (visible.answer && looksLikeHoverPlanning(visible.answer)) {
          logger.warn({ event: 'deep_planning_leak', mode }, 'deep answer looks like planning');
        }
        // A-04 兜底：answer 被规则复述门控清空时不回传空回复、不持久化空消息
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
      // SSE 会话（R-05）：initSse + 心跳 + 客户端断开自动 abort 上游；
      // react / deep 分支及所有提前退出路径统一 endSseSession 收尾
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
          // react 分支同样先下发 meta：前端 onMeta 依赖其中的 conversationId/guestKey
          // 维持多轮会话连续性；tool-loop 固定链首 provider（无 failover 解析阶段），可直接下发
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

        let thinkingAcc = '';
        let textAcc = '';
        // I3：仅累积通过 per-delta 门控的安全思考片段，final 用它保持流式/最终一致
        let safeThinking = '';

        try {
          // R-04：流式 failover——首个 chunk 前失败可换备选；已产出 chunk 后不再切换
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
            // 客户端已断开：停止生成，且不入库
            if (sse.gone() || sse.signal.aborted) {
              sse.abort();
              return;
            }
            if (chunk.kind === 'thinking') {
              thinkingAcc += chunk.text;
              if (mode === 'fast') {
                sseWrite(res, { type: 'status', status: 'thinking' });
              } else {
                // A-04：思考片段命中 system 规则复述不回传客户端（final 门控是兜底，流式先拦）
                if (isSystemEcho(chunk.text)) {
                  logger.warn({ event: 'thinking_echo_blocked' }, 'thinking echo chunk dropped');
                  continue;
                }
                safeThinking += chunk.text;
                sseWrite(res, { type: 'thinking', text: chunk.text });
              }
            } else {
              textAcc += chunk.text;
              if (mode === 'fast') {
                sseWrite(res, { type: 'status', status: 'thinking' });
              } else {
                sseWrite(res, { type: 'delta', text: chunk.text });
              }
            }
          }
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') return;
          if (sse.signal.aborted || sse.gone()) return;
          throw e;
        }

        if (sse.gone() || sse.signal.aborted) {
          return;
        }
        const visible = extractVisibleAnswer(thinkingAcc, textAcc);
        // A-04：deep 正文命中策划特征时留痕（不强制清空）
        if (visible.answer && looksLikeHoverPlanning(visible.answer)) {
          logger.warn({ event: 'deep_planning_leak', mode }, 'deep answer looks like planning');
        }
        // A-04 兜底：answer 被规则复述门控清空时不回传空回复、不持久化空消息
        const answer = visible.answer || '抱歉，这一轮没有生成有效讲解，换个问法再试一次。';
        // I3：final 用流式中已过门控的安全 thinking，避免整串 isSystemEcho 误清已展示的合法思考
        const thinking = safeThinking || visible.thinking;
        // I5：先持久化再发 final/done——done 之后客户端已视为结束，
        // persist 失败若再发 error 会用错误文案覆盖已交付的正确答案
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
        if (!(e instanceof Error && e.name === 'AbortError') && !sse.gone()) {
          // A-01：SSE 错误消息只发安全文案，不泄露 url/raw
          const message = llm.isLlmCallError(e) ? e.messageForClient : '生成失败，请稍后重试';
          sseWrite(res, { type: 'error', message });
        }
      } finally {
        // B-10：统一收尾——停心跳/解绑、关闭未消费完的流（释放舱壁名额）、res.end 防重
        await endSseSession(sse, llmStream);
      }
    },
  );

  agentRouter.get('/memory', requireAuth, async (req, res, next) => {
    try {
      const items = await prisma.agentMemory.findMany({
        where: { userId: req.user!.id },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });
      res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  agentRouter.post(
    '/memory',
    agentWriteLimiter,
    requireAuth,
    validate(
      z.object({
        key: z.string().min(1).max(120),
        value: z.string().min(1).max(2000),
        kind: z.string().max(40).optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        const { key, value, kind } = req.body as { key: string; value: string; kind?: string };
        const item = await prisma.agentMemory.upsert({
          where: { userId_key: { userId: req.user!.id, key } },
          create: { userId: req.user!.id, key, value, kind: kind || 'fact' },
          update: { value, kind: kind || 'fact' },
        });
        res.json({ item });
      } catch (e) {
        next(e);
      }
    },
  );

  agentRouter.post(
    '/progress',
    agentWriteLimiter,
    requireAuth,
    validate(
      z.object({
        articleSlug: z.string().min(1),
        progress: z.number().min(0).max(1).optional(),
        mastery: z.enum(['not_started', 'learning', 'mastered']).optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        const body = req.body as {
          articleSlug: string;
          progress?: number;
          mastery?: string;
        };
        // 跨服务边界：文章校验经 content 端口(任意状态,与旧版 prisma.article.findUnique 语义一致)
        const article = await articles.getArticleMetaBySlug(body.articleSlug);
        if (!article) throw badRequest('文章不存在');
        const existing = await prisma.learningProgress.findUnique({
          where: { userId_articleId: { userId: req.user!.id, articleId: article.id } },
        });
        const nextProgress =
          body.progress == null
            ? (existing?.progress ?? 0.3)
            : Math.max(existing?.progress ?? 0, body.progress);
        // mastered 不可降级；其余以请求为准（缺省保留或 learning）
        let nextMastery = body.mastery || existing?.mastery || 'learning';
        if (existing?.mastery === 'mastered' && nextMastery !== 'mastered') {
          nextMastery = 'mastered';
        }
        const item = await prisma.learningProgress.upsert({
          where: {
            userId_articleId: { userId: req.user!.id, articleId: article.id },
          },
          create: {
            userId: req.user!.id,
            articleId: article.id,
            progress: body.progress ?? 0.3,
            mastery: body.mastery || 'learning',
          },
          update: {
            progress: nextProgress,
            mastery: nextMastery,
          },
        });
        if (nextMastery === 'mastered') {
          await prisma.agentMemory.upsert({
            where: {
              userId_key: { userId: req.user!.id, key: `mastered:${article.slug}` },
            },
            create: {
              userId: req.user!.id,
              key: `mastered:${article.slug}`,
              value: `已掌握文章《${article.title}》`,
              kind: 'skill',
            },
            update: { value: `已掌握文章《${article.title}》`, kind: 'skill' },
          });
        }
        res.json({ item });
      } catch (e) {
        next(e);
      }
    },
  );

  return agentRouter;
}
