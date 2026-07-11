import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary } from '@agentforge/shared';
import { Tag } from '@/components/ui/Tag';
import { streamAgent } from '@/lib/agentStream';
import {
  hoverCacheKey,
  isCompleteHoverText,
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

const MIN_THINK_MS = 618;
const HOVER_ENTER_MS = 280;
const HOVER_LEAVE_MS = 420;
const FADE_MS = 220;

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

  /** 在锁已持有 + 最短思考时间满足后揭晓答案 */
  function tryRevealAnswer(gen: number) {
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
      pendingAnswer.current = null;
      setBody(() => {
        setAnswer(finalText);
        setPhase('answer');
      });
    }, wait);
  }

  async function runExplain() {
    const gen = ++genRef.current;
    const key = hoverCacheKey(topic);
    const cached = readHoverCache(key);

    thinkStartedAt.current = Date.now();
    pendingAnswer.current = null;

    // 立刻「思考中」（等锁期间不展开高度，避免与上一张抢布局）
    setBody(() => {
      setPhase('thinking');
      setAnswer('');
    });

    const storeAnswer = (text: string) => {
      if (gen !== genRef.current || !sessionOn.current) return;
      pendingAnswer.current = text;
      tryRevealAnswer(gen);
    };

    // 并行拉答案（等锁时也在生成/读缓存）
    const fetchAnswer = async () => {
      if (cached) {
        storeAnswer(cached);
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        let finalText = '';
        let streamBuf = '';
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
            // 卡片也支持流式：有锁且已过最短思考后，边收边显示
            if (ev.type === 'delta' && ev.text) {
              streamBuf += ev.text;
              if (looksLikeHoverPlanning(streamBuf)) return;
              if (hasLock.current && Date.now() - thinkStartedAt.current >= MIN_THINK_MS) {
                const partial = streamBuf.trim();
                pendingAnswer.current = partial;
                // 流式更新 UI（已展开且过最短思考）
                setPhase('answer');
                setAnswer(partial);
                setBodyVisible(true);
              }
              return;
            }
            if (ev.type === 'final') {
              finalText = (ev.answer || streamBuf || '').trim();
            }
          },
          ac.signal,
        );
        if (gen !== genRef.current || !sessionOn.current) return;
        const cleaned =
          sanitizeHoverDisplay(finalText) ||
          sanitizeHoverDisplay(streamBuf) ||
          finalText ||
          streamBuf.trim();
        const text =
          cleaned && !looksLikeHoverPlanning(cleaned)
            ? cleaned
            : cleaned || '讲解生成失败，请再悬停试一次';
        if (isCompleteHoverText(text)) writeHoverCache(key, text);
        storeAnswer(text);
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
    setExpanded(true);
    // 锁到手后再尝试揭晓（答案可能已在等锁时就绪）
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
      beginCollapse(lockId);
    }

    setBodyVisible(false);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      setPhase('summary');
      setAnswer('');
      setExpanded(false);
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
          ) : (
            <p
              className={[
                'article-card-inline-text',
                phase === 'answer' ? 'is-answer' : 'is-summary',
              ].join(' ')}
            >
              {phase === 'answer' ? answer : preview || '暂无简介'}
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
