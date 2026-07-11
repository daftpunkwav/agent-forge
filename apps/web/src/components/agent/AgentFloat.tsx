import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { streamAgent } from '@/lib/agentStream';
import { MarkdownView } from './MarkdownView';
import { findHoverTarget, highlightTarget, isKnowledgeRoute } from './hoverTarget';

type ChatMsg = {
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  streaming?: boolean;
  /** 是否展开思考区（默认收起） */
  thinkingOpen?: boolean;
};

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
 * - 快速：悬停即后台思考，满 2s 才显示；不展示思考/流式中间态
 * - 助手：Deep 结构化详解，思考默认收起
 */
export function AgentFloat() {
  const [open, setOpen] = useState(false);
  const [hoverTip, setHoverTip] = useState<HoverTipState | null>(null);
  /** 双 rAF 触发 CSS 渐入，避免 mount 时已带 visible 无动画 */
  const [tipEntered, setTipEntered] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState('professional');
  const [showHelp, setShowHelp] = useState(false);

  const ref = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  /** 目标稳定 debounce（防嵌套元素抖动） */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 满 2s 才展示 */
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEl = useRef<HTMLElement | null>(null);
  /**
   * L1 浏览器缓存（工业策略）
   * - TTL 20 分钟：同会话反复悬停零延迟
   * - 最多 64 条 LRU
   * - 仅存「完整 final」；中断/半截绝不写入
   */
  const hoverCache = useRef<Map<string, { text: string; at: number }>>(new Map());
  const HOVER_CACHE_TTL_MS = 20 * 60 * 1000;
  const HOVER_CACHE_MAX = 64;
  /** 未完成请求：key → true，离开后禁止把半截当缓存命中 */
  const incompleteKeys = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const tipPinned = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  /** 当前会话：后台已预取，是否已过 2s 可展示 */
  const sessionRef = useRef<{
    gen: number;
    /** 请求/缓存 key（文案） */
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
    el: HTMLElement;
  } | null>(null);
  const genRef = useRef(0);
  /** 全局串行：同一时间只允许一个 hover 请求 */
  const inflightKeyRef = useRef<string | null>(null);
  /** 最近请求时间戳，防扫射 */
  const lastRequestAt = useRef(0);
  /** 短窗内请求计数 */
  const requestWindow = useRef<{ t0: number; n: number }>({ t0: 0, n: 0 });

  const HOVER_SETTLE_MS = 80;
  /** 悬停满 2s 才显示内容（后台 0s 起就开始思考） */
  const HOVER_REVEAL_MS = 2000;
  /** 移出后保留 3s；指针在对话框内不消失 */
  const HOVER_LEAVE_KEEP_MS = 3000;
  const FADE_MS = 220;
  /** 新目标请求最小间隔 */
  const REQUEST_COOLDOWN_MS = 400;
  /** 10s 内最多 N 次新请求 */
  const MAX_REQUESTS_PER_WINDOW = 6;
  const REQUEST_WINDOW_MS = 10_000;

  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    api
      .getSettings()
      .then((r) => {
        const s = r.preferences.agentStyle;
        if (typeof s === 'string') setStyle(s);
      })
      .catch(() => undefined);
  }, [user]);

  const placeTip = useCallback((x: number, y: number, contentLen: number) => {
    const maxW = Math.min(420, window.innerWidth - 24);
    const minW = Math.min(280, maxW);
    const estH = Math.min(360, Math.max(120, 80 + Math.ceil(contentLen / 40) * 18));
    let left = x + 14;
    let top = y + 14;
    if (left + maxW > window.innerWidth - 8) left = Math.max(8, x - maxW - 12);
    if (top + estH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - estH - 12);
    return { left, top, maxW, minW, maxH: Math.min(360, window.innerHeight - 24) };
  }, []);

  const tipBox = useMemo(() => {
    if (!hoverTip) return null;
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

  function isCompleteHoverClient(s: string): boolean {
    const t = (s || '').trim();
    if (t.length < 24 || t.length > 900) return false;
    if (/思考过程|写作计划|我需要：|结构如下|###\s*Thought|讲解失败|暂无讲解/i.test(t.slice(0, 100))) {
      return false;
    }
    if (/[，、：:与和或及的了着]$/.test(t)) return false;
    // 长文本却无句末标点 → 多半半截
    if (t.length > 80 && !/[。！？.!?]["'」』）)\]]*$/.test(t)) {
      if (t.length > 200) return false;
    }
    return true;
  }

  function readCache(key: string): string | null {
    if (incompleteKeys.current.has(key)) return null;
    const hit = hoverCache.current.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > HOVER_CACHE_TTL_MS) {
      hoverCache.current.delete(key);
      return null;
    }
    if (!isCompleteHoverClient(hit.text)) {
      hoverCache.current.delete(key);
      return null;
    }
    // LRU：重新插入到末尾
    hoverCache.current.delete(key);
    hoverCache.current.set(key, { text: hit.text, at: Date.now() });
    return hit.text;
  }

  function pushCache(key: string, text: string) {
    if (!isCompleteHoverClient(text)) return;
    incompleteKeys.current.delete(key);
    if (hoverCache.current.has(key)) hoverCache.current.delete(key);
    hoverCache.current.set(key, { text, at: Date.now() });
    while (hoverCache.current.size > HOVER_CACHE_MAX) {
      const first = hoverCache.current.keys().next().value;
      if (first) hoverCache.current.delete(first);
      else break;
    }
  }

  function sanitizeHoverAnswer(raw: string): string {
    const s = (raw || '').trim();
    if (!s) return '';
    if (/思考过程|写作计划|我需要：|结构如下/i.test(s.slice(0, 60))) {
      const parts = s.split(/\n{2,}/).filter((p) => p.trim().length > 12);
      const last = parts[parts.length - 1]?.trim() || '';
      if (last && !/思考过程|我需要/.test(last.slice(0, 40))) {
        return smartTruncateClient(last);
      }
      return '';
    }
    return smartTruncateClient(s);
  }

  function smartTruncateClient(s: string, max = 560): string {
    if (s.length <= max) return s.trim();
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
    if (end >= Math.floor(max * 0.45)) return cut.slice(0, end + 1).trim();
    return cut.replace(/[A-Za-z]{1,12}$/, '').trim();
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
    setHoverTip({
      x: s.x,
      y: s.y,
      text: loading ? '' : s.buffer || '暂无讲解',
      loading,
      topic: s.topic,
      anim: 'visible',
    });
  }

  /**
   * 悬停策略：
   * 1) 目标稳定后立即后台预取
   * 2) 同一目标连续悬停满 2s 才显示内容
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
      const key = info.text.slice(0, 200);

      // 同一稳定目标已在飞：只更新坐标 / el
      if (sessionRef.current?.stableKey === info.stableKey) {
        sessionRef.current.el = info.el;
        sessionRef.current.x = info.x;
        sessionRef.current.y = info.y;
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
      // 未完成的旧请求标记：禁止读半截缓存
      const cached = incompleteKeys.current.has(key) ? null : readCache(key);

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
        buffer: cached || '',
        revealed: false,
        loading: !cached,
        complete: Boolean(cached),
        el: info.el,
      };

      if (activeEl.current !== info.el) {
        highlightTarget(activeEl.current, false);
        activeEl.current = info.el;
        highlightTarget(info.el, true);
      }

      // 2s 后才允许展示
      revealTimer.current = setTimeout(() => {
        const s = sessionRef.current;
        if (!s || s.gen !== gen) return;
        s.revealed = true;
        if (s.buffer && !s.loading) {
          showTipForSession(s, false);
        } else {
          showTipForSession(s, true);
        }
      }, HOVER_REVEAL_MS);

      // 有缓存：只等 2s 展示，不再请求
      if (cached) {
        sessionRef.current.loading = false;
        return;
      }

      const fire = () => {
        if (sessionRef.current?.gen !== gen) return;
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
        incompleteKeys.current.add(key);
        // 清掉可能存在的脏缓存，避免中途失败后仍命中旧半截
        hoverCache.current.delete(key);
        const ac = new AbortController();
        abortRef.current = ac;
        let gotFinal = false;

        streamAgent(
          '/agent/explain/stream',
          {
            mode: 'hover',
            style,
            selection: {
              text: info.text.slice(0, 1200),
              context: info.context || undefined,
              sectionId: info.sectionId,
              route: location.pathname,
            },
          },
          (ev) => {
            const s = sessionRef.current;
            // 已切换目标：忽略迟到事件，且不写缓存
            if (!s || s.gen !== gen) return;

            if (ev.type === 'status' || ev.type === 'thinking') {
              s.loading = true;
              if (s.revealed && !s.complete) {
                showTipForSession(s, true);
              }
              return;
            }

            if (ev.type === 'final' && ev.answer != null) {
              gotFinal = true;
              const cleaned = sanitizeHoverAnswer(ev.answer);
              const ok = isCompleteHoverClient(cleaned);
              s.buffer = cleaned || '暂无讲解';
              s.loading = false;
              s.complete = ok;
              if (ok) {
                pushCache(key, cleaned);
              } else {
                incompleteKeys.current.add(key);
                hoverCache.current.delete(key);
              }
              if (inflightKeyRef.current === key) inflightKeyRef.current = null;
              if (s.revealed) showTipForSession(s, !ok && !cleaned);
              return;
            }

            // 悬停：忽略 delta，仅 final
            if (ev.type === 'delta') return;

            if (ev.type === 'done') {
              if (!gotFinal) {
                // 无 final 的 done → 不完整，禁止缓存
                s.loading = false;
                s.complete = false;
                incompleteKeys.current.add(key);
                hoverCache.current.delete(key);
                if (!s.buffer) s.buffer = '暂无讲解';
              }
              if (inflightKeyRef.current === key) inflightKeyRef.current = null;
              if (s.revealed) showTipForSession(s, false);
            }
            if (ev.type === 'error') {
              s.buffer = `讲解失败：${ev.message}`;
              s.loading = false;
              s.complete = false;
              incompleteKeys.current.add(key);
              hoverCache.current.delete(key);
              if (inflightKeyRef.current === key) inflightKeyRef.current = null;
              if (s.revealed) showTipForSession(s, false);
            }
          },
          ac.signal,
        ).catch((err: Error) => {
          if (err.name === 'AbortError') {
            // 中断：标记 incomplete，绝不清掉「已 complete」的旧缓存以外的写入
            incompleteKeys.current.add(key);
            hoverCache.current.delete(key);
            if (inflightKeyRef.current === key) inflightKeyRef.current = null;
            return;
          }
          const s = sessionRef.current;
          if (!s || s.gen !== gen) return;
          s.buffer = `讲解失败：${err.message}`;
          s.loading = false;
          s.complete = false;
          incompleteKeys.current.add(key);
          hoverCache.current.delete(key);
          if (inflightKeyRef.current === key) inflightKeyRef.current = null;
          if (s.revealed) showTipForSession(s, false);
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
      if (sessionRef.current && sessionRef.current.stableKey === info.stableKey) {
        sessionRef.current.el = info.el;
        sessionRef.current.x = e.clientX;
        sessionRef.current.y = e.clientY;
        if (activeEl.current !== info.el) {
          highlightTarget(activeEl.current, false);
          activeEl.current = info.el;
          highlightTarget(info.el, true);
        }
        if (sessionRef.current.revealed) {
          setHoverTip((prev) =>
            prev
              ? { ...prev, x: e.clientX, y: e.clientY, anim: 'visible' }
              : prev,
          );
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

      const x = e.clientX;
      const y = e.clientY;
      clearSettleTimer();
      settleTimer.current = setTimeout(() => {
        startPrefetch({
          el: info.el,
          text: info.text,
          context: info.context,
          sectionId: info.sectionId,
          stableKey: info.stableKey,
          x,
          y,
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
        // 未满 2s / 未完成：中止请求，标记 incomplete，禁止下次复用半截
        const k = sessionRef.current?.key;
        if (k) {
          incompleteKeys.current.add(k);
          hoverCache.current.delete(k);
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
        incompleteKeys.current.add(sessionRef.current.key);
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
    window.addEventListener('agentforge:explain', onExplain);
    return () => window.removeEventListener('agentforge:explain', onExplain);
  }, [style, location.pathname]);

  function patchLastAssistant(patch: Partial<ChatMsg>) {
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last?.role === 'assistant') {
        copy[copy.length - 1] = { ...last, ...patch };
      }
      return copy;
    });
  }

  async function deepExplain(text: string, title?: string, articleSlug?: string) {
    setBusy(true);
    const userLine = `请详细讲解：${title || text.slice(0, 80)}`;
    setMessages((m) => [
      ...m,
      { role: 'user', text: userLine },
      { role: 'assistant', text: '', thinking: '', streaming: true, thinkingOpen: false },
    ]);
    let answer = '';
    let thinking = '';
    try {
      await streamAgent(
        '/agent/explain/stream',
        {
          mode: 'click',
          style,
          selection: {
            text: text.slice(0, 3500),
            title,
            articleSlug,
            route: location.pathname,
          },
        },
        (ev) => {
          if (ev.type === 'thinking' && ev.text) {
            thinking += ev.text;
            patchLastAssistant({ thinking, streaming: true });
          }
          if (ev.type === 'delta' && ev.text) {
            answer += ev.text;
            patchLastAssistant({ text: answer, streaming: true });
          }
          if (ev.type === 'final') {
            if (ev.answer != null) answer = ev.answer;
            if (ev.thinking != null) thinking = ev.thinking;
            patchLastAssistant({
              text: answer,
              thinking,
              streaming: false,
              thinkingOpen: false,
            });
          }
          if (ev.type === 'error') {
            answer = `**错误**\n\n${ev.message}`;
          }
        },
      );
      if (!answer.trim()) {
        try {
          const r = await api.agentExplain({
            mode: 'click',
            style,
            selection: {
              text: text.slice(0, 3500),
              title,
              articleSlug,
              route: location.pathname,
            },
          });
          answer = r.explanation || '';
        } catch {
          /* keep */
        }
      }
      patchLastAssistant({
        text: answer.trim() || '**暂无输出**\n\n请检查 BYOK 配置后重试。',
        thinking,
        streaming: false,
        thinkingOpen: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '讲解失败';
      patchLastAssistant({ text: `**错误**\n\n${msg}`, streaming: false });
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!input.trim() || busy) return;
    const msg = input.trim();
    setInput('');
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: 'user', text: msg },
      { role: 'assistant', text: '', thinking: '', streaming: true, thinkingOpen: false },
    ]);
    let answer = '';
    let thinking = '';
    try {
      await streamAgent(
        '/agent/chat/stream',
        {
          message: msg,
          style,
          mode: 'deep',
          conversationId: conversationIdRef.current || undefined,
          context: { route: location.pathname },
        },
        (ev) => {
          if (ev.type === 'meta' && (ev as { conversationId?: string }).conversationId) {
            conversationIdRef.current = (ev as { conversationId?: string }).conversationId || null;
          }
          if (ev.type === 'thinking' && ev.text) {
            thinking += ev.text;
            patchLastAssistant({ thinking, streaming: true, thinkingOpen: false });
          }
          if (ev.type === 'delta' && ev.text) {
            answer += ev.text;
            patchLastAssistant({ text: answer, streaming: true });
          }
          if (ev.type === 'final') {
            if (ev.answer != null) answer = ev.answer;
            if (ev.thinking != null) thinking = ev.thinking;
            patchLastAssistant({
              text: answer,
              thinking,
              streaming: false,
              thinkingOpen: false,
            });
          }
          if (ev.type === 'error') answer = `**错误**\n\n${ev.message}`;
        },
      );
      if (!answer.trim()) {
        try {
          const r = await api.agentChat({
            message: msg,
            style,
            mode: 'deep',
            context: { route: location.pathname },
          });
          answer = r.reply || '';
        } catch {
          /* keep */
        }
      }
      patchLastAssistant({
        text: answer.trim() || '**暂无输出**\n\n请检查 BYOK 配置后重试。',
        thinking,
        streaming: false,
        thinkingOpen: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '发送失败';
      patchLastAssistant({ text: `**错误**\n\n${message}`, streaming: false });
    } finally {
      setBusy(false);
    }
  }

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
            <div className="agent-thinking-indicator" aria-label="加载中">
              <span className="agent-thinking-dot" />
              <span className="agent-thinking-dot" style={{ animationDelay: '0.2s' }} />
              <span className="agent-thinking-dot" style={{ animationDelay: '0.4s' }} />
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
              悬停即后台思考，满 2 秒显示；离开保留 3 秒。扫射会取消多余请求。
              <br />
              <strong style={{ color: 'var(--foreground)' }}>Agent 助手</strong>
              ：结构化详解 · 思考默认收起
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
                          const open = (e.target as HTMLDetailsElement).open;
                          setMessages((list) =>
                            list.map((msg, idx) =>
                              idx === i ? { ...msg, thinkingOpen: open } : msg,
                            ),
                          );
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
          <div className="agent-panel-input">
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
