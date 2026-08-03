/** preferences JSON 解析（C-06：settings.ts 与 agent.ts 共用，消除双份实现） */

export function parsePrefs(raw?: string | null): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}
