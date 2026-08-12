import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 部分环境全局 NODE_ENV=production 会导致 React Refresh 半注入 → 白屏
if (process.env.npm_lifecycle_event === 'dev') {
  process.env.NODE_ENV = 'development';
}

// 端口规则:默认 8180(前端)/ 8181(API 代理);显式指定见 README
// - VITE_PORT=8182 npm run dev:web    → 前端自定义端口
// - VITE_API_PORT=8182 npm run dev:web → /api 代理到自定义 API 端口(仅同源模式)
// 端口占用预检在 dev 脚本前置脚本 scripts/check-port.mjs 中(此处不做,避免 config 热重载误判)
//
// 前后端连接模式(二选一,勿混用):
// - 同源代理(默认):不设 VITE_API_BASE_URL → 前端用相对路径 /api/v1,由下方 proxy 转发;
//   后端端口变化改 VITE_API_PORT。
// - 直连跨源:设 VITE_API_BASE_URL=http://host:port/api/v1 → 前端直连该地址,
//   下方 proxy 不生效(VITE_API_PORT 无意义);后端端口变化需同步改 VITE_API_BASE_URL。
//   开发模式下 CORS 自动放行本机任意端口,无需额外配置。
const WEB_PORT = Number(process.env.VITE_PORT) || 8180;
// 前端代理到后端的端口：VITE_API_PORT 显式优先；否则跟随后端 PORT，方便 npm run dev 统一指定
const API_PORT = Number(process.env.VITE_API_PORT) || Number(process.env.PORT) || 8181;
const API_BASE_URL = process.env.VITE_API_BASE_URL;

if (API_BASE_URL) {
  // 直连跨源模式下请求全部为绝对 URL,proxy 不会被命中;提示避免误以为 proxy 在转发
  console.log(`[vite] VITE_API_BASE_URL 已设置(${API_BASE_URL})→ 直连跨源模式,dev proxy 不生效`);
} else {
  console.log(`[vite] 同源代理模式:/api → http://127.0.0.1:${API_PORT}(改后端端口用 VITE_API_PORT)`);
}

// 品牌中立:index.html 的 title/meta 由 BRAND 注入(品牌唯一入口 src/app/brand.ts)
import { BRAND } from './src/app/brand.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-brand',
      transformIndexHtml(html: string) {
        return html
          .replace(/<title>.*?<\/title>/, `<title>${BRAND.title}</title>`)
          .replace(
            /<meta name="description" content="[^"]*" \/>/,
            `<meta name="description" content="${BRAND.description}" />`,
          );
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // 固定端口，避免被其他项目占用 5173 后误开「别的网站」;占用由前置脚本友好提示
    port: WEB_PORT,
    strictPort: true,
    // Windows 上默认可能只绑 [::1]，导致 127.0.0.1 / 部分浏览器「连接被拒绝」
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
