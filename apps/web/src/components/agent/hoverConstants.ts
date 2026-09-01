/** 悬停快讲：目标稳定 debounce（防嵌套元素抖动） */
export const HOVER_SETTLE_MS = 60;
/** 悬停满 ~0.7s 显示气泡（后台立即预取） */
export const HOVER_REVEAL_MS = 700;
/** 气泡出现后最短「思考中」 */
export const HOVER_MIN_THINK_MS = 160;
/** 移出后保留 3s；指针在对话框内不消失 */
export const HOVER_LEAVE_KEEP_MS = 3000;
export const HOVER_FADE_MS = 180;
/** 新目标请求最小间隔 */
export const HOVER_REQUEST_COOLDOWN_MS = 280;
/** 10s 内最多 N 次新请求 */
export const HOVER_MAX_REQUESTS_PER_WINDOW = 8;
export const HOVER_REQUEST_WINDOW_MS = 10_000;
