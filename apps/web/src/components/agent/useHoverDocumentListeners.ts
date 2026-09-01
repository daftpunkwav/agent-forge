/**
 * 悬停快讲：文档级 mouseover/mouseout 监听与预取会话（从 useHoverAgent 拆出）
 */
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { AGENT_CACHE_CLEARED_EVENT } from '@/lib/hoverExplainCache';
import {
  agentSuspended,
  IncompleteHoverKeys,
  peekHoverSessionCache,
  runHoverExplainStream,
} from '@/lib/hoverExplainSession';
import {
  HOVER_FADE_MS,
  HOVER_LEAVE_KEEP_MS,
  HOVER_MAX_REQUESTS_PER_WINDOW,
  HOVER_MIN_THINK_MS,
  HOVER_REQUEST_COOLDOWN_MS,
  HOVER_REQUEST_WINDOW_MS,
  HOVER_REVEAL_MS,
  HOVER_SETTLE_MS,
} from './hoverConstants';
import { anchorHoverNearTarget } from './hoverPlacement';
import { findHoverTarget, highlightTarget, isKnowledgeRoute } from './hoverTarget';
import type { HoverSession, HoverTipState } from './hoverTypes';

export type HoverDocumentListenerCtx = {
  style: string;
  pathname: string;
  tipRef: RefObject<HTMLDivElement | null>;
  incompleteKeys: RefObject<IncompleteHoverKeys>;
  sessionRef: RefObject<HoverSession | null>;
  genRef: RefObject<number>;
  inflightKeyRef: RefObject<string | null>;
  lastRequestAt: RefObject<number>;
  requestWindow: RefObject<{ t0: number; n: number }>;
  activeEl: RefObject<HTMLElement | null>;
  tipPinned: RefObject<boolean>;
  abortRef: RefObject<AbortController | null>;
  settleTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  revealTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  leaveTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  fadeTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  cooldownTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  cacheRevealTimer: RefObject<ReturnType<typeof setTimeout> | null>;
  setHoverTip: Dispatch<SetStateAction<HoverTipState | null>>;
};

function clearTimerRef(ref: RefObject<ReturnType<typeof setTimeout> | null>) {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

export function useHoverDocumentListeners(ctx: HoverDocumentListenerCtx) {
  const {
    style,
    pathname,
    tipRef,
    incompleteKeys,
    sessionRef,
    genRef,
    inflightKeyRef,
    lastRequestAt,
    requestWindow,
    activeEl,
    tipPinned,
    abortRef,
    settleTimer,
    revealTimer,
    leaveTimer,
    fadeTimer,
    cooldownTimer,
    cacheRevealTimer,
    setHoverTip,
  } = ctx;

  function clearLeaveTimer() {
    clearTimerRef(leaveTimer);
  }

  function clearSettleTimer() {
    clearTimerRef(settleTimer);
  }

  function clearRevealTimer() {
    clearTimerRef(revealTimer);
  }

  function clearCacheRevealTimer() {
    clearTimerRef(cacheRevealTimer);
  }

  function clearFadeTimer() {
    clearTimerRef(fadeTimer);
  }

  function clearCooldownTimer() {
    clearTimerRef(cooldownTimer);
  }

  function hardHideTip() {
    clearFadeTimer();
    setHoverTip(null);
  }

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
    }, HOVER_FADE_MS);
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
    const cooldownWait = Math.max(0, HOVER_REQUEST_COOLDOWN_MS - since);

    if (now - requestWindow.current.t0 > HOVER_REQUEST_WINDOW_MS) {
      requestWindow.current = { t0: now, n: 0 };
    }
    if (requestWindow.current.n >= HOVER_MAX_REQUESTS_PER_WINDOW) {
      const until = HOVER_REQUEST_WINDOW_MS - (now - requestWindow.current.t0);
      return {
        ok: false,
        wait: Math.max(cooldownWait, until, HOVER_REQUEST_COOLDOWN_MS),
      };
    }
    return { ok: true, wait: cooldownWait };
  }

  function showTipForSession(s: HoverSession, forceLoading?: boolean) {
    const loading = forceLoading ?? (s.loading && !s.buffer);
    setHoverTip((prev) => {
      if (prev && prev.topic === s.topic && prev.anim !== 'leaving') {
        return {
          ...prev,
          text: loading ? '' : s.buffer || '暂无讲解',
          loading,
          anim: 'visible',
        };
      }
      const pt = anchorHoverNearTarget(s.el, s.x, s.y);
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

  function scheduleAnswerReveal(s: HoverSession, gen: number) {
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
  }, [incompleteKeys, inflightKeyRef, abortRef, genRef, sessionRef, setHoverTip]);

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
      if (sessionRef.current?.stableKey === info.stableKey) {
        sessionRef.current.el = info.el;
        if (activeEl.current !== info.el) {
          highlightTarget(activeEl.current, false);
          activeEl.current = info.el;
          highlightTarget(info.el, true);
        }
        return;
      }

      abortRef.current?.abort();
      clearRevealTimer();
      clearCooldownTimer();

      const gen = ++genRef.current;
      const topic = info.text.slice(0, 80);
      const { key, cached } = peekHoverSessionCache(
        incompleteKeys.current,
        info.text.slice(0, 400),
        style,
      );

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

      revealTimer.current = setTimeout(() => {
        const s = sessionRef.current;
        if (!s || s.gen !== gen) return;
        s.revealed = true;
        s.revealAt = Date.now();
        if (cached && s.buffer) {
          s.loading = false;
        }
        showTipForSession(s, true);
        if (s.buffer && !s.loading) {
          scheduleAnswerReveal(s, gen);
        }
      }, HOVER_REVEAL_MS);

      if (cached) return;

      const fire = () => {
        if (sessionRef.current?.gen !== gen) return;
        if (agentSuspended()) return;
        const gate = canFireRequest();
        if (!gate.ok || gate.wait > 0) {
          clearCooldownTimer();
          cooldownTimer.current = setTimeout(
            fire,
            Math.max(gate.wait, HOVER_REQUEST_COOLDOWN_MS),
          );
          return;
        }

        lastRequestAt.current = Date.now();
        if (Date.now() - requestWindow.current.t0 > HOVER_REQUEST_WINDOW_MS) {
          requestWindow.current = { t0: Date.now(), n: 0 };
        }
        requestWindow.current.n += 1;
        inflightKeyRef.current = key;
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
            route: pathname,
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
        setHoverTip((prev) =>
          prev && prev.anim === 'leaving' ? { ...prev, anim: 'visible' } : prev,
        );
        clearFadeTimer();
        return;
      }

      if (!isKnowledgeRoute(pathname)) return;

      const info = findHoverTarget(e.target, e.clientX, e.clientY);
      if (!info) return;

      clearLeaveTimer();
      clearFadeTimer();
      setHoverTip((prev) =>
        prev && prev.anim === 'leaving' ? { ...prev, anim: 'visible' } : prev,
      );

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

      abortHoverWork('switch');
      if (sessionRef.current?.revealed) {
        hardHideTip();
        sessionRef.current = null;
      } else {
        sessionRef.current = null;
      }

      const pt = anchorHoverNearTarget(info.el, e.clientX, e.clientY);
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
      if (activeEl.current?.contains(to as Node)) return;
      if (sessionRef.current?.el?.contains(to as Node)) return;

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
        const k = sessionRef.current?.key;
        if (k) incompleteKeys.current.mark(k);
        abortRef.current?.abort();
        abortRef.current = null;
        inflightKeyRef.current = null;
        sessionRef.current = null;
        highlightTarget(activeEl.current, false);
        activeEl.current = null;
        hardHideTip();
        return;
      }

      if (sessionRef.current && !sessionRef.current.complete) {
        incompleteKeys.current.mark(sessionRef.current.key);
      }

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
  }, [pathname, style]);

  function handleTipMouseEnter() {
    tipPinned.current = true;
    clearLeaveTimer();
    clearFadeTimer();
    setHoverTip((prev) => (prev ? { ...prev, anim: 'visible' } : prev));
  }

  function handleTipMouseLeave() {
    tipPinned.current = false;
    scheduleHideTip();
  }

  return { handleTipMouseEnter, handleTipMouseLeave };
}
