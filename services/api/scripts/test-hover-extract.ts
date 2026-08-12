/**
 * 已迁移至 vitest：npm run test:hover
 * 保留此文件以免旧文档链接失效。
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync('npx', ['vitest', 'run', 'src/lib/llm/agentPrompt.hover.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
process.exit(r.status ?? 1);
