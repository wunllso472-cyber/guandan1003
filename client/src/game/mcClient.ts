// 主线程一侧：把模拟任务交给后台线程，带超时
import type { MCResult, MCState } from '@shared/mc';
import type { Combo } from '@shared/combo';
import { createMcWorker } from './mcWorkerFactory';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: MCResult | null) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    const w = createMcWorker();
    worker = w;
    // 小红书小工具：页面隐藏 30 秒后平台会回收 Worker，收到通知后下次重新创建（普通浏览器没有 onTerminate）
    const wt = w as Worker & { onTerminate?: (cb: () => void) => void };
    if (typeof wt.onTerminate === 'function') wt.onTerminate(() => { if (worker === w) { worker = null; for (const r of pending.values()) r(null); pending.clear(); } });
    worker.onmessage = (e: MessageEvent<{ id: number } & MCResult>) => {
      pending.get(e.data.id)?.({ scores: e.data.scores, samples: e.data.samples });
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      for (const r of pending.values()) r(null);
      pending.clear();
      // 小工具：出错后要主动 terminate() 才释放 Worker 名额，下次重新创建
      if (import.meta.env.MODE === 'minitool' && worker) { worker.terminate(); worker = null; }
    };
  } catch {
    worker = null; // 不支持 Worker 的环境：不做模拟
  }
  return worker;
}

/** 在后台线程模拟；budgetMs 内尽量多模拟，超时（budgetMs + 余量）返回 null */
export function runMonteCarlo(state: MCState, moves: (Combo | null)[], budgetMs: number, maxSamples = 400, mode: 'full' | 'shallow' = 'full'): Promise<MCResult | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, budgetMs + 600);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    w.postMessage({ id, state, moves, budgetMs, maxSamples, mode });
  });
}
