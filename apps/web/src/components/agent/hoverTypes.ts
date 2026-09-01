/** 悬停快讲：气泡与会话类型（供 useHoverAgent / document listeners 共享） */

export type HoverTipState = {
  x: number;
  y: number;
  text: string;
  loading?: boolean;
  topic?: string;
  anim: 'visible' | 'leaving';
};

export type HoverSession = {
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
};
