// 创建模拟线程（网页版：module Worker，由 Vite 打包 mcWorker.ts）。
// 小红书小工具版构建时用别名换成 mcWorkerFactory.minitool.ts。
export function createMcWorker(): Worker {
  return new Worker(new URL('./mcWorker.ts', import.meta.url), { type: 'module' });
}
