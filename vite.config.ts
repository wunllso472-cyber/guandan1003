import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'client',
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    // 两个页面：游戏 + 复盘（读取本机保存的复盘日志）
    rollupOptions: { input: { main: fileURLToPath(new URL('./client/index.html', import.meta.url)), review: fileURLToPath(new URL('./client/review.html', import.meta.url)) } },
  },
  // 蒙特卡洛模拟在后台线程运行，使用模块格式
  worker: { format: 'es' },
  server: {
    host: true,
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  test: { root: '.', include: ['tests/**/*.test.ts'] },
} as any);
