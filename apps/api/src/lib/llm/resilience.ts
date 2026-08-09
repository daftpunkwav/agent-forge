/**
 * R-01 LLM 熔断器 + R-02 全局并发舱壁（单进程内）。
 *
 * 设计要点：
 * - 熔断按 provider（id::baseUrl）隔离：BYOK 用户各自独立，服务端 Provider 共享；
 * - 只有「上游真坏了」才计数（5xx/网络/超时 408）；4xx 是调用方配置问题，不熔断；
 * - half-open 只放行一个探测请求，成功即闭合，失败重开；
 * - 舱壁是进程级信号量：超出上限排队 LLM_QUEUE_WAIT_MS，仍无位则快速 503（降级不堆积）；
 * - 多副本部署时每实例独立计数（可接受的弱一致，见 docs 报告 P2-4）。
 */
import { logger } from '../logger.js';
import { LlmCallError, isAbortError, isRetriable } from './providerHttp.js';

type CircuitState = 'closed' | 'open' | 'half_open';

interface Circuit {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number;
  probeInFlight: boolean;
}

/** 连续失败多少次后开路（可用 LLM_CIRCUIT_FAILURES 覆盖） */
const FAILURE_THRESHOLD = Math.max(
  1,
  parseInt(process.env.LLM_CIRCUIT_FAILURES || '3', 10) || 3,
);
/** 开路冷却时长（可用 LLM_CIRCUIT_OPEN_MS 覆盖） */
const OPEN_MS = Math.max(
  1000,
  parseInt(process.env.LLM_CIRCUIT_OPEN_MS || '30000', 10) || 30000,
);

const circuits = new Map<string, Circuit>();

function circuitKey(provider: { id: string; baseUrl: string }): string {
  return `${provider.id}::${provider.baseUrl}`;
}

/** 该错误是否算「上游故障」（熔断计数口径：5xx/网络层/超时；主动取消与 4xx 不算） */
function isProviderFault(err: unknown): boolean {
  if (err instanceof LlmCallError) return isRetriable(err) || err.status === 408;
  if (err instanceof TypeError) return true; // fetch 网络层失败
  return false;
}

/**
 * 调用前检查：开路中 → 立即 503 快速失败；冷却到 → 转半开并放行一个探测。
 * 探测在飞时，其余请求快速失败（不并发探测）。
 */
export function assertCircuitClosed(provider: { id: string; baseUrl: string }): void {
  const key = circuitKey(provider);
  const c = circuits.get(key);
  if (!c || c.state === 'closed') return;

  if (c.state === 'open') {
    if (Date.now() - c.openedAt < OPEN_MS) {
      throw new LlmCallError(503, '模型暂时不可用（熔断保护中），请稍后重试', { url: '', raw: '' });
    }
    c.state = 'half_open';
    c.probeInFlight = false;
    logger.info({ event: 'llm_circuit_half_open', provider: key }, 'llm circuit half-open');
  }

  if (c.probeInFlight) {
    throw new LlmCallError(503, '模型恢复探测中，请稍后重试', { url: '', raw: '' });
  }
  c.probeInFlight = true;
}

/**
 * 解除半开探测标记（P0-1 修复）：探测请求因「未完成调用」结束（客户端断开、
 * 悬停早停、槽位排队超时）时调用，防止 probeInFlight 永久置位导致后续请求全 503。
 * 幂等：非半开状态或本就无探测在飞时无操作。
 */
export function releaseCircuitProbe(provider: { id: string; baseUrl: string }): void {
  const key = circuitKey(provider);
  const c = circuits.get(key);
  if (c?.state === 'half_open' && c.probeInFlight) {
    c.probeInFlight = false;
    logger.info({ event: 'llm_circuit_probe_released', provider: key }, 'llm circuit probe released');
  }
}

export function recordProviderSuccess(provider: { id: string; baseUrl: string }): void {
  const key = circuitKey(provider);
  const c = circuits.get(key);
  if (c && c.state !== 'closed') {
    logger.info({ event: 'llm_circuit_closed', provider: key }, 'llm circuit closed');
  }
  circuits.delete(key);
}

export function recordProviderFailure(provider: { id: string; baseUrl: string }, err: unknown): void {
  const key = circuitKey(provider);
  const c = circuits.get(key);

  // 半开探测结束：故障类错误 → 重开；非故障类（如客户端断开的主动取消）→ 解除探测标记，保持半开
  if (c?.state === 'half_open') {
    c.probeInFlight = false;
    if (isProviderFault(err)) {
      c.state = 'open';
      c.openedAt = Date.now();
      logger.warn({ event: 'llm_circuit_reopen', provider: key }, 'llm circuit re-opened');
    }
    return;
  }

  if (!isProviderFault(err) || isAbortError(err)) return;

  const next: Circuit = c || {
    state: 'closed',
    consecutiveFailures: 0,
    openedAt: 0,
    probeInFlight: false,
  };
  next.consecutiveFailures += 1;
  if (next.consecutiveFailures >= FAILURE_THRESHOLD) {
    next.state = 'open';
    next.openedAt = Date.now();
    logger.warn(
      {
        event: 'llm_circuit_open',
        provider: key,
        failures: next.consecutiveFailures,
        openMs: OPEN_MS,
      },
      'llm circuit opened',
    );
  }
  circuits.set(key, next);
}

/** 仅测试用：清空全部熔断状态 */
export function resetCircuits(): void {
  circuits.clear();
}

// ---------------- R-02 并发舱壁 ----------------

/** 进程内最大并发 LLM 调用数（可用 LLM_MAX_CONCURRENT 覆盖） */
const MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.LLM_MAX_CONCURRENT || '12', 10) || 12,
);
/** 排队等位时长，超时快速 503（可用 LLM_QUEUE_WAIT_MS 覆盖） */
const QUEUE_WAIT_MS = Math.max(
  0,
  parseInt(process.env.LLM_QUEUE_WAIT_MS || '5000', 10) || 5000,
);

let inFlight = 0;
const waiters: Array<{ resolve: () => void }> = [];

function makeRelease(): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight -= 1;
    // 名额直接移交给队首等待者，避免惊群竞争
    const next = waiters.shift();
    if (next) {
      inFlight += 1;
      next.resolve();
    }
  };
}

/**
 * 获取一个 LLM 并发名额；返回释放函数（必须 finally 调用）。
 * 满员时排队 LLM_QUEUE_WAIT_MS；超时抛 503——降级而非无限堆积。
 */
export async function acquireLlmSlot(): Promise<() => void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return makeRelease();
  }
  await new Promise<void>((resolve, reject) => {
    const entry = {
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
    };
    const timer = setTimeout(() => {
      const i = waiters.indexOf(entry);
      if (i >= 0) waiters.splice(i, 1);
      // code='LLM_CAPACITY'：本地并发满（与上游无关），failover 时据此排除，避免整条链空等
      reject(new LlmCallError(503, 'AI 服务繁忙，请稍后重试', { url: '', raw: '' }, 'LLM_CAPACITY'));
    }, QUEUE_WAIT_MS);
    waiters.push(entry);
  });
  return makeRelease();
}

/** 仅测试/观测用 */
export function llmSlotStats(): { inFlight: number; queued: number; max: number } {
  return { inFlight, queued: waiters.length, max: MAX_CONCURRENT };
}
