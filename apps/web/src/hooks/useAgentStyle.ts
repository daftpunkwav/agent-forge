import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getSettingsCached, invalidateSettingsCache } from '@/lib/settingsCache';

/**
 * 读取用户 preferences.agentStyle；无用户时保持 defaultStyle。
 * AgentFloat 默认 professional；卡片默认 concise。
 */
export function useAgentStyle(defaultStyle: string, override?: string) {
  const { user } = useAuth();
  const [style, setStyle] = useState(override || defaultStyle);

  useEffect(() => {
    if (override) {
      setStyle(override);
      return;
    }
    if (!user) {
      invalidateSettingsCache();
      return;
    }
    getSettingsCached(user.id)
      .then((r) => {
        const s = r.preferences.agentStyle;
        if (typeof s === 'string') setStyle(s);
      })
      .catch(() => undefined);
  }, [user, override]);

  return style;
}
