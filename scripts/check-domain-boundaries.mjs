/**
 * 域边界扫描：把「服务不 import 他域实现、不碰他域表」从自律变成 CI 强制。
 * 组合根 services/api 是唯一允许 import 全部服务的层，本脚本不扫描它。
 *
 * 用法：node scripts/check-domain-boundaries.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 跨服务实现 import（契约/机制除外） */
const serviceImport = (names) =>
  new RegExp(String.raw`from\s+['"]@core/(?:${names.join('|')})['"]`);

/** Prisma 他域 model 访问（含事务 tx.） */
const prismaModel = (models) =>
  new RegExp(String.raw`(?:prisma|tx)\.(?:${models.join('|')})\b`);

const RULES = [
  {
    dir: 'services/agent/src',
    forbid: [
      prismaModel(['article', 'user', 'topic', 'topicReply', 'annotation', 'domain', 'authorApplication', 'refreshToken', 'animationDef']),
      serviceImport(['identity', 'content', 'community', 'llm']),
    ],
  },
  {
    dir: 'services/content/src',
    forbid: [
      prismaModel(['user', 'topic', 'topicReply', 'agentConversation', 'agentMessage', 'agentMemory', 'learningProgress', 'hoverExplainCache', 'refreshToken', 'authorApplication']),
      serviceImport(['identity', 'community', 'agent', 'llm']),
    ],
  },
  {
    dir: 'services/community/src',
    forbid: [
      prismaModel(['article', 'user', 'annotation', 'domain', 'agentConversation', 'agentMessage', 'agentMemory', 'learningProgress', 'hoverExplainCache', 'refreshToken', 'authorApplication']),
      serviceImport(['identity', 'content', 'agent', 'llm']),
    ],
  },
  {
    dir: 'services/identity/src',
    forbid: [
      prismaModel(['article', 'topic', 'topicReply', 'annotation', 'domain', 'agentConversation', 'agentMessage', 'agentMemory', 'learningProgress', 'hoverExplainCache', 'animationDef']),
      serviceImport(['content', 'community', 'agent', 'llm']),
    ],
  },
  {
    dir: 'services/llm/src',
    forbid: [
      prismaModel(['article', 'user', 'topic', 'annotation', 'agentConversation', 'agentMemory', 'learningProgress']),
      serviceImport(['identity', 'content', 'community', 'agent']),
    ],
  },
  {
    dir: 'apps/web/src',
    forbid: [serviceImport(['identity', 'content', 'community', 'agent', 'llm', 'foundation', 'api'])],
  },
  {
    dir: 'packages/foundation/src',
    forbid: [serviceImport(['identity', 'content', 'community', 'agent', 'llm'])],
  },
  {
    dir: 'packages/contracts/src',
    forbid: [
      serviceImport(['identity', 'content', 'community', 'agent', 'llm', 'foundation']),
      /from\s+['"]@prisma\/client['"]/,
    ],
  },
];

async function walkTs(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') return acc;
    throw e;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      await walkTs(p, acc);
    } else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const violations = [];

for (const rule of RULES) {
  const files = await walkTs(path.join(root, rule.dir));
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const src = stripComments(raw);
    for (const re of rule.forbid) {
      const m = src.match(re);
      if (m) {
        violations.push(`${path.relative(root, file)}: ${m[0]}`);
      }
    }
  }
}

if (violations.length) {
  console.error('域边界违规（服务间不可 import 实现 / 不可访问他域表）：');
  for (const v of violations) console.error('  ', v);
  process.exit(1);
}

console.log(`域边界扫描通过（${RULES.length} 组规则）`);
