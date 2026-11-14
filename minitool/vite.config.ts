// 小红书小工具版的前端构建：单入口 IIFE 经典脚本，语法转译到 ES2017 / Chrome 61。
// 由 minitool/build.mjs 调用（--mode minitool），产物再和 index.html、模拟线程脚本一起打成 zip。
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('../client'),
  base: './',
  // client/public 里只有语音 mp3：小工具包内不允许音频文件，不复制
  publicDir: false,
  resolve: {
    alias: [
      { find: '@shared', replacement: r('../shared') },
      // 模拟线程改用包内经典脚本 mc-worker.js（容器不支持 module Worker）
      { find: /^\.\/mcWorkerFactory$/, replacement: r('../client/src/game/mcWorkerFactory.minitool.ts') },
    ],
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: r('../dist/minitool'),
    emptyOutDir: true,
    target: ['es2017', 'chrome61'],
    cssTarget: 'chrome61',
    sourcemap: false,
    // 内联资源会变成 base64：本项目没有图片/字体资源，设为 0 防止意外内嵌
    assetsInlineLimit: 0,
    lib: {
      entry: r('../client/src/minitool.ts'),
      formats: ['iife'],
      name: 'GuandanMiniTool',
      fileName: () => 'app.js',
      cssFileName: 'style',
    },
  },
});
