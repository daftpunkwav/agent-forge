import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ACCENTS, useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api';
import { clearAllHoverCaches } from '@/lib/hoverExplainCache';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { Tag } from '@/components/ui/Tag';

type ApiFormat = 'anthropic_messages' | 'openai_chat' | 'openai_responses';

/**
 * BYOK 表单初始值：仅当用户尚无 BYOK 配置时作为默认占位展示。
 * 更换服务端默认供应商时同步调整这里（或改为从 /agent/providers 的 defaultId 派生）。
 */
const DEFAULT_BYOK = {
  name: 'StepFun',
  baseUrl: 'https://api.stepfun.com/step_plan',
  model: 'step-3.7-flash',
  format: 'anthropic_messages' as ApiFormat,
};

export function SettingsPage() {
  const { theme, toggle, setTheme, accent, setAccent } = useTheme();
  const { user } = useAuth();
  const [autoplay, setAutoplay] = useState(
    () => localStorage.getItem('ui.autoplay') === '1',
  );
  const [speed, setSpeed] = useState(() => localStorage.getItem('ui.anim-speed') || '1');
  const [agentStyle, setAgentStyle] = useState('professional');
  const [styles, setStyles] = useState<{ id: string; label: string }[]>([]);
  const [formats, setFormats] = useState<{ id: string; label: string; desc: string }[]>([]);
  const [serverProviders, setServerProviders] = useState<
    { id: string; name: string; model: string; format: string; vision: boolean }[]
  >([]);

  // BYOK
  const [byokEnabled, setByokEnabled] = useState(false);
  const [byokName, setByokName] = useState(DEFAULT_BYOK.name);
  const [byokBaseUrl, setByokBaseUrl] = useState(DEFAULT_BYOK.baseUrl);
  const [byokApiKey, setByokApiKey] = useState('');
  const [byokKeyMasked, setByokKeyMasked] = useState('');
  const [byokHasKey, setByokHasKey] = useState(false);
  const [byokModel, setByokModel] = useState(DEFAULT_BYOK.model);
  const [byokFormat, setByokFormat] = useState<ApiFormat>(DEFAULT_BYOK.format);
  const [byokVision, setByokVision] = useState(true);

  const [saved, setSaved] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const [cacheMsg, setCacheMsg] = useState('');
  const [clearingCache, setClearingCache] = useState(false);
  // 设置加载成功前禁止保存，避免用默认值覆盖已有 BYOK 配置
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    localStorage.setItem('ui.autoplay', autoplay ? '1' : '0');
  }, [autoplay]);

  useEffect(() => {
    localStorage.setItem('ui.anim-speed', speed);
  }, [speed]);

  useEffect(() => {
    if (!user) return;
    api
      .getSettings()
      .then((r) => {
        setSettingsLoaded(true);
        setLoadError('');
        setStyles(r.agentStyles || []);
        setFormats(r.apiFormats || []);
        setServerProviders(r.serverProviders || r.providers || []);
        if (typeof r.preferences.agentStyle === 'string') setAgentStyle(r.preferences.agentStyle);
        if (typeof r.preferences.autoplayAnim === 'boolean') setAutoplay(r.preferences.autoplayAnim);
        if (r.preferences.animSpeed != null) setSpeed(String(r.preferences.animSpeed));
        const b = r.preferences.byok as
          | {
              enabled?: boolean;
              baseUrl?: string;
              model?: string;
              format?: ApiFormat;
              name?: string;
              vision?: boolean;
              apiKeyMasked?: string;
              hasApiKey?: boolean;
            }
          | undefined;
        if (b) {
          setByokEnabled(Boolean(b.enabled));
          if (b.baseUrl) setByokBaseUrl(b.baseUrl);
          if (b.model) setByokModel(b.model);
          if (b.format) setByokFormat(b.format);
          if (b.name) setByokName(b.name);
          if (typeof b.vision === 'boolean') setByokVision(b.vision);
          setByokKeyMasked(b.apiKeyMasked || '');
          setByokHasKey(Boolean(b.hasApiKey));
        }
      })
      .catch(() => {
        // 加载失败时表单停留在默认值，提示错误并禁止保存，防止覆盖已有 BYOK 配置
        setLoadError('设置加载失败，请刷新页面重试；为避免覆盖已有 BYOK 配置，保存已暂时禁用');
      });
  }, [user]);

  async function saveAll() {
    if (!user) {
      setSaved('请先登录后再保存 BYOK 与 Agent 设置');
      return;
    }
    setSaved('');
    try {
      const body: Record<string, unknown> = {
        agentStyle,
        autoplayAnim: autoplay,
        animSpeed: Number(speed) || 1,
        byok: {
          enabled: byokEnabled,
          name: byokName,
          baseUrl: byokBaseUrl,
          model: byokModel,
          format: byokFormat,
          vision: byokVision,
          // 空字符串表示不改 key
          apiKey: byokApiKey.trim(),
        },
      };
      const r = await api.updateSettings(body);
      const b = r.preferences.byok as { apiKeyMasked?: string; hasApiKey?: boolean } | undefined;
      if (b) {
        setByokKeyMasked(b.apiKeyMasked || '');
        setByokHasKey(Boolean(b.hasApiKey));
        setByokApiKey('');
      }
      setSaved('已保存（API Key 仅存于你的账号，不会再次完整显示）');
    } catch (e) {
      setSaved(e instanceof ApiError ? e.message : '保存失败');
    }
  }

  async function testLlm() {
    if (!user) {
      setTestMsg('请先登录');
      return;
    }
    setTesting(true);
    setTestMsg('测试中…');
    try {
      // 先保存再测，避免测到旧配置
      await saveAll();
      const r = await api.testLlm();
      setTestMsg(`连通成功 · ${r.providerId} · ${r.model} · ${r.format} · ${r.sample}`);
    } catch (e) {
      setTestMsg(e instanceof ApiError ? e.message : '测试失败');
    } finally {
      setTesting(false);
    }
  }

  /** 清除 L1（浏览器）+ L2（服务端）悬停讲解缓存，强制全部重新生成 */
  async function clearAgentCache() {
    if (!user) {
      setCacheMsg('请先登录后再清除服务端缓存');
      return;
    }
    const ok = window.confirm(
      '确定清除全部 Agent 悬停讲解缓存？\n\n清除后卡片/气泡将重新请求模型生成，不再使用任何历史缓存。',
    );
    if (!ok) return;

    setClearingCache(true);
    setCacheMsg('清除中…');
    try {
      // 先清浏览器 L1（并通知 AgentFloat 清空其 Map）
      const l1 = clearAllHoverCaches();
      const r = await api.clearAgentCache();
      setCacheMsg(
        `已清除：浏览器缓存 ${l1} 条 · 服务端缓存 ${r.cleared} 条。请回到首页重新悬停卡片。`,
      );
    } catch (e) {
      // 服务端失败时 L1 已清，仍提示
      setCacheMsg(
        e instanceof ApiError
          ? `浏览器缓存已清，服务端失败：${e.message}`
          : '清除失败，请稍后重试',
      );
    } finally {
      setClearingCache(false);
    }
  }

  if (!user) {
    return (
      <div className="container" style={{ padding: '48px 24px', maxWidth: 720 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 36 }}>设置</h1>
        <p style={{ color: 'var(--muted-foreground)' }}>
          BYOK 与 Agent 记忆需登录后使用。<Link to="/login">去登录</Link>
        </p>
        <section className="card" style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>外观（本机）</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted-foreground)' }}>
            也可在顶栏使用图标快速切换。
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={toggle}
              aria-label={theme === 'dark' ? '切换浅色' : '切换深色'}
              title={theme === 'dark' ? '浅色' : '深色'}
              style={{ width: 40, height: 40, padding: 0, fontSize: 18 }}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.label}
                aria-label={a.label}
                onClick={() => setAccent(a.id)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: accent === a.id ? '2px solid var(--foreground)' : '1px solid var(--border)',
                  background: a.swatch,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '48px 24px', maxWidth: 720 }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 36, marginBottom: 28 }}>设置</h1>

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>外观</h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted-foreground)' }}>
          顶栏也可一键切换。深色为近黑微灰。
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setTheme('light')}
            aria-label="浅色"
            title="浅色"
            style={{
              width: 40,
              height: 40,
              padding: 0,
              fontSize: 18,
              outline: theme === 'light' ? '2px solid var(--primary)' : undefined,
              outlineOffset: 2,
            }}
          >
            ☀
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setTheme('dark')}
            aria-label="深色"
            title="深色"
            style={{
              width: 40,
              height: 40,
              padding: 0,
              fontSize: 18,
              outline: theme === 'dark' ? '2px solid var(--primary)' : undefined,
              outlineOffset: 2,
            }}
          >
            ☾
          </button>
          <span style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              title={a.label}
              aria-label={a.label}
              onClick={() => setAccent(a.id)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: accent === a.id ? '2px solid var(--foreground)' : '1px solid var(--border)',
                background: a.swatch,
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>学习 / 动画</h2>
        <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span>自动播放动画</span>
          <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
        </label>
        <Field label="默认播放速度">
          <Select value={speed} onChange={(e) => setSpeed(e.target.value)}>
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </Select>
        </Field>
      </section>

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Agent 说话风格</h2>
        <Field label="风格">
          <Select value={agentStyle} onChange={(e) => setAgentStyle(e.target.value)}>
            {(styles.length
              ? styles
              : [
                  { id: 'professional', label: '专业' },
                  { id: 'friendly', label: '热情' },
                  { id: 'sassy', label: '毒舌' },
                  { id: 'concise', label: '简洁' },
                  { id: 'socratic', label: '苏格拉底' },
                ]
            ).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Agent 缓存</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
          悬停讲解会缓存到浏览器（L1）与服务器（L2），以便重复悬停更快。若出现过时或错误的讲解内容，可在此全部清除；
          之后所有卡片/知识点都需重新调用模型生成，无法再读取旧缓存。
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button
            type="button"
            variant="secondary"
            disabled={clearingCache}
            onClick={() => void clearAgentCache()}
          >
            {clearingCache ? '清除中…' : '清除 Agent 缓存'}
          </Button>
          {cacheMsg ? (
            <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{cacheMsg}</span>
          ) : null}
        </div>
      </section>

      {/* BYOK */}
      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>BYOK · 自带模型密钥</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
          系统优先使用你在此配置的 Base URL / API Key / 模型 / 格式。密钥仅保存在你的账号数据中，前端再次打开只显示掩码。
          Anthropic 兼容时 Base 填到根路径即可（如 <code>https://api.stepfun.com/step_plan</code>
          ），系统会自动请求 <code>/v1/messages</code>。
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={byokEnabled}
            onChange={(e) => setByokEnabled(e.target.checked)}
          />
          <span style={{ fontWeight: 600 }}>启用 BYOK</span>
        </label>

        <Field label="提供商名称（可选）">
          <Input value={byokName} onChange={(e) => setByokName(e.target.value)} placeholder="StepFun" />
        </Field>
        <Field label="Base URL" hint="不要带 /messages；step_plan 根路径即可">
          <Input
            value={byokBaseUrl}
            onChange={(e) => setByokBaseUrl(e.target.value)}
            placeholder="https://api.stepfun.com/step_plan"
          />
        </Field>
        <Field
          label="API Key"
          hint={
            byokHasKey
              ? `已保存：${byokKeyMasked}（留空则保持原 Key）`
              : '粘贴你的密钥，保存后不会再次完整显示'
          }
        >
          <Input
            type="password"
            autoComplete="off"
            value={byokApiKey}
            onChange={(e) => setByokApiKey(e.target.value)}
            placeholder={byokHasKey ? '•••• 留空不修改' : 'sk-... 或平台密钥'}
          />
        </Field>
        <Field label="模型 ID">
          <Input value={byokModel} onChange={(e) => setByokModel(e.target.value)} placeholder="step-3.7-flash" />
        </Field>
        <Field label="API 格式">
          <Select value={byokFormat} onChange={(e) => setByokFormat(e.target.value as ApiFormat)}>
            {(formats.length
              ? formats
              : [
                  { id: 'anthropic_messages', label: 'Anthropic Messages', desc: '' },
                  { id: 'openai_chat', label: 'OpenAI Chat Completions', desc: '' },
                  { id: 'openai_responses', label: 'OpenAI Responses', desc: '' },
                ]
            ).map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={byokVision}
            onChange={(e) => setByokVision(e.target.checked)}
          />
          <span style={{ fontSize: 14 }}>支持图片输入（多模态）</span>
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button disabled={!settingsLoaded} onClick={() => void saveAll()}>
            保存设置
          </Button>
          <Button variant="secondary" disabled={testing || !settingsLoaded} onClick={() => void testLlm()}>
            {testing ? '测试中…' : '测试连通'}
          </Button>
        </div>
        {loadError ? <p style={{ fontSize: 13, color: 'var(--destructive)' }}>{loadError}</p> : null}
        {saved ? <p style={{ fontSize: 13, color: 'var(--chart-3)' }}>{saved}</p> : null}
        {testMsg ? (
          <p style={{ fontSize: 13, color: testMsg.includes('成功') ? 'var(--chart-3)' : 'var(--destructive)' }}>
            {testMsg}
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>服务端兜底 Provider（可选）</h2>
        <p style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 0 }}>
          若未启用 BYOK，将尝试使用服务器环境变量中的默认模型。
        </p>
        {serverProviders.length ? (
          serverProviders.map((p) => (
            <div key={p.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <Tag variant="primary">{p.name}</Tag>
              <Tag>{p.model}</Tag>
              <Tag variant="outline">{p.format}</Tag>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>无服务端默认 Key（完全依赖 BYOK）</p>
        )}
      </section>
    </div>
  );
}
