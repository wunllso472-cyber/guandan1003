// 主线程一侧：把模拟任务交给后台线程，带超时
import type { MCResult, MCState } from '@shared/mc';
import type { Combo } from '@shared/combo';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: MCResult | null) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./mcWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number } & MCResult>) => {
      pending.get(e.data.id)?.({ scores: e.data.scores, samples: e.data.samples });
      pending.delete(e.data.id);
    };
    worker.onerror = () => { for (const r of pending.values()) r(null); pending.clear(); };
  } catch {
    worker = null; // 不支持 Worker 的环境：不做模拟
  }
  return worker;
}

/** 在后台线程模拟；budgetMs 内尽量多模拟，超时（budgetMs + 余量）返回 null */
export function runMonteCarlo(state: MCState, moves: (Combo | null)[], budgetMs: number, maxSamples = 400): Promise<MCResult | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, budgetMs + 600);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    w.postMessage({ id, state, moves, budgetMs, maxSamples });
  });
}
