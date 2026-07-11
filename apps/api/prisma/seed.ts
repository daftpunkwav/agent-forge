import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_ARTICLE_SEEDS } from './seed-content.js';

const prisma = new PrismaClient();

/** category / 关键词 → 领域 slug */
const DOMAIN_DEFS = [
  {
    slug: 'reasoning',
    name: '推理模式',
    track: 'agent',
    description: 'ReAct / CoT / ToT / GoT 等核心推理范式',
    color: 'var(--chart-1)',
    sortOrder: 10,
    match: (s: { category: string; slug: string }) =>
      s.category === '推理模式' || ['react', 'cot', 'tot', 'got'].includes(s.slug),
  },
  {
    slug: 'frameworks',
    name: '开发框架',
    track: 'agent',
    description: 'LangChain · AutoGen · CrewAI 等主流框架',
    color: 'var(--chart-2)',
    sortOrder: 20,
    match: (s: { category: string; slug: string }) =>
      s.category === '框架' || s.slug.startsWith('frameworks'),
  },
  {
    slug: 'protocols',
    name: '协议与集成',
    track: 'agent',
    description: 'MCP 等模型与工具互联协议',
    color: 'var(--chart-3)',
    sortOrder: 30,
    match: (s: { category: string; slug: string }) =>
      s.category === '协议' || s.slug === 'mcp',
  },
  {
    slug: 'engineering',
    name: '工程实践',
    track: 'agent',
    description: 'Context · Loop · Harness · Memory · Eval · Tools · Prompt',
    color: 'var(--chart-4)',
    sortOrder: 40,
    match: (s: { category: string; slug: string }) =>
      s.category === '工程实践' ||
      ['context', 'loop', 'harness', 'memory', 'evaluation', 'tool-use', 'prompt-eng'].includes(
        s.slug,
      ),
  },
  {
    slug: 'llm-foundations',
    name: 'LLM 基础',
    track: 'llm',
    description: 'Transformer · Token · 微调 · Prompting',
    color: 'var(--chart-5)',
    sortOrder: 10,
    match: (s: { category: string; slug: string }) =>
      s.category === 'LLM基础' ||
      ['llm-basics', 'transformers', 'tokenization', 'fine-tuning', 'prompting'].includes(s.slug),
  },
] as const;

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@agentforge.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe_Admin_123!';
  const name = process.env.SEED_ADMIN_NAME || 'AgentForge Admin';

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      role: 'admin',
      name,
      passwordHash,
      adminLevel: 100,
      authorTier: 'elite',
    },
    create: {
      email,
      name,
      passwordHash,
      role: 'admin',
      adminLevel: 100,
      authorTier: 'elite',
    },
  });

  console.log(`[seed] super admin (level 100): ${admin.email}`);

  const domainMap = new Map<string, string>();
  for (const d of DOMAIN_DEFS) {
    const row = await prisma.domain.upsert({
      where: { slug: d.slug },
      update: {
        name: d.name,
        description: d.description,
        track: d.track,
        color: d.color,
        sortOrder: d.sortOrder,
        published: true,
      },
      create: {
        slug: d.slug,
        name: d.name,
        description: d.description,
        track: d.track,
        color: d.color,
        sortOrder: d.sortOrder,
        published: true,
        createdById: admin.id,
      },
    });
    domainMap.set(d.slug, row.id);
    console.log(`[seed] domain: ${row.slug}`);
  }

  for (const seed of DEFAULT_ARTICLE_SEEDS) {
    const anim = await prisma.animationDef.upsert({
      where: { id: seed.animationId },
      update: {
        name: seed.animationName,
        template: seed.template,
        steps: JSON.stringify(seed.steps),
        authorId: admin.id,
      },
      create: {
        id: seed.animationId,
        name: seed.animationName,
        template: seed.template,
        steps: JSON.stringify(seed.steps),
        authorId: admin.id,
      },
    });

    const domainDef = DOMAIN_DEFS.find((d) => d.match(seed));
    const domainId = domainDef ? domainMap.get(domainDef.slug) : undefined;

    const article = await prisma.article.upsert({
      where: { slug: seed.slug },
      update: {
        title: seed.title,
        summary: seed.summary,
        markdown: seed.markdown,
        category: seed.category,
        level: seed.level,
        tags: JSON.stringify(seed.tags),
        readMinutes: seed.readMinutes,
        status: 'published',
        publishedAt: new Date(),
        authorId: admin.id,
        domainId: domainId || null,
      },
      create: {
        slug: seed.slug,
        title: seed.title,
        summary: seed.summary,
        markdown: seed.markdown,
        category: seed.category,
        level: seed.level,
        tags: JSON.stringify(seed.tags),
        readMinutes: seed.readMinutes,
        status: 'published',
        publishedAt: new Date(),
        authorId: admin.id,
        domainId: domainId || null,
      },
    });

    await prisma.articleAnimation.deleteMany({ where: { articleId: article.id } });
    await prisma.articleAnimation.create({
      data: { articleId: article.id, animationId: anim.id, sortOrder: 0 },
    });

    console.log(`[seed] article: ${article.slug} → ${domainDef?.slug || 'none'}`);
  }

  console.log(`[seed] done. ${DEFAULT_ARTICLE_SEEDS.length} articles, ${DOMAIN_DEFS.length} domains`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
