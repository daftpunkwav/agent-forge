/**
 * SSE 工具（C-02：自 routes/agent.ts 拆分）
 * initSse / sseWrite / softStreamHoverAnswer（按句 soft-stream）/ 会话生命周期。
 */
import type { Request, Response } from 'express';

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

/**
 * R-05：SSE 心跳——每 intervalMs 写一行注释，防止反代/NAT 空闲断连。
 * 返回停止函数，必须在响应收尾处调用。前端只解析 data: 行，注释天然忽略，契约不变。
 */
export function startSseHeartbeat(res: Response, intervalMs = 15_000): () => void {
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(': ping\n\n');
    } catch {
      /* 连接已异常，收尾逻辑会处理 */
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** SSE 会话句柄：统一持有心跳、取消信号与收尾资源（B-10 单点化，消除各端点的重复样板） */
export type SseSession = {
  res: Response;
  /** 客户端断开 / 主动 abort 时触发；供上游取消与早停使用 */
  signal: AbortSignal;
  /** 响应已结束或连接已破坏（客户端断开） */
  gone(): boolean;
  /** 触发 signal（悬停早停用） */
  abort(): void;
  /** 停心跳 + 解绑 close 监听（幂等）；收尾处调用 */
  stop(): void;
};

/**
 * 创建 SSE 会话：initSse + 心跳 + 客户端断开自动 abort 上游。
 * 调用方负责：流式消费 →（成功）sseWrite(done) /（失败）sseWrite(error) → 最后 endSseSession。
 */
export function createSseSession(req: Request, res: Response): SseSession {
  initSse(res);
  const stopHeartbeat = startSseHeartbeat(res);
  const controller = new AbortController();
  let stopped = false;
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.on('close', onClose);
  return {
    res,
    signal: controller.signal,
    gone: () => res.writableEnded || res.destroyed,
    abort: () => controller.abort(),
    stop() {
      if (stopped) return;
      stopped = true;
      stopHeartbeat();
      req.removeListener('close', onClose);
    },
  };
}

/**
 * 统一收尾（B-10）：停心跳/解绑 → 关闭未消费完的流（释放舱壁名额）→ res.end 防重。
 * 所有提前退出路径（缓存命中、客户端断开、错误）都必须走到这里。
 */
export async function endSseSession(
  session: SseSession,
  llmStream?: AsyncGenerator<unknown, void, unknown>,
): Promise<void> {
  session.stop();
  if (llmStream) {
    try {
      await llmStream.return();
    } catch {
      /* 已结束 */
    }
  }
  if (!session.res.writableEnded) {
    try {
      session.res.end();
    } catch {
      /* 已关闭 */
    }
  }
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
