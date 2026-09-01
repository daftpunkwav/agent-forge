import { api } from '@/lib/api';

type SettingsResponse = Awaited<ReturnType<typeof api.getSettings>>;

let snapshot: SettingsResponse | null = null;
let loadedForUserId: string | null = null;
let inflight: Promise<SettingsResponse> | null = null;

/** 清空缓存（登出、保存设置后） */
export function invalidateSettingsCache(): void {
  snapshot = null;
  loadedForUserId = null;
  inflight = null;
}

/** 同用户并发去重：多卡片/组件共享一次 /settings/me */
export function getSettingsCached(userId: string): Promise<SettingsResponse> {
  if (snapshot && loadedForUserId === userId) {
    return Promise.resolve(snapshot);
  }
  if (!inflight) {
    inflight = api
      .getSettings()
      .then((r) => {
        snapshot = r;
        loadedForUserId = userId;
        return r;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** 保存后写入缓存，避免再次请求 */
export function applySettingsSnapshot(userId: string, data: SettingsResponse): void {
  snapshot = data;
  loadedForUserId = userId;
}
