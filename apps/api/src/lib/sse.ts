/**
 * SSE 工具（C-02：自 routes/agent.ts 拆分）
 * initSse / sseWrite / softStreamHoverAnswer（按句 soft-stream）。
 */
import type { Response } from 'express';

export function initSse(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

export function sseWrite(res: Response, obj: unknown) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/** 按句 soft-stream；句间短延迟提升可读性 */
export async function softStreamHoverAnswer(res: Response, answer: string, gapMs = 36) {
  // C-08：分句补 ？…（isSafeHoverPublicAnswer 已拒问号，此处为稳健兜底）
  const pieces =
    answer.match(/[^。！？…]*[。！？…]/g)?.filter((x) => x.trim()) || (answer ? [answer] : []);
  for (let i = 0; i < pieces.length; i++) {
    if (res.writableEnded || res.destroyed) return;
    const piece = pieces[i];
    if (!piece) continue;
    sseWrite(res, { type: 'delta', text: piece });
    if (i < pieces.length - 1) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
}
