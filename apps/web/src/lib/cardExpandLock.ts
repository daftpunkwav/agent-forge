/**
 * 全局卡片展开锁：同一时间只允许一张卡片处于 expanded 高度。
 * 新卡片在上一张完成收起动画前不得展开，可先显示「思考中」。
 */

const COLLAPSE_MS = 420; // 与 CSS max-height 0.4s 过渡对齐

type Waiter = {
  id: string;
  resolve: () => void;
  reject: (e: Error) => void;
};

let holderId: string | null = null;
let collapsingId: string | null = null;
let collapseTimer: ReturnType<typeof setTimeout> | null = null;
/** 只保留最新等待者（用户当前悬停的那张） */
let waiter: Waiter | null = null;

function flushWaiter() {
  if (holderId || collapsingId) return;
  if (!waiter) return;
  const w = waiter;
  waiter = null;
  holderId = w.id;
  w.resolve();
}

/**
 * 申请展开资格。若有其他卡片占用/正在收起，则排队，
 * 直到其收起完成后再 resolve。
 */
export function acquireExpand(id: string): Promise<void> {
  // 自己已占用
  if (holderId === id && !collapsingId) {
    return Promise.resolve();
  }

  // 空闲：立刻占用
  if (!holderId && !collapsingId) {
    holderId = id;
    return Promise.resolve();
  }

  // 取消同 id 的旧等待：先 reject 旧 waiter，避免其 Promise 永远悬挂
  //（调用方 runExplain 已 try/catch，不会产生 unhandled rejection）
  if (waiter?.id === id) {
    waiter.reject(new Error('superseded'));
    return new Promise<void>((resolve, reject) => {
      waiter = { id, resolve, reject };
    });
  }

  // 新的等待者顶替旧的
  if (waiter) {
    waiter.reject(new Error('superseded'));
    waiter = null;
  }

  return new Promise<void>((resolve, reject) => {
    waiter = { id, resolve, reject };
    // 若此刻已空闲（竞态），立刻放行
    flushWaiter();
  });
}

/** 开始收起（进入收起动画） */
export function beginCollapse(id: string) {
  if (holderId !== id) {
    // 未占用者：清掉等待即可
    if (waiter?.id === id) {
      waiter.reject(new Error('cancelled'));
      waiter = null;
    }
    return;
  }
  collapsingId = id;
  if (collapseTimer) clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    endCollapse(id);
  }, COLLAPSE_MS);
}

/** 收起动画结束（也可手动调用） */
export function endCollapse(id: string) {
  if (collapsingId && collapsingId !== id) return;
  if (holderId === id) holderId = null;
  collapsingId = null;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  flushWaiter();
}

/** 取消排队 / 释放未展开的占用 */
export function cancelExpandRequest(id: string) {
  if (waiter?.id === id) {
    waiter.reject(new Error('cancelled'));
    waiter = null;
  }
  // 已是 holder 且未在收起：不在这里收起，由卡片 collapse 流程处理
}

export function isExpandHeldBy(id: string): boolean {
  return holderId === id && !collapsingId;
}

export function getCollapseDuration(): number {
  return COLLAPSE_MS;
}
