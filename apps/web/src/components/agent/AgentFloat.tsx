import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAgentStyle } from '@/hooks/useAgentStyle';
import { useAgentPanel } from '@/hooks/useAgentPanel';
import { AGENT_CACHE_CLEARED_EVENT } from '@/lib/hoverExplainCache';
import {
  agentSuspended,
  IncompleteHoverKeys,
  peekHoverSessionCache,
  runHoverExplainStream,
} from '@/lib/hoverExplainSession';
import { MarkdownView } from './MarkdownView';
import { findHoverTarget, highlightTarget, isKnowledgeRoute } from './hoverTarget';

type HoverTipState = {
  x: number;
  y: number;
  text: string;
  loading?: boolean;
  topic?: string;
  /** visible = 渐入展示；leaving = 渐出 */
  anim: 'visible' | 'leaving';
};

/**
 * 快速 Agent（悬停）vs Agent 助手（面板）
 * - 快速：悬停即后台预取，约 0.7s 揭示；不展示思考过程；按句流式
 * - 助手：Deep 结构化详解，思考默认收起（逻辑在 useAgentPanel）
 */
export function AgentFloat() {
  const [open, setOpen] = useState(false);
  const [hoverTip, setHoverTip] = useState<HoverTipState | null>(null);
  /** 双 rAF 触发 CSS 渐入，避免 mount 时已带 visible 无动画 */
  const [tipEntered, setTipEntered] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const style = useAgentStyle('professional');
  const location = useLocation();
  const {
    messages,
    input,
    setInput,
    busy,
    deepExplain,
    send,
    toggleThinking,
    toolsEnabled,
    setToolsEnabled,
  } = useAgentPanel({ style, route: location.pathname });

  const ref = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  /** 目标稳定 debounce（防嵌套元素抖动） */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 满约 0.7s 才展示气泡 */
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEl = useRef<HTMLElement | null>(null);
  /** 未完成请求：禁止把半截当缓存命中（与共享 L1 配合）；B-11：带 TTL */
  const incompleteKeys = useRef(new IncompleteHoverKeys());
  const abortRef = useRef<AbortController | null>(null);
  const tipPinned = useRef(false);
  /** 当前会话：后台已预取，是否已过揭示延迟可展示 */
  const sessionRef = useRef<{
    gen: number;
    /** 请求/缓存 key（style::topic） */
    key: string;
    /** 稳定身份（跨 DOM 重绘） */
    stableKey: string;
    text: string;
    context?: string;
    sectionId?: string;
    topic: string;
    x: number;
    y: number;
    buffer: string;
    revealed: boolean;
    loading: boolean;
    /** 是否已收到完整 final（未完成禁止缓存/复用） */
    complete: boolean;
    /** 气泡首次展示时间戳，用于最短「思考中」展示 */
    revealAt: number;
    el: HTMLElement;
  } | null>(null);
  const genRef = useRef(0);
  /** 全局串行：同一时间只允许一个 hover 请求 */
  const inflightKeyRef = useRef<string | null>(null);
  /** 最近请求时间戳，防扫射 */
  const lastRequestAt = useRef(0);
  /** 短窗内请求计数 */
  const requestWindow = useRef<{ t0: number; n: number }>({ t0: 0, n: 0 });

  const HOVER_SETTLE_MS = 60;
  /** 悬停满 ~0.7s 显示气泡（后台立即预取） */
  const HOVER_REVEAL_MS = 700;
  /** 气泡出现后最短「思考中」；尽量短以提升体感 */
  const HOVER_MIN_THINK_MS = 160;
  /** 移出后保留 3s；指针在对话框内不消失 */
  const HOVER_LEAVE_KEEP_MS = 3000;
  const FADE_MS = 180;
  const cacheRevealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 新目标请求最小间隔 */
  const REQUEST_COOLDOWN_MS = 280;
  /** 10s 内最多 N 次新请求 */
  const MAX_REQUESTS_PER_WINDOW = 8;
  const REQUEST_WINDOW_MS = 10_000;

  /** 设置页「清除 Agent 缓存」：清空半截标记 / 中断悬停流（L1 由 clearAllHoverCaches 清） */
  useEffect(() => {
    function onCacheCleared() {
      incompleteKeys.current.clear();
      inflightKeyRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
      genRef.current += 1;
      sessionRef.current = null;
      setHoverTip(null);
    }
    window.addEventListener(AGENT_CACHE_CLEARED_EVENT, onCacheCleared);
    return () => window.removeEventListener(AGENT_CACHE_CLEARED_EVENT, onCacheCleared);
  }, []);

  /**
   * 视口坐标放置（position:fixed）。
   * 位置只在锚定瞬间计算一次，之后冻结，不随鼠标移动/页面滚动改写。
   */
  const placeTip = useCallback((x: number, y: number, contentLen: number) => {
    const maxW = Math.min(420, window.innerWidth - 24);
    const minW = Math.min(280, maxW);
    const estH = Math.min(360, Math.max(120, 80 + Math.ceil(contentLen / 40) * 18));
    let left = x + 12;
    let top = y + 12;
    if (left + maxW > window.innerWidth - 8) left = Math.max(8, x - maxW - 12);
    if (top + estH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - estH - 12);
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    return { left, top, maxW, minW, maxH: Math.min(360, window.innerHeight - 24) };
  }, []);

  /** 相对悬停目标元素计算锚定点（视口坐标） */
  function anchorNearTarget(
    el: HTMLElement | null,
    pointerX: number,
    pointerY: number,
  ): { x: number; y: number } {
    if (el && el.isConnected) {
      const r = el.getBoundingClientRect();
      // 优先目标右下方；窄元素用指针附近但仍贴目标
      const x = r.left + Math.min(Math.max(r.width * 0.55, 24), Math.max(r.width - 4, 24));
      const y = r.bottom + 4;
      // 目标已滚出视口时退回指针位置
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
        return { x: pointerX, y: pointerY };
      }
      return { x, y };
    }
    return { x: pointerX, y: pointerY };
  }

  const tipBox = useMemo(() => {
    if (!hoverTip) return null;
    // 使用冻结的 x/y（锚定后不再改）
    return placeTip(hoverTip.x, hoverTip.y, hoverTip.text.length);
  }, [hoverTip, placeTip]);

  useEffect(() => {
    if (!hoverTip || hoverTip.anim === 'leaving') {
      setTipEntered(false);
      return;
    }
    setTipEntered(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setTipEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [hoverTip?.anim, hoverTip?.topic, Boolean(hoverTip)]);

  function clearLeaveTimer() {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }

  function clearSettleTimer() {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }

  function clearRevealTimer() {
    if (revealTimer.current) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  }

  function clearCacheRevealTimer() {
    if (cacheRevealTimer.current) {
      clearTimeout(cacheRevealTimer.current);
      cacheRevealTimer.current = null;
    }
  }

  function clearFadeTimer() {
    if (fadeTimer.current) {
      clearTimeout(fadeTimer.current);
      fadeTimer.current = null;
    }
  }

  function clearCooldownTimer() {
    if (cooldownTimer.current) {
      clearTimeout(cooldownTimer.current);
      cooldownTimer.current = null;
    }
  }

  function hardHideTip() {
    clearFadeTimer();
    setHoverTip(null);
  }

  /** 渐出后卸载 */
  function fadeOutTip() {
    clearLeaveTimer();
    setHoverTip((prev) => {
      if (!prev) return null;
      if (prev.anim === 'leaving') return prev;
      return { ...prev, anim: 'leaving' };
    });
    clearFadeTimer();
    fadeTimer.current = setTimeout(() => {
      hardHideTip();
      if (!sessionRef.current?.revealed) {
        highlightTarget(activeEl.current, false);
        activeEl.current = null;
      }
    }, FADE_MS);
  }

  function abortHoverWork(reason: 'switch' | 'leave' | 'unmount') {
    clearSettleTimer();
    clearRevealTimer();
    clearCacheRevealTimer();
    clearCooldownTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    inflightKeyRef.current = null;
    if (reason === 'leave' || reason === 'unmount') {
      if (!sessionRef.current?.revealed) {
        sessionRef.current = null;
      }
    }
  }

  function scheduleHideTip() {
    clearLeaveTimer();
    leaveTimer.current = setTimeout(() => {
      if (tipPinned.current) return;
      highlightTarget(activeEl.current, false);
      activeEl.current = null;
      sessionRef.current = null;
      fadeOutTip();
    }, HOVER_LEAVE_KEEP_MS);
  }

  function canFireRequest(): { ok: boolean; wait: number } {
    const now = Date.now();
    const since = now - lastRequestAt.current;
    const cooldownWait = Math.max(0, REQUEST_COOLDOWN_MS - since);

    if (now - requestWindow.current.t0 > REQUEST_WINDOW_MS) {
      requestWindow.current = { t0: now, n: 0 };
    }
    if (requestWindow.current.n >= MAX_REQUESTS_PER_WINDOW) {
      const until = REQUEST_WINDOW_MS - (now - requestWindow.current.t0);
      return { ok: false, wait: Math.max(cooldownWait, until, REQUEST_COOLDOWN_MS) };
    }
    return { ok: true, wait: cooldownWait };
  }

  function showTipForSession(s: NonNullable<typeof sessionRef.current>, forceLoading?: boolean) {
    const loading = forceLoading ?? (s.loading && !s.buffer);
    // 首次展示时若尚未锚定，按目标元素钉住位置；之后只更新文案，不改 x/y
    setHoverTip((prev) => {
      if (prev && prev.topic === s.topic && prev.anim !== 'leaving') {
        return {
          ...prev,
          text: loading ? '' : s.buffer || '暂无讲解',
          loading,
          anim: 'visible',
          // 保持 prev.x / prev.y 冻结
        };
      }
      const pt = anchorNearTarget(s.el, s.x, s.y);
      // 会话也锁死锚定坐标，后续 show 不再漂
      s.x = pt.x;
      s.y = pt.y;
      return {
        x: pt.x,
        y: pt.y,
        text: loading ? '' : s.buffer || '暂无讲解',
        loading,
        topic: s.topic,
        anim: 'visible',
      };
    });
  }

  /**
   * 答案就绪后展示：保证自 reveal 起至少 HOVER_MIN_THINK_MS 的「思考中」，
   * 缓存命中与秒回网络结果同样适用。
   */
  function scheduleAnswerReveal(s: NonNullable<typeof sessionRef.current>, gen: number) {
    if (!s.revealed) return;
    if (!s.buffer || s.loading) return;
    clearCacheRevealTimer();
    const elapsed = s.revealAt ? Date.now() - s.revealAt : 0;
    const wait = Math.max(0, HOVER_MIN_THINK_MS - elapsed);
    cacheRevealTimer.current = setTimeout(() => {
      const cur = sessionRef.current;
      if (!cur || cur.gen !== gen || !cur.revealed) return;
      if (!cur.buffer || cur.loading) return;
      showTipForSession(cur, false);
    }, wait);
  }

  /**
   * 悬停策略：
   * 1) 目标稳定后立即后台预取
   * 2) 同一目标连续悬停满约 0.7s 才显示内容
   * 3) 离开保留 3s；指针在 tip 内不关
   * 4) 切换目标 / 扫射：abort + cooldown，防并发
   * 5) 用 stableKey，动画重绘不中断
   */
  useEffect(() => {
    function startPrefetch(info: {
      el: HTMLElement;
      text: string;
      context: string;
      sectionId?: string;
      stableKey: string;
      x: number;
      y: number;
    }) {
      // 同一稳定目标已在飞：只刷新 el，不改锚定坐标
      if (sessionRef.current?.stableKey === info.stableKey) {
        sessionRef.current.el = info.el;
        if (activeEl.current !== info.el) {
          highlightTarget(activeEl.current, false);
          activeEl.current = info.el;
          highlightTarget(info.el, true);
        }
        return;
      }

      // 取消上一路（切换目标）
      abortRef.current?.abort();
      clearRevealTimer();
      clearCooldownTimer();

      const gen = ++genRef.current;
      const topic = info.text.slice(0, 80);
      // 与卡片共用 L1：style::topic
      const { key, cached } = peekHoverSessionCache(
        incompleteKeys.current,
        info.text.slice(0, 400),
        style,
      );

      // 若已有展示中的 tip，切换时先渐出旧的
      if (sessionRef.current?.revealed) {
        hardHideTip();
      }

      sessionRef.current = {
        gen,
        key,
        stableKey: info.stableKey,
        text: info.text,
        context: info.context || undefined,
        sectionId: info.sectionId,
        topic,
        x: info.x,
        y: info.y,
        // 缓存也先放进 buffer，但 loading 仍为 true，用于最短思考展示
        buffer: cached || '',
        revealed: false,
        loading: true,
        complete: Boolean(cached),
        revealAt: 0,
        el: info.el,
      };

      if (activeEl.current !== info.el) {
        highlightTarget(activeEl.current, false);
        activeEl.current = info.el;
        highlightTarget(info.el, true);
      }

      // 揭示延迟后出气泡：一律先显示思考中；答案再最短思考后揭晓
      revealTimer.current = setTimeout(() => {
        const s = sessionRef.current;
        if (!s || s.gen !== gen) return;
        s.revealed = true;
        s.revealAt = Date.now();
        // 缓存命中：答案已在 buffer，但先装作仍在思考
        if (cached && s.buffer) {
          s.loading = false;
        }
        showTipForSession(s, true);
        // 答案已就绪（缓存或延迟内网络已返回）→ 最短思考后再揭晓
        if (s.buffer && !s.loading) {
          scheduleAnswerReveal(s, gen);
        }
      }, HOVER_REVEAL_MS);

      // 有缓存：不再请求 LLM
      if (cached) {
        return;
      }

      const fire = () => {
        if (sessionRef.current?.gen !== gen) return;
        // R-09：前端熔断窗口内静默不预取（连续失败后暂停，给恢复中的后端减压）
        if (agentSuspended()) return;
        const gate = canFireRequest();
        if (!gate.ok || gate.wait > 0) {
          // 窗口打满或冷却中：延后，仍绑定同一 gen
          clearCooldownTimer();
          cooldownTimer.current = setTimeout(fire, Math.max(gate.wait, REQUEST_COOLDOWN_MS));
          return;
        }

        lastRequestAt.current = Date.now();
        if (Date.now() - requestWindow.current.t0 > REQUEST_WINDOW_MS) {
          requestWindow.current = { t0: Date.now(), n: 0 };
        }
        requestWindow.current.n += 1;
        inflightKeyRef.current = key;
        // 清除可能的半截 L1（共享缓存只存完整安全答案，此处仅标记 incomplete）
        const ac = new AbortController();
        abortRef.current = ac;
        let streamingShown = false;

        void runHoverExplainStream({
          style,
          cacheTopic: info.text.slice(0, 400),
          selection: {
            text: info.text.slice(0, 1200),
            context: info.context || undefined,
            sectionId: info.sectionId,
            route: location.pathname,
          },
          signal: ac.signal,
          incomplete: incompleteKeys.current,
          skipCacheRead: true,
          partialTruncateMax: 600,
          isStale: () => sessionRef.current?.gen !== gen,
          onThinking: () => {
            const s = sessionRef.current;
            if (!s || s.gen !== gen) return;
            if (!streamingShown) {
              s.loading = true;
              if (s.revealed && !s.complete) showTipForSession(s, true);
            }
          },
          onPartial: (show) => {
            const s = sessionRef.current;
            if (!s || s.gen !== gen) return;
            s.buffer = show;
            s.loading = false;
            streamingShown = true;
            if (s.revealed) showTipForSession(s, false);
          },
          onFinal: (result) => {
            const s = sessionRef.current;
            if (!s || s.gen !== gen) return;
            s.buffer = result.text;
            s.loading = false;
            s.complete = result.complete;
            if (inflightKeyRef.current === key) inflightKeyRef.current = null;
            if (!s.revealed) return;
            if (streamingShown && result.hasAnswer) showTipForSession(s, false);
            else if (result.hasAnswer) {
              showTipForSession(s, true);
              scheduleAnswerReveal(s, gen);
            } else {
              showTipForSession(s, false);
            }
          },
          onStreamError: (message) => {
            const s = sessionRef.current;
            if (!s || s.gen !== gen) return;
            s.buffer = `讲解失败：${message}`;
            s.loading = false;
            s.complete = false;
            if (inflightKeyRef.current === key) inflightKeyRef.current = null;
            if (s.revealed) showTipForSession(s, false);
          },
        }).then((result) => {
          if (result.aborted) {
            if (inflightKeyRef.current === key) inflightKeyRef.current = null;
            return;
          }
          if (inflightKeyRef.current === key) inflightKeyRef.current = null;
        });
      };

      fire();
    }

    function onOver(e: MouseEvent) {
      if (tipRef.current?.contains(e.target as Node)) {
        tipPinned.current = true;
        clearLeaveTimer();
        // 渐出中又回到 tip：恢复可见
        setHoverTip((prev) => (prev && prev.anim === 'leaving' ? { ...prev, anim: 'visible' } : prev));
        clearFadeTimer();
        return;
      }

      if (!isKnowledgeRoute(location.pathname)) return;

      const info = findHoverTarget(e.target, e.clientX, e.clientY);
      if (!info) return;

      clearLeaveTimer();
      // 取消正在进行的渐出
      clearFadeTimer();
      setHoverTip((prev) => (prev && prev.anim === 'leaving' ? { ...prev, anim: 'visible' } : prev));

      // 同一稳定目标（含动画重绘后的新 DOM）：续会话
      // 注意：不更新 tip 的 x/y，避免鼠标微动/滚动时对话框跟着飘
      if (sessionRef.current && sessionRef.current.stableKey === info.stableKey) {
        sessionRef.current.el = info.el;
        if (activeEl.current !== info.el) {
          highlightTarget(activeEl.current, false);
          activeEl.current = info.el;
          highlightTarget(info.el, true);
        }
        if (sessionRef.current.revealed) {
          setHoverTip((prev) => (prev ? { ...prev, anim: 'visible' } : prev));
        }
        return;
      }

      // 切换目标：取消未完成的展示与请求
      abortHoverWork('switch');
      if (sessionRef.current?.revealed) {
        hardHideTip();
        sessionRef.current = null;
      } else {
        sessionRef.current = null;
      }

      // 锚定点：优先目标元素几何，指针仅作回退
      const pt = anchorNearTarget(info.el, e.clientX, e.clientY);
      clearSettleTimer();
      settleTimer.current = setTimeout(() => {
        startPrefetch({
          el: info.el,
          text: info.text,
          context: info.context,
          sectionId: info.sectionId,
          stableKey: info.stableKey,
          x: pt.x,
          y: pt.y,
        });
      }, HOVER_SETTLE_MS);
    }

    function onOut(e: MouseEvent) {
      const to = e.relatedTarget as Node | null;
      if (tipRef.current?.contains(to)) {
        tipPinned.current = true;
        clearLeaveTimer();
        return;
      }
      // 仍在同一高亮块内移动
      if (activeEl.current?.contains(to as Node)) return;
      if (sessionRef.current?.el?.contains(to as Node)) return;

      // 移到图表内其他子节点但 stableKey 相同：由 onOver 处理；此处若 related 仍在 viz 且有同 key 则不离
      if (to instanceof Element) {
        const next = findHoverTarget(to);
        if (next && sessionRef.current && next.stableKey === sessionRef.current.stableKey) {
          sessionRef.current.el = next.el;
          return;
        }
      }

      tipPinned.current = false;
      const wasRevealed = Boolean(sessionRef.current?.revealed);

      clearSettleTimer();
      clearRevealTimer();

      if (!wasRevealed) {
        // 未满揭示时长 / 未完成：中止请求，标记 incomplete，禁止下次复用半截
        const k = sessionRef.current?.key;
        if (k) {
          incompleteKeys.current.mark(k);
        }
        abortRef.current?.abort();
        abortRef.current = null;
        inflightKeyRef.current = null;
        sessionRef.current = null;
        highlightTarget(activeEl.current, false);
        activeEl.current = null;
        hardHideTip();
        return;
      }

      // 已展示但仍在生成：允许后台跑完再缓存；离开时不清 buffer
      if (sessionRef.current && !sessionRef.current.complete) {
        incompleteKeys.current.mark(sessionRef.current.key);
      }

      // 已展示：保留 3s
      scheduleHideTip();
    }

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      abortHoverWork('unmount');
      clearLeaveTimer();
      clearFadeTimer();
      highlightTarget(activeEl.current, false);
    };
  }, [location.pathname, style]);

  // 深度讲解事件
  useEffect(() => {
    function onExplain(e: Event) {
      const detail = (e as CustomEvent).detail as {
        text: string;
        title?: string;
        articleSlug?: string;
      };
      if (!detail?.text) return;
      setOpen(true);
      void deepExplain(detail.text, detail.title, detail.articleSlug);
    }
    window.addEventListener('agent:explain', onExplain);
    return () => window.removeEventListener('agent:explain', onExplain);
  }, [deepExplain]);

  return (
    <>
      {hoverTip && tipBox ? (
        <div
          ref={tipRef}
          className={`agent-hover-tip ${
            hoverTip.anim === 'leaving' ? 'leaving' : tipEntered ? 'visible' : ''
          }`}
          style={{
            position: 'fixed',
            left: tipBox.left,
            top: tipBox.top,
            zIndex: 120,
            width: 'max-content',
            minWidth: tipBox.minW,
            maxWidth: tipBox.maxW,
            maxHeight: tipBox.maxH,
            overflow: 'auto',
            padding: '12px 14px',
            borderRadius: 14,
            border: '1px solid var(--border)',
            background: 'var(--popover)',
            color: 'var(--popover-foreground)',
            boxShadow: 'var(--shadow-lg)',
          }}
          onMouseEnter={() => {
            tipPinned.current = true;
            clearLeaveTimer();
            clearFadeTimer();
            setHoverTip((prev) => (prev ? { ...prev, anim: 'visible' } : prev));
          }}
          onMouseLeave={() => {
            tipPinned.current = false;
            scheduleHideTip();
          }}
        >
          {hoverTip.loading || !hoverTip.text ? (
            <div className="agent-thinking-indicator" aria-label="思考中">
              <span className="agent-thinking-dot" />
              <span className="agent-thinking-dot" style={{ animationDelay: '0.2s' }} />
              <span className="agent-thinking-dot" style={{ animationDelay: '0.4s' }} />
              <span>思考中…</span>
            </div>
          ) : (
            <MarkdownView source={hoverTip.text} compact />
          )}
        </div>
      ) : null}

      <div className="agent-float" ref={ref}>
        <div className={`agent-panel${open ? ' open' : ''}`}>
          <div className="agent-panel-header">
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.05em' }}>
              AGENT
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowHelp((v) => !v)}
                title="模式说明"
              >
                ?
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
          </div>

          {showHelp ? (
            <div
              style={{
                padding: '10px 14px',
                fontSize: 12,
                lineHeight: 1.55,
                borderBottom: '1px solid var(--border)',
                background: 'var(--muted)',
                color: 'var(--muted-foreground)',
              }}
            >
              <strong style={{ color: 'var(--foreground)' }}>快速 Agent（悬停）</strong>
              <br />
              悬停即后台思考，满 {(HOVER_REVEAL_MS / 1000).toFixed(1)} 秒显示；离开保留 3 秒。扫射会取消多余请求。
              <br />
              <strong style={{ color: 'var(--foreground)' }}>Agent 助手</strong>
              ：结构化详解 · 思考默认收起；勾选「允许工具」可检索站内文章（ReAct tool-loop）
            </div>
          ) : null}

          <div className="agent-panel-body" style={{ maxHeight: 340, overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--muted-foreground)' }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)' }}>
                  深度讲解
                </p>
                <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                  悬停知识区内容可快讲；在此输入获取结构化详解。
                </p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: 10,
                    padding: '8px 10px',
                    borderRadius: 10,
                    background:
                      m.role === 'user'
                        ? 'var(--muted)'
                        : 'color-mix(in srgb, var(--primary) 8%, var(--card))',
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                >
                  <div
                    style={{
                      font: '700 10px/1 var(--font-mono)',
                      marginBottom: 6,
                      opacity: 0.6,
                    }}
                  >
                    {m.role === 'user'
                      ? 'YOU'
                      : m.streaming
                        ? m.text
                          ? 'AGENT · 作答中'
                          : 'AGENT · …'
                        : 'AGENT'}
                  </div>
                  {m.role === 'assistant' ? (
                    <>
                      {/* 发送后即展示「思考过程」字样，默认收起 */}
                      <details
                        open={Boolean(m.thinkingOpen)}
                        style={{ marginBottom: 8 }}
                        onToggle={(e) => {
                          const openNow = (e.target as HTMLDetailsElement).open;
                          if (openNow !== Boolean(m.thinkingOpen)) toggleThinking(i);
                        }}
                      >
                        <summary
                          style={{
                            cursor: 'pointer',
                            fontSize: 12,
                            color: 'var(--muted-foreground)',
                            userSelect: 'none',
                          }}
                        >
                          思考过程
                        </summary>
                        {m.thinking ? (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 8,
                              borderRadius: 8,
                              background: 'var(--muted)',
                              fontSize: 11,
                              lineHeight: 1.45,
                              color: 'var(--muted-foreground)',
                              maxHeight: 160,
                              overflow: 'auto',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {m.thinking}
                          </div>
                        ) : m.streaming ? (
                          <div className="agent-thinking-indicator" style={{ marginTop: 6 }}>
                            <span className="agent-thinking-dot" />
                            <span className="agent-thinking-dot" style={{ animationDelay: '0.2s' }} />
                            <span className="agent-thinking-dot" style={{ animationDelay: '0.4s' }} />
                          </div>
                        ) : (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 11,
                              color: 'var(--muted-foreground)',
                            }}
                          >
                            （无额外推理内容）
                          </div>
                        )}
                      </details>
                      {m.text ? (
                        <MarkdownView source={m.text} compact />
                      ) : m.streaming ? null : (
                        <span style={{ color: 'var(--muted-foreground)' }}>暂无正文</span>
                      )}
                    </>
                  ) : (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="agent-panel-input" style={{ flexWrap: 'wrap', gap: 8 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--muted-foreground)',
                width: '100%',
                cursor: busy ? 'default' : 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={toolsEnabled}
                disabled={busy}
                onChange={(e) => setToolsEnabled(e.target.checked)}
              />
              允许工具（检索站内文章）
            </label>
            <input
              className="input"
              placeholder={busy ? '生成中…' : '问 Agent 助手…'}
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              style={{ flex: 1 }}
            />
            <Button disabled={busy || !input.trim()} onClick={() => void send()}>
              发送
            </Button>
          </div>
        </div>
        <button
          type="button"
          className="agent-float-btn"
          aria-label="Agent"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <span className="agent-float-dot" />
          <span>Agent</span>
        </button>
      </div>
    </>
  );
}
