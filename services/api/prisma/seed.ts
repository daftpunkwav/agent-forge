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
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@example.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || 'Admin';
  const forceAdmin = process.env.SEED_FORCE_ADMIN === '1';

  // 禁止硬编码兜底口令：缺失即拒绝，避免公开已知密码创建超管
  if (!password || password.length < 8) {
    console.error('[seed] SEED_ADMIN_PASSWORD 必填且至少 8 字符；拒绝使用内置兜底口令');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });

  let admin;
  if (!existing) {
    admin = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'admin',
        adminLevel: 100,
        authorTier: 'elite',
      },
    });
    console.log(`[seed] created super admin (level 100): ${admin.email}`);
  } else if (forceAdmin) {
    // 显式 SEED_FORCE_ADMIN=1 才允许把已有账号提权为超管（不重置密码）
    admin = await prisma.user.update({
      where: { email },
      data: {
        role: 'admin',
        name,
        adminLevel: 100,
        authorTier: 'elite',
      },
    });
    console.log(`[seed] forced elevation to super admin: ${admin.email}`);
  } else {
    // 已存在则不自动提权，防止「先注册同邮箱再跑 seed」接管
    admin = existing;
    if (existing.role !== 'admin' || existing.adminLevel < 100) {
      console.warn(
        `[seed] user ${email} already exists (role=${existing.role}, level=${existing.adminLevel}); skip admin elevation. Set SEED_FORCE_ADMIN=1 to force.`,
      );
    } else {
      console.log(`[seed] super admin already present: ${admin.email}`);
    }
  }

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
        // update 不重置 publishedAt：保留首次发布时间（仅 create 时设置）
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

    // 仅补缺失的动画关联：不 deleteMany 重建，避免抹掉用户手动关联（seed 幂等保留）
    const existingLink = await prisma.articleAnimation.findUnique({
      where: { articleId_animationId: { articleId: article.id, animationId: anim.id } },
    });
    if (!existingLink) {
      await prisma.articleAnimation.create({
        data: { articleId: article.id, animationId: anim.id, sortOrder: 0 },
      });
    }

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
