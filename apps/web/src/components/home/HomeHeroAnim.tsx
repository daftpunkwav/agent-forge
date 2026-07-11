import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * 首页 Hero 视觉：黄金比 1.618:1 长条
 * 有机流体 + 星座节点 + 光斑跟随鼠标，减少「割裂的方盒子」感
 */
const LABELS = ['Sense', 'Plan', 'Act', 'Memory', 'Loop'];

export function HomeHeroAnim() {
  const rootRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const target = useRef({ x: 0.55, y: 0.48 });
  const current = useRef({ x: 0.55, y: 0.48 });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % LABELS.length), 2400);
    return () => clearInterval(id);
  }, []);

  // 平滑追随指针
  useEffect(() => {
    const loop = () => {
      const t = target.current;
      const c = current.current;
      c.x += (t.x - c.x) * 0.08;
      c.y += (t.y - c.y) * 0.08;
      const el = rootRef.current;
      if (el) {
        el.style.setProperty('--mx', String(c.x));
        el.style.setProperty('--my', String(c.y));
        el.style.setProperty('--dx', `${(c.x - 0.5) * 28}px`);
        el.style.setProperty('--dy', `${(c.y - 0.5) * 18}px`);
        el.style.setProperty('--dx2', `${(c.x - 0.5) * -16}px`);
        el.style.setProperty('--dy2', `${(c.y - 0.5) * -12}px`);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const onMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    target.current = {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }, []);

  const onLeave = useCallback(() => {
    target.current = { x: 0.55, y: 0.48 };
  }, []);

  return (
    <div
      ref={rootRef}
      className="hero-flow"
      aria-hidden
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {/* 背景有机色块 */}
      <div className="hero-flow-blob hero-flow-blob-a" />
      <div className="hero-flow-blob hero-flow-blob-b" />
      <div className="hero-flow-blob hero-flow-blob-c" />
      <div className="hero-flow-spotlight" />

      <svg className="hero-flow-svg" viewBox="0 0 1618 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="hfStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.75" />
            <stop offset="55%" stopColor="var(--primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--foreground)" stopOpacity="0.12" />
          </linearGradient>
          <filter id="hfSoft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* 不规则流线（非正圆） */}
        <g className="hero-flow-layer hero-flow-layer-back">
          <path
            className="hero-flow-path"
            d="M120 720 C 280 180, 520 900, 780 320 S 1200 80, 1520 540"
            fill="none"
            stroke="url(#hfStroke)"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            className="hero-flow-path hero-flow-path-2"
            d="M80 280 C 360 40, 600 760, 900 420 S 1280 900, 1560 360"
            fill="none"
            stroke="url(#hfStroke)"
            strokeWidth="1.4"
            strokeDasharray="10 16"
            opacity="0.7"
          />
        </g>

        {/* 中景节点：不规则散布 */}
        <g className="hero-flow-layer hero-flow-layer-mid">
          {[
            [220, 380, 11],
            [410, 620, 8],
            [680, 240, 14],
            [920, 560, 9],
            [1180, 300, 12],
            [1380, 680, 7],
            [540, 480, 6],
            [1050, 420, 10],
          ].map(([x, y, r], i) => (
            <g key={i} className={`hero-flow-node hero-flow-node-${i % 4}`}>
              <circle cx={x} cy={y} r={r + 10} fill="var(--primary)" opacity="0.08" filter="url(#hfSoft)" />
              <circle cx={x} cy={y} r={r} fill="var(--card)" stroke="var(--primary)" strokeWidth="1.6" />
            </g>
          ))}
          {/* 连线（松散） */}
          <path
            d="M220 380 L410 620 L680 240 L920 560 L1180 300"
            fill="none"
            stroke="color-mix(in srgb, var(--primary) 28%, transparent)"
            strokeWidth="1"
            className="hero-flow-mesh"
          />
        </g>

        {/* 前景：字标漂移 */}
        <g className="hero-flow-layer hero-flow-layer-front">
          <text x="180" y="200" className="hero-flow-watermark">
            AGENT
          </text>
          <text x="980" y="820" className="hero-flow-watermark hero-flow-watermark-2">
            FORGE
          </text>
        </g>
      </svg>

      <div className="hero-flow-label">
        <span className="hero-flow-pulse" />
        <span key={tick} className="hero-flow-label-text">
          {LABELS[tick]}
        </span>
      </div>

      <style>{`
        .hero-flow {
          --mx: 0.55;
          --my: 0.48;
          --dx: 0px;
          --dy: 0px;
          --dx2: 0px;
          --dy2: 0px;
          position: relative;
          width: 100%;
          max-width: 520px;
          /* 黄金比 1.618 : 1 */
          aspect-ratio: 1.618 / 1;
          border-radius: 28% 18% 32% 22% / 36% 28% 42% 24%;
          border: 1px solid color-mix(in srgb, var(--border) 80%, var(--primary));
          overflow: hidden;
          isolation: isolate;
          background:
            radial-gradient(
              120% 90% at calc(var(--mx) * 100%) calc(var(--my) * 100%),
              color-mix(in srgb, var(--primary) 16%, transparent),
              transparent 55%
            ),
            linear-gradient(
              125deg,
              color-mix(in srgb, var(--card) 88%, var(--primary)),
              var(--card) 40%,
              color-mix(in srgb, var(--muted) 35%, var(--card))
            );
          box-shadow:
            0 20px 50px color-mix(in srgb, var(--foreground) 6%, transparent),
            inset 0 1px 0 color-mix(in srgb, #fff 6%, transparent);
          cursor: crosshair;
          touch-action: none;
        }

        .hero-flow-blob {
          position: absolute;
          border-radius: 60% 40% 55% 45% / 50% 55% 45% 50%;
          filter: blur(2px);
          pointer-events: none;
          will-change: transform;
        }
        .hero-flow-blob-a {
          width: 55%;
          height: 70%;
          left: 8%;
          top: 10%;
          background: color-mix(in srgb, var(--primary) 18%, transparent);
          transform: translate(var(--dx), var(--dy));
          animation: hero-morph 11s ease-in-out infinite alternate;
        }
        .hero-flow-blob-b {
          width: 48%;
          height: 62%;
          right: 0;
          bottom: 5%;
          background: color-mix(in srgb, var(--chart-2, #aea4fd) 16%, transparent);
          transform: translate(var(--dx2), var(--dy2));
          animation: hero-morph 14s ease-in-out infinite alternate-reverse;
          border-radius: 40% 60% 35% 65% / 55% 30% 70% 45%;
        }
        .hero-flow-blob-c {
          width: 30%;
          height: 40%;
          left: 40%;
          top: 35%;
          background: color-mix(in srgb, var(--primary) 10%, transparent);
          transform: translate(calc(var(--dx) * -0.4), calc(var(--dy) * 0.6));
          filter: blur(18px);
        }
        .hero-flow-spotlight {
          position: absolute;
          width: 42%;
          height: 58%;
          left: calc(var(--mx) * 100% - 21%);
          top: calc(var(--my) * 100% - 29%);
          border-radius: 50%;
          background: radial-gradient(
            circle,
            color-mix(in srgb, var(--primary) 28%, transparent),
            transparent 68%
          );
          pointer-events: none;
          mix-blend-mode: soft-light;
          transition: opacity 0.3s ease;
        }

        .hero-flow-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
        }
        .hero-flow-layer-back {
          transform: translate(calc(var(--dx2) * 0.6), calc(var(--dy2) * 0.6));
        }
        .hero-flow-layer-mid {
          transform: translate(calc(var(--dx) * 0.45), calc(var(--dy) * 0.45));
        }
        .hero-flow-layer-front {
          transform: translate(calc(var(--dx) * 0.2), calc(var(--dy) * 0.2));
        }
        .hero-flow-path {
          stroke-dasharray: 12 18;
          animation: hero-dash 14s linear infinite;
        }
        .hero-flow-path-2 {
          animation-duration: 18s;
          animation-direction: reverse;
        }
        .hero-flow-mesh {
          stroke-dasharray: 4 12;
          animation: hero-dash 20s linear infinite;
        }
        .hero-flow-node-0 { animation: hero-float 5s ease-in-out infinite; }
        .hero-flow-node-1 { animation: hero-float 6.2s ease-in-out 0.4s infinite; }
        .hero-flow-node-2 { animation: hero-float 4.6s ease-in-out 0.8s infinite; }
        .hero-flow-node-3 { animation: hero-float 7s ease-in-out 0.2s infinite; }

        .hero-flow-watermark {
          font: 700 120px/1 var(--font-serif);
          fill: color-mix(in srgb, var(--foreground) 5%, transparent);
          letter-spacing: -0.04em;
        }
        .hero-flow-watermark-2 {
          font-size: 96px;
          fill: color-mix(in srgb, var(--primary) 8%, transparent);
        }

        .hero-flow-label {
          position: absolute;
          left: 6%;
          bottom: 10%;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 12px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--background) 55%, transparent);
          border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
          backdrop-filter: blur(8px);
          font: 600 11px/1 var(--font-mono);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground);
          transform: translate(calc(var(--dx) * 0.15), calc(var(--dy) * 0.15));
        }
        .hero-flow-pulse {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--primary);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent);
          animation: hero-blink 1.3s ease-in-out infinite;
        }
        .hero-flow-label-text {
          animation: hero-fade 0.4s ease both;
        }

        @keyframes hero-morph {
          0% { border-radius: 60% 40% 55% 45% / 50% 55% 45% 50%; }
          50% { border-radius: 42% 58% 38% 62% / 60% 35% 65% 40%; }
          100% { border-radius: 55% 45% 60% 40% / 45% 60% 40% 55%; }
        }
        @keyframes hero-dash {
          to { stroke-dashoffset: -220; }
        }
        @keyframes hero-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes hero-blink {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 1; }
        }
        @keyframes hero-fade {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-flow-blob-a, .hero-flow-blob-b, .hero-flow-path, .hero-flow-path-2,
          .hero-flow-mesh, .hero-flow-node-0, .hero-flow-node-1, .hero-flow-node-2,
          .hero-flow-node-3, .hero-flow-pulse, .hero-flow-label-text {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
