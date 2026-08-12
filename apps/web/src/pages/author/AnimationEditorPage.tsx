import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ANIMATION_TEMPLATES, type AnimationStep } from '@core/contracts';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { resolveDefaultSteps } from '@/components/anim/registry';
import { VISUAL_KIND_DOCS } from '@/components/anim/templates/defaultSteps';
import { AnimationViewer } from '@/components/anim/AnimationViewer';
import { visualKindForTemplate } from '@/components/anim/core/buildScene';
import { Field, Input, Select, TextArea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function AnimationEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthor, loading: authLoading } = useAuth();

  const initialTemplate = params.get('template') || 'react';
  const [name, setName] = useState('未命名动画');
  const [template, setTemplate] = useState(initialTemplate);
  const [steps, setSteps] = useState<AnimationStep[]>(
    () => resolveDefaultSteps(initialTemplate),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [animId, setAnimId] = useState<string | null>(isNew ? null : id!);

  useEffect(() => {
    if (isNew || !id) return;
    api
      .getAnimation(id)
      .then((r) => {
        setName(r.animation.name);
        setTemplate(r.animation.template);
        setSteps(r.animation.steps);
        setAnimId(r.animation.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [id, isNew]);

  const preview = useMemo(
    () => ({
      id: animId || 'preview',
      name,
      template,
      steps,
    }),
    [animId, name, template, steps],
  );

  function onTemplateChange(t: string) {
    setTemplate(t);
    setSteps(resolveDefaultSteps(t));
  }

  function updateStep(i: number, patch: Partial<AnimationStep>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { label: `步骤 ${prev.length + 1}`, desc: '', type: 'step' }]);
  }

  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  function moveStep(i: number, dir: -1 | 1) {
    setSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setError('');
    if (!steps.length) {
      setError('至少需要一步');
      return;
    }
    setSaving(true);
    try {
      if (!animId) {
        const res = await api.createAnimation({ name, template, steps });
        setAnimId(res.animation.id);
        navigate(`/author/animations/${res.animation.id}/edit`, { replace: true });
      } else {
        await api.updateAnimation(animId, { name, template, steps });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) return <div className="container" style={{ padding: 64 }}>加载中…</div>;
  if (!isAuthor) {
    return (
      <div className="container" style={{ padding: 64 }}>
        需要作者权限
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '32px 24px 80px' }}>
      <Link to="/author" style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
        ← 返回工作台
      </Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, margin: '12px 0 24px' }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, margin: 0 }}>
          {isNew ? '新建动画' : '编辑动画'}
        </h1>
        <Button disabled={saving} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>

      {error ? <p style={{ color: 'var(--destructive)' }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 24 }}>
        <div>
          <Field label="名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="模板（决定可视化类型）">
            <Select value={template} onChange={(e) => onTemplateChange(e.target.value)}>
              {ANIMATION_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} — {t.desc}
                </option>
              ))}
            </Select>
          </Field>
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: -8, marginBottom: 16 }}>
            当前可视化：
            <strong style={{ color: 'var(--foreground)' }}> {visualKindForTemplate(template)}</strong>
            {' · '}
            {VISUAL_KIND_DOCS.find((d) => d.kind === visualKindForTemplate(template))?.desc}
          </p>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 16, lineHeight: 1.6 }}>
            步骤 <code>type</code> 决定高亮相位。ReAct 请使用 thought / action / observation / answer；环会按
            Thought→Action→Observation 循环直到 Answer。
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>步骤参数</h2>
            <Button size="sm" variant="ghost" onClick={addStep}>
              + 添加步骤
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {steps.map((s, i) => (
              <div key={i} className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ font: '600 12px/1 var(--font-mono)', color: 'var(--muted-foreground)' }}>
                    STEP {i + 1}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={() => moveStep(i, -1)}>
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => moveStep(i, 1)}>
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeStep(i)}>
                      删
                    </Button>
                  </div>
                </div>
                <Field label="标签">
                  <Input value={s.label} onChange={(e) => updateStep(i, { label: e.target.value })} />
                </Field>
                <Field label="类型 type">
                  <Input value={s.type || ''} onChange={(e) => updateStep(i, { type: e.target.value })} />
                </Field>
                <Field label="说明">
                  <TextArea
                    rows={2}
                    value={s.desc || ''}
                    onChange={(e) => updateStep(i, { desc: e.target.value })}
                  />
                </Field>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>实时预览</h2>
          <AnimationViewer animation={preview} />
          {animId ? (
            <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
              文章中插入：
              <code>{`:::animation{id="${animId}"}:::`}</code>
            </p>
          ) : null}
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .container > div[style*="grid-template-columns: minmax"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
