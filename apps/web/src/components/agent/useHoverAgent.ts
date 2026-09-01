import { useEffect, useMemo, useRef, useState } from 'react';
import { IncompleteHoverKeys } from '@/lib/hoverExplainSession';
import { HOVER_REVEAL_MS } from './hoverConstants';
import { placeHoverTip } from './hoverPlacement';
import type { HoverSession, HoverTipState } from './hoverTypes';
import { useHoverDocumentListeners } from './useHoverDocumentListeners';

export { HOVER_REVEAL_MS };

/** 悬停快讲：预取、节流、气泡状态（与面板 Agent 解耦） */
export function useHoverAgent(style: string, pathname: string) {
  const [hoverTip, setHoverTip] = useState<HoverTipState | null>(null);
  const [tipEntered, setTipEntered] = useState(false);

  const tipRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRevealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEl = useRef<HTMLElement | null>(null);
  const incompleteKeys = useRef(new IncompleteHoverKeys());
  const abortRef = useRef<AbortController | null>(null);
  const tipPinned = useRef(false);
  const sessionRef = useRef<HoverSession | null>(null);
  const genRef = useRef(0);
  const inflightKeyRef = useRef<string | null>(null);
  const lastRequestAt = useRef(0);
  const requestWindow = useRef<{ t0: number; n: number }>({ t0: 0, n: 0 });

  const listenerCtx = {
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
  };

  const { handleTipMouseEnter, handleTipMouseLeave } = useHoverDocumentListeners(listenerCtx);

  const tipBox = useMemo(() => {
    if (!hoverTip) return null;
    return placeHoverTip(hoverTip.x, hoverTip.y, hoverTip.text.length);
  }, [hoverTip]);

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

  return {
    hoverTip,
    tipBox,
    tipRef,
    tipEntered,
    handleTipMouseEnter,
    handleTipMouseLeave,
  };
}
