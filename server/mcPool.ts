// 主线程一侧：把困难电脑的模拟交给工作线程（server/mcWorker.ts），带超时；工作线程不可用时返回 null（牌桌改为同步模拟）
import { Worker } from 'node:worker_threads';
import type { MCRunner } from '../shared/autoplay';
import type { MCResult } from '../shared/mc';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: MCResult | null) => void>();

function start(): Worker {
  // 开发时（tsx 运行 .ts）加载 mcWorker.ts；部署时 server.mjs 旁边是打包好的 mcWorker.mjs
  const dev = import.meta.url.endsWith('.ts');
  const url = new URL(dev ? './mcWorker.ts' : './mcWorker.mjs', import.meta.url);
  const w = new Worker(url, dev ? { execArgv: ['--import', 'tsx'] } : {});
  w.on('message', (m: { id: number; failed?: boolean } & MCResult) => {
    pending.get(m.id)?.(m.failed ? null : { scores: m.scores, samples: m.samples });
    pending.delete(m.id);
  });
  const fail = (err: unknown) => {
    console.error('模拟工作线程出错，之后重新启动', err);
    for (const r of pending.values()) r(null);
    pending.clear();
    worker = null;
  };
  w.on('error', fail);
  w.on('exit', (code) => { if (code !== 0) fail(`退出码 ${code}`); });
  w.unref(); // 不因为工作线程而阻止进程退出
  return w;
}

/** 创建工作线程的模拟执行函数；环境不支持时返回 null */
export function createMcRunner(): MCRunner | null {
  try {
    worker ??= start();
  } catch (err) {
    console.error('无法启动模拟工作线程，困难电脑改为同步模拟', err);
    return null;
  }
  return (state, moves, budgetMs, maxSamples, mode) => {
    let w: Worker;
    try {
      w = worker ?? (worker = start());
    } catch {
      return Promise.resolve(null); // 牌桌会改用顾问首选
    }
    const id = ++seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve(null); }, budgetMs + 1500);
      pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
      w.postMessage({ id, state, moves, budgetMs, maxSamples, mode });
    });
  };
}
