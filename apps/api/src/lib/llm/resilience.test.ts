import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import {
  acquireLlmSlot,
  assertCircuitClosed,
  recordProviderFailure,
  recordProviderSuccess,
  releaseCircuitProbe,
  resetCircuits,
  llmSlotStats,
} from './resilience.js';
import { LlmCallError } from './providerHttp.js';

const P = { id: 'stepfun', baseUrl: 'https://api.stepfun.com/step_plan' };
const serverError = new LlmCallError(502, 'bad gateway', { url: '', raw: '' });
const clientError = new LlmCallError(400, 'bad request', { url: '', raw: '' });

afterEach(() => {
  vi.useRealTimers();
});

describe('R-01 circuit breaker', () => {
  beforeEach(() => resetCircuits());

  it('连续失败达阈值后开路，快速 503', () => {
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    expect(() => assertCircuitClosed(P)).toThrowError(/熔断保护中/);
  });

  it('4xx 不计入熔断', () => {
    for (let i = 0; i < 10; i++) recordProviderFailure(P, clientError);
    expect(() => assertCircuitClosed(P)).not.toThrow();
  });

  it('成功后复位', () => {
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    recordProviderSuccess(P);
    expect(() => assertCircuitClosed(P)).not.toThrow();
  });

  it('不同 provider 相互隔离', () => {
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    expect(() =>
      assertCircuitClosed({ id: 'openai', baseUrl: 'https://api.openai.com/v1' }),
    ).not.toThrow();
  });

  it('冷却期后转半开：放行一个探测请求，其余快速失败', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    // 冷却期未到：仍开路
    expect(() => assertCircuitClosed(P)).toThrowError(/熔断保护中/);
    // 冷却期已过：半开放行探测（不抛）
    vi.setSystemTime(new Date('2026-08-09T00:00:31Z'));
    expect(() => assertCircuitClosed(P)).not.toThrow();
    // 探测在飞：其余请求快速失败
    expect(() => assertCircuitClosed(P)).toThrowError(/探测中/);
    // 探测成功 → 闭合复位
    recordProviderSuccess(P);
    expect(() => assertCircuitClosed(P)).not.toThrow();
  });

  it('半开探测失败 → 重开', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    vi.setSystemTime(new Date('2026-08-09T00:00:31Z'));
    expect(() => assertCircuitClosed(P)).not.toThrow(); // 半开放行探测
    recordProviderFailure(P, serverError); // 探测失败
    expect(() => assertCircuitClosed(P)).toThrowError(/熔断保护中/); // 重开
  });

  it('探测中途未完成（客户端断开/早停）→ releaseCircuitProbe 解除标记，后续请求不卡死', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    vi.setSystemTime(new Date('2026-08-09T00:00:31Z'));
    expect(() => assertCircuitClosed(P)).not.toThrow(); // 半开放行探测
    // 探测请求未完成即结束：不产生 success/failure 记录
    releaseCircuitProbe(P);
    // 标记已解除：下一次调用可再次放行探测，而非永久「探测中」503
    expect(() => assertCircuitClosed(P)).not.toThrow();
    // 幂等：重复调用无副作用
    releaseCircuitProbe(P);
    expect(() => assertCircuitClosed(P)).not.toThrow();
  });

  it('releaseCircuitProbe 对 closed/open 状态无副作用', () => {
    releaseCircuitProbe(P); // 无 circuit
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    releaseCircuitProbe(P); // open 状态：不动
    expect(() => assertCircuitClosed(P)).toThrowError(/熔断保护中/);
  });
});

describe('R-02 bulkhead', () => {
  it('名额获取与释放', async () => {
    const r1 = await acquireLlmSlot();
    expect(llmSlotStats().inFlight).toBeGreaterThan(0);
    r1();
    expect(llmSlotStats().inFlight).toBe(0);
  });

  it('重复释放是幂等的（不把别人的名额释放掉）', async () => {
    const r1 = await acquireLlmSlot();
    r1();
    r1();
    expect(llmSlotStats().inFlight).toBe(0);
    const r2 = await acquireLlmSlot();
    expect(llmSlotStats().inFlight).toBe(1);
    r2();
  });
});
