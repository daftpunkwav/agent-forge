import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

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
    // 无用户：保持 defaultStyle 初值，不强制回写（与 AgentFloat 一致）
    if (!user) return;
    api
      .getSettings()
      .then((r) => {
        const s = r.preferences.agentStyle;
        if (typeof s === 'string') setStyle(s);
      })
      .catch(() => undefined);
  }, [user, override]);

  return style;
}
