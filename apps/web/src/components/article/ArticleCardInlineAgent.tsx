import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary } from '@agentforge/shared';
import { Tag } from '@/components/ui/Tag';
import { MarkdownView } from '@/components/agent/MarkdownView';
import { streamAgent } from '@/lib/agentStream';
import {
  hoverCacheKey,
  isCompleteHoverText,
  isSafeHoverDisplay,
  looksLikeHoverPlanning,
  readHoverCache,
  sanitizeHoverDisplay,
  writeHoverCache,
} from '@/lib/hoverExplainCache';
import {
  acquireExpand,
  beginCollapse,
  cancelExpandRequest,
  endCollapse,
} from '@/lib/cardExpandLock';

type Phase = 'summary' | 'thinking' | 'answer';
export type ArticleCardLayout = 'feed' | 'grid' | 'list';

/** 最短思考展示：缓存命中也略等，避免闪一下；尽量短以提升体感速度 */
const MIN_THINK_MS = 200;
const HOVER_ENTER_MS = 140;
const HOVER_LEAVE_MS = 320;
const FADE_MS = 160;

/**
 * 文章外卡片：悬停行内 Agent
 * - 默认固定高度
 * - 展开用 CSS max-height
 * - 全局锁：上一张收完才能展开下一张；等待期间显示「思考中」
 */
export function ArticleCardInlineAgent({
  article,
  layout = 'feed',
  to,
}: {
  article: ArticleSummary;
  layout?: ArticleCardLayout;
  to?: string;
}) {
  const reactId = useId();
  const lockId = `${article.id}:${reactId}`;

  const href = to || `/knowledge/${article.slug}`;
  const summary = (article.summary || '').trim();
  const preview =
    layout === 'list'
      ? summary.slice(0, 160) + (summary.length > 160 ? '…' : '')
      : layout === 'feed'
        ? summary.slice(0, 140) + (summary.length > 140 ? '…' : '')
        : summary.slice(0, 90) + (summary.length > 90 ? '…' : '');
  const topic = `${article.title}。${summary}`.slice(0, 800);

  const [phase, setPhase] = useState<Phase>('summary');
  const [answer, setAnswer] = useState('');
  const [bodyVisible, setBodyVisible] = useState(true);
  /** 是否允许 CSS 展开高度（拿到全局锁之后才 true） */
  const [expanded, setExpanded] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef = useRef(0);
  const pointerIn = useRef(false);
  const sessionOn = useRef(false);
  /** 已拿到展开锁 */
  const hasLock = useRef(false);
  /** 答案已就绪但还在等锁 / 最短思考时间 */
  const pendingAnswer = useRef<string | null>(null);
  const thinkStartedAt = useRef(0);

  const clearAllTimers = useCallback(() => {
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (thinkTimer.current) {
      clearTimeout(thinkTimer.current);
      thinkTimer.current = null;
    }
    if (fadeTimer.current) {
      clearTimeout(fadeTimer.current);
      fadeTimer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearAllTimers();
      abortRef.current?.abort();
      cancelExpandRequest(lockId);
      if (hasLock.current) {
        beginCollapse(lockId);
        endCollapse(lockId);
        hasLock.current = false;
      } else {
        // collapse() 把 beginCollapse 推迟到 fadeTimer 回调；
        // 若卸载先于回调触发，补一次释放，防止锁泄漏卡死后续卡片
        endCollapse(lockId);
      }
    },
    [clearAllTimers, lockId],
  );

  function setBody(next: () => void) {
    setBodyVisible(false);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      next();
      requestAnimationFrame(() => setBodyVisible(true));
    }, FADE_MS);
  }

  /**
   * 揭晓/更新正文：流式路径无 fade，避免整段替换导致高度突变；
   * 缓存命中或首次非流式揭晓才用短 fade。
   */
  function tryRevealAnswer(gen: number, opts?: { streamed?: boolean }) {
    if (gen !== genRef.current || !sessionOn.current) return;
    if (!hasLock.current) return; // 还在等上一张收起
    const text = pendingAnswer.current;
    if (text == null) return;

    const elapsed = Date.now() - thinkStartedAt.current;
    const wait = Math.max(0, MIN_THINK_MS - elapsed);
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    thinkTimer.current = setTimeout(() => {
      thinkTimer.current = null;
      if (gen !== genRef.current || !sessionOn.current || !hasLock.current) return;
      const finalText = pendingAnswer.current;
      if (finalText == null) return;
      // 流式已在展示：直接覆盖，不打断布局
      if (opts?.streamed) {
        pendingAnswer.current = null;
        setExpanded(true);
        setPhase('answer');
        setAnswer(finalText);
        setBodyVisible(true);
        return;
      }
      pendingAnswer.current = null;
      setBody(() => {
        setExpanded(true);
        setAnswer(finalText);
        setPhase('answer');
      });
    }, wait);
  }

  /**
   * 仅写入「安全讲解」。思考中不撑高卡片；首句到达再 expand，高度随文字增长。
   */
  function applySafePartial(gen: number, partial: string) {
    if (gen !== genRef.current || !sessionOn.current) return;
    if (!partial || !isSafeHoverDisplay(partial)) return;
    // 仅展示到完整句号（不展示？与半截）
    let show = partial;
    if (!/[。！]$/.test(show)) {
      const lastEnd = Math.max(show.lastIndexOf('。'), show.lastIndexOf('！'));
      if (lastEnd < 8) return;
      show = show.slice(0, lastEnd + 1);
      if (!isSafeHoverDisplay(show)) return;
    }
    pendingAnswer.current = show;
    if (!hasLock.current) return;

    const reveal = () => {
      if (gen !== genRef.current || !sessionOn.current || !hasLock.current) return;
      const t = pendingAnswer.current;
      if (!t || !isSafeHoverDisplay(t)) return;
      // 有正文再展开，避免「思考中」时空高卡片
      setExpanded(true);
      setPhase('answer');
      setAnswer(t);
      setBodyVisible(true);
    };

    const elapsed = Date.now() - thinkStartedAt.current;
    if (elapsed < MIN_THINK_MS) {
      if (thinkTimer.current) clearTimeout(thinkTimer.current);
      thinkTimer.current = setTimeout(() => {
        thinkTimer.current = null;
        reveal();
      }, MIN_THINK_MS - elapsed);
      return;
    }

    if (thinkTimer.current) {
      clearTimeout(thinkTimer.current);
      thinkTimer.current = null;
    }
    reveal();
  }

  async function runExplain() {
    const gen = ++genRef.current;
    // 与实际请求的 style: 'concise' 保持一致，否则缓存永远 miss
    const key = hoverCacheKey(topic, 'concise');
    const cached = readHoverCache(key);

    thinkStartedAt.current = Date.now();
    pendingAnswer.current = null;

    // 立刻「思考中」（等锁期间不展开高度，避免与上一张抢布局）
    setBody(() => {
      setPhase('thinking');
      setAnswer('');
    });

    const storeAnswer = (text: string, opts?: { streamed?: boolean }) => {
      if (gen !== genRef.current || !sessionOn.current) return;
      // 非安全文案：用失败提示，绝不展示思考原文
      const safe = isSafeHoverDisplay(text) ? text : sanitizeHoverDisplay(text);
      pendingAnswer.current =
        safe ||
        (text.startsWith('讲解') ? text : '讲解生成失败，请再悬停试一次');
      tryRevealAnswer(gen, opts);
    };

    // 并行拉答案（等锁时也在生成/读缓存）
    const fetchAnswer = async () => {
      if (cached && isSafeHoverDisplay(cached)) {
        storeAnswer(cached);
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        let finalText = '';
        let streamBuf = '';
        let didStream = false;
        await streamAgent(
          '/agent/explain/stream',
          {
            mode: 'hover',
            style: 'concise',
            selection: {
              text: topic,
              title: article.title,
              articleSlug: article.slug,
              route: typeof window !== 'undefined' ? window.location.pathname : '',
            },
          },
          (ev) => {
            if (gen !== genRef.current) return;
            // status/thinking：保持思考中，绝不写正文
            if (ev.type === 'status' || ev.type === 'thinking') {
              return;
            }
            // 后端仅在清洗后 soft-stream 洁净答案；仍做前端门控
            if (ev.type === 'delta' && ev.text) {
              if (ev.replace) streamBuf = ev.text;
              else streamBuf += ev.text;
              const partial = streamBuf.trim();
              // 旁白/规则：不展示（不清空缓冲，等后续洁净句）
              if (looksLikeHoverPlanning(partial) && !isSafeHoverDisplay(partial)) {
                return;
              }
              // 只展示到最后一个 。！
              let show = '';
              if (isSafeHoverDisplay(partial) && /[。！]$/.test(partial)) {
                show = partial;
              } else {
                const lastEnd = Math.max(partial.lastIndexOf('。'), partial.lastIndexOf('！'));
                if (lastEnd >= 8) {
                  const upto = partial.slice(0, lastEnd + 1);
                  if (isSafeHoverDisplay(upto)) show = upto;
                }
              }
              if (!show) return;
              didStream = true;
              applySafePartial(gen, show);
              return;
            }
            if (ev.type === 'final') {
              // 只信 final.answer；禁止用 streamBuf 回退成思考原文
              finalText = (ev.answer || '').trim();
            }
          },
          ac.signal,
          { timeoutMs: 28_000 },
        );
        if (gen !== genRef.current || !sessionOn.current) return;
        const cleaned =
          sanitizeHoverDisplay(finalText) ||
          (didStream ? sanitizeHoverDisplay(streamBuf) : '') ||
          '';
        const text = cleaned || '讲解生成失败，请再悬停试一次';
        if (isCompleteHoverText(text)) writeHoverCache(key, text);
        if (didStream && isSafeHoverDisplay(text)) {
          pendingAnswer.current = text;
          if (hasLock.current && Date.now() - thinkStartedAt.current >= MIN_THINK_MS) {
            setExpanded(true);
            setAnswer(text);
            setPhase('answer');
            setBodyVisible(true);
            pendingAnswer.current = null;
          } else {
            storeAnswer(text, { streamed: true });
          }
        } else {
          storeAnswer(text);
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (gen !== genRef.current || !sessionOn.current) return;
        storeAnswer('讲解暂时不可用，请稍后再试。');
      }
    };
    void fetchAnswer();

    // 等全局锁：上一张完全收回后才能展开高度
    try {
      await acquireExpand(lockId);
    } catch {
      // 被取消 / 被更新的悬停顶替
      return;
    }
    if (gen !== genRef.current || !sessionOn.current) {
      beginCollapse(lockId);
      endCollapse(lockId);
      hasLock.current = false;
      return;
    }
    hasLock.current = true;
    // 不在「思考中」就撑高卡片；有安全正文时再 expand
    tryRevealAnswer(gen);
  }

  function collapse() {
    sessionOn.current = false;
    pendingAnswer.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    genRef.current += 1;
    if (thinkTimer.current) {
      clearTimeout(thinkTimer.current);
      thinkTimer.current = null;
    }

    cancelExpandRequest(lockId);

    const had = hasLock.current;
    if (had) {
      hasLock.current = false;
    }

    setBodyVisible(false);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      setPhase('summary');
      setAnswer('');
      // 收起动画（max-height 过渡）从这次渲染才真正开始
      setExpanded(false);
      // 锁的 500ms 从收起动画开始时才起算，避免下一张在本卡仍在收起时就展开
      if (had) beginCollapse(lockId);
      requestAnimationFrame(() => setBodyVisible(true));
      // 等 CSS max-height 收起后再放行下一张（beginCollapse 内已有定时器）
      // 若本卡从未拿到锁，无需 endCollapse
    }, FADE_MS);
  }

  function onEnter() {
    pointerIn.current = true;
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (sessionOn.current) return;
    if (enterTimer.current) return;

    enterTimer.current = setTimeout(() => {
      enterTimer.current = null;
      if (!pointerIn.current) return;
      sessionOn.current = true;
      void runExplain();
    }, HOVER_ENTER_MS);
  }

  function onLeave() {
    pointerIn.current = false;
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    if (!sessionOn.current) return;

    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      if (pointerIn.current) return;
      collapse();
    }, HOVER_LEAVE_MS);
  }

  const isGrid = layout === 'grid';
  /** 思考中：未拿锁也显示思考；拿锁后展开高度 */
  const showThinking = phase === 'thinking' || (sessionOn.current && phase !== 'answer' && !answer);

  return (
    <Link
      to={href}
      className={[
        'card',
        'card-hover',
        'article-card-inline',
        `article-card-inline--${layout}`,
        expanded ? 'is-expanded' : 'is-collapsed',
        // 等锁时也可标记 pending，样式上保持思考文案
        !expanded && phase === 'thinking' ? 'is-pending-lock' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-agent-inline="1"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      <div className="article-card-inline-inner">
        <div className="article-card-inline-tags">
          {isGrid ? (
            <>
              <Tag>{article.level}</Tag>
              <Tag variant="outline">{article.readMinutes}m</Tag>
            </>
          ) : (
            <>
              <Tag variant="primary">{article.domain?.name || article.category}</Tag>
              <Tag>{article.level}</Tag>
              <Tag>{article.readMinutes} min</Tag>
              {typeof article.viewCount === 'number' && article.viewCount > 0 ? (
                <Tag>{article.viewCount} 阅</Tag>
              ) : null}
            </>
          )}
        </div>
        <div className="article-card-inline-title">{article.title}</div>
        <div
          className="article-card-inline-body"
          style={{
            opacity: bodyVisible ? 1 : 0,
            transform: bodyVisible ? 'translateY(0)' : 'translateY(4px)',
            transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
          }}
        >
          {phase === 'thinking' || (phase !== 'answer' && showThinking && sessionOn.current) ? (
            <div className="agent-thinking-indicator" style={{ fontSize: 12 }}>
              <span className="agent-thinking-dot" />
              <span className="agent-thinking-dot" style={{ animationDelay: '0.2s' }} />
              <span className="agent-thinking-dot" style={{ animationDelay: '0.4s' }} />
              <span>思考中…</span>
            </div>
          ) : phase === 'answer' ? (
            <MarkdownView
              source={answer}
              compact
              className="article-card-inline-text is-answer"
            />
          ) : (
            <p className="article-card-inline-text is-summary">
              {preview || '暂无简介'}
            </p>
          )}
        </div>
      </div>
      {layout === 'list' || layout === 'feed' ? (
        <span className="article-card-inline-cta" aria-hidden>
          →
        </span>
      ) : null}
    </Link>
  );
}
