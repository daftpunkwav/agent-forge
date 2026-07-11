import { Tag } from '@/components/ui/Tag';

const NEWS = [
  {
    date: '2025-06',
    tag: '协议',
    title: 'MCP 生态持续扩展：IDE 与 Agent 运行时原生集成',
    body: 'Model Context Protocol 成为连接模型与工具的主流选项之一。学习路径见站内 MCP 专文。',
    note: '静态精选 · 演示数据',
  },
  {
    date: '2025-05',
    tag: '框架',
    title: '多 Agent 框架对比仍是工程选型热点',
    body: 'LangGraph / AutoGen / CrewAI 在状态机、对话协作与角色编排上各有侧重。',
    note: '静态精选 · 演示数据',
  },
  {
    date: '2025-04',
    tag: '工程',
    title: 'Agent Harness 与可观测性成为生产落地关键词',
    body: '从「能跑 demo」到「可控、可评、可回滚」，Harness 与评估体系重要性上升。',
    note: '静态精选 · 演示数据',
  },
];

export function NewsPage() {
  return (
    <div className="container" style={{ padding: '48px 24px 80px', maxWidth: 800 }}>
      <Tag variant="secondary">前沿资讯</Tag>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(28px, 4vw, 40px)', margin: '16px 0 12px' }}>
        Agent 前沿资讯
      </h1>
      <p style={{ color: 'var(--muted-foreground)', marginBottom: 32, lineHeight: 1.7 }}>
        精选领域动态。当前为静态内容，便于上线演示；后续可接入 CMS / 资讯 API。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {NEWS.map((n) => (
          <article key={n.title} className="card">
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{n.date}</span>
              <Tag>{n.tag}</Tag>
              <Tag variant="outline">{n.note}</Tag>
            </div>
            <h2 style={{ fontSize: 18, margin: '0 0 8px', fontFamily: 'var(--font-serif)' }}>{n.title}</h2>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.65 }}>{n.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
