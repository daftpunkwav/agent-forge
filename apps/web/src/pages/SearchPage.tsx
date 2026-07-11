import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ArticleSummary, DomainSummary } from '@agentforge/shared';
import { api } from '@/lib/api';
import { Tag } from '@/components/ui/Tag';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';

export function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') || '';
  const level = sp.get('level') || '';
  const domain = sp.get('domain') || '';
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);

  const [qInput, setQInput] = useState(q);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    api.listDomains().then((r) => setDomains(r.items)).catch(() => setDomains([]));
  }, []);

  useEffect(() => {
    setQInput(q);
    api
      .listArticles({
        status: 'published',
        q: q || undefined,
        level: level || undefined,
        domain: domain || undefined,
        page,
        pageSize: 12,
      })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total || r.items.length);
        setTotalPages(r.totalPages || 1);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      });
  }, [q, level, domain, page]);

  function apply() {
    const next = new URLSearchParams();
    if (qInput.trim()) next.set('q', qInput.trim());
    if (level) next.set('level', level);
    if (domain) next.set('domain', domain);
    next.set('page', '1');
    setSp(next);
  }

  return (
    <div className="container" style={{ padding: '40px 24px 80px', maxWidth: 960 }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, marginBottom: 8 }}>搜索与筛选</h1>
      <p style={{ color: 'var(--muted-foreground)', marginTop: 0 }}>跨领域检索已发布文章</p>

      <div className="card" style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
        <Field label="关键词">
          <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="ReAct / MCP / 微调…" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12 }}>
          <Field label="领域">
            <Select
              value={domain}
              onChange={(e) => {
                const next = new URLSearchParams(sp);
                if (e.target.value) next.set('domain', e.target.value);
                else next.delete('domain');
                next.set('page', '1');
                setSp(next);
              }}
            >
              <option value="">全部领域</option>
              {domains.map((d) => (
                <option key={d.id} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="难度">
            <Select
              value={level}
              onChange={(e) => {
                const next = new URLSearchParams(sp);
                if (e.target.value) next.set('level', e.target.value);
                else next.delete('level');
                next.set('page', '1');
                setSp(next);
              }}
            >
              <option value="">全部</option>
              <option value="入门">入门</option>
              <option value="中级">中级</option>
              <option value="高级">高级</option>
            </Select>
          </Field>
          <div style={{ alignSelf: 'end' }}>
            <Button onClick={apply}>搜索</Button>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 12 }}>
        {total} 条结果
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((a) => (
          <Link
            key={a.id}
            to={`/knowledge/${a.slug}`}
            className="card card-hover"
            style={{ textDecoration: 'none' }}
            data-agent-zone="knowledge"
            data-agent-term
            data-agent-text={`${a.title}。${a.summary}`}
          >
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <Tag variant="primary">{a.domain?.name || a.category}</Tag>
              <Tag>{a.level}</Tag>
            </div>
            <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 17 }}>{a.title}</div>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>{a.summary}</p>
          </Link>
        ))}
        {!items.length ? <p style={{ color: 'var(--muted-foreground)' }}>无匹配文章</p> : null}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24 }}>
        <Button
          variant="ghost"
          disabled={page <= 1}
          onClick={() => {
            const next = new URLSearchParams(sp);
            next.set('page', String(page - 1));
            setSp(next);
          }}
        >
          上一页
        </Button>
        <span style={{ fontSize: 13, color: 'var(--muted-foreground)', alignSelf: 'center' }}>
          {page}/{totalPages}
        </span>
        <Button
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => {
            const next = new URLSearchParams(sp);
            next.set('page', String(page + 1));
            setSp(next);
          }}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
