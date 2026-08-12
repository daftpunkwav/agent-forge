/**
 * 前端端口预检 —— npm run dev 启动前运行(dev 脚本 `node scripts/check-port.mjs && vite`)。
 * 端口被占用时打印友好提示并退出,避免 Vite 裸报错/误开他站。
 * 仅检测,不占端口;默认 8180,可用 VITE_PORT 覆盖(与 vite.config.ts 一致)。
 */
import net from 'node:net';

const WEB_PORT = Number(process.env.VITE_PORT) || 8180;

function isPortInUse(port) {
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
      server.listen(port, '127.0.0.1');
    } catch (err) {
      done(err.code === 'EADDRINUSE');
    }
  });
}

const busy = await isPortInUse(WEB_PORT);
if (busy) {
  console.log(
    [
      ``,
      `✖ 前端端口 ${WEB_PORT} 已被占用`,
      `  可换端口启动:`,
      `    VITE_PORT=${WEB_PORT + 1} npm run dev:web`,
      `  或关闭占用进程后重试。`,
      ``,
    ].join('\n'),
  );
  process.exit(1);
}
