import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 部分环境全局 NODE_ENV=production 会导致 React Refresh 半注入 → 白屏
if (process.env.npm_lifecycle_event === 'dev') {
  process.env.NODE_ENV = 'development';
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // 固定端口，避免被其他项目占用 5173 后误开「别的网站」
    port: 5280,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
