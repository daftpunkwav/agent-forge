/**
 * 统一开发启动脚本 —— npm run dev。
 *
 * 同时启动 API（npm run dev:api）和 Web（npm run dev:web），
 * 并在启动前预检端口占用：任一端口被占用则打印提示并退出，不自动换端口。
 *
 * 端口规则（与 vite.config.ts / index.ts 保持一致）：
 * - 前端端口：VITE_PORT，默认 8180
 * - 后端端口：PORT，默认 8181
 * - 前端代理到后端的端口：VITE_API_PORT（显式优先）→ PORT → 8181
 *
 * 用法示例：
 *   npm run dev                              # 8180 + 8181
 *   VITE_PORT=5555 npm run dev               # 5555 + 8181
 *   PORT=3333 npm run dev                    # 8180 + 3333（前端代理自动到 3333）
 *   VITE_PORT=5555 PORT=3333 npm run dev     # 5555 + 3333
 *
 * Windows 命令行（CMD/PowerShell）使用等效语法：
 *   $env:VITE_PORT=5555; $env:PORT=3333; npm run dev
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const WEB_PORT = Number(process.env.VITE_PORT) || 8180;
const API_PORT = Number(process.env.PORT) || 8181;
const WEB_API_PORT = Number(process.env.VITE_API_PORT) || API_PORT;

function isPortInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    let server;
    const done = (inUse) => {
      if (server) {
        try {
          server.close();
        } catch {}
      }
      resolve(inUse);
    };
    try {
      server = net.createServer();
      server.once('listening', () => done(false));
      server.once('error', (err) => done(err.code === 'EADDRINUSE'));
      server.listen(port, host);
    } catch (err) {
      done(err.code === 'EADDRINUSE');
    }
  });
}

async function checkPorts() {
  const webBusy = await isPortInUse(WEB_PORT);
  const apiBusy = await isPortInUse(API_PORT);

  if (webBusy || apiBusy) {
    console.log('');
    if (webBusy) {
      console.log(`✖ 前端端口 ${WEB_PORT} 已被占用`);
    }
    if (apiBusy) {
      console.log(`✖ API 端口 ${API_PORT} 已被占用`);
    }
    console.log('');
    console.log('可换端口启动:');
    if (webBusy && apiBusy) {
      console.log(`  VITE_PORT=${WEB_PORT + 1} PORT=${API_PORT + 1} npm run dev`);
    } else if (webBusy) {
      console.log(`  VITE_PORT=${WEB_PORT + 1} npm run dev`);
    } else {
      console.log(`  PORT=${API_PORT + 1} npm run dev`);
    }
    console.log('或关闭占用进程后重试。');
    console.log('');
    process.exit(1);
  }
}

async function main() {
  await checkPorts();

  console.log(`[dev] 启动 API (PORT=${API_PORT}) 与 Web (VITE_PORT=${WEB_PORT})`);
  if (process.env.VITE_API_PORT) {
    console.log(`[dev] 前端 /api 代理显式指向 VITE_API_PORT=${WEB_API_PORT}`);
  } else {
    console.log(`[dev] 前端 /api 代理自动指向 PORT=${WEB_API_PORT}`);
  }

  // 继承当前环境变量，确保子进程能读取 VITE_PORT / PORT / VITE_API_PORT
  const env = { ...process.env };
  // 显式写入当前解析值，方便子脚本读取
  env.PORT = String(API_PORT);
  env.VITE_PORT = String(WEB_PORT);
  env.VITE_API_PORT = String(WEB_API_PORT);

  // Windows 上直接 spawn npm.cmd 在 Node ≥18 可能报 EINVAL；统一用 shell 模式调用 npm 脚本，
  // 同时避免 shell 拼接参数的安全警告（args 仍数组传入，由 shell 正确转义）。
  const apiProc = spawn('npm', ['run', 'dev:api'], {
    stdio: 'inherit',
    shell: true,
    env,
  });

  const webProc = spawn('npm', ['run', 'dev:web'], {
    stdio: 'inherit',
    shell: true,
    env,
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[dev] 收到 ${signal}，正在停止服务...`);

    const kill = (proc, name) =>
      new Promise((resolve) => {
        if (!proc || proc.exitCode !== null) {
          resolve();
          return;
        }
        proc.once('exit', () => resolve());
        // Windows 上 npm 会启动子 shell，SIGTERM 不一定能传到子进程；
        // 先用 kill，超时再强制 kill。
        proc.kill(signal);
        setTimeout(() => {
          if (proc.exitCode === null) {
            proc.kill('SIGKILL');
          }
        }, 3000);
      });

    Promise.all([kill(apiProc, 'SIGTERM'), kill(webProc, 'SIGTERM')]).then(() => {
      console.log('[dev] 服务已停止');
      process.exit(0);
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 任一子进程异常退出时，整体退出
  [apiProc, webProc].forEach((proc, idx) => {
    const name = idx === 0 ? 'API' : 'Web';
    proc.on('exit', (code) => {
      if (!shuttingDown && code !== 0 && code !== null) {
        console.log(`[dev] ${name} 异常退出 (code=${code})，停止另一服务`);
        shutdown('SIGTERM');
      }
    });
  });
}

main().catch((err) => {
  console.error('[dev] 启动失败:', err);
  process.exit(1);
});
