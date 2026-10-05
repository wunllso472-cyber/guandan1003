// 服务端工作线程：执行蒙特卡洛模拟，困难电脑思考时不阻塞房间的消息处理
import { parentPort } from 'node:worker_threads';
import { monteCarlo, monteCarloShallow, type MCState } from '../shared/mc';
import type { Combo } from '../shared/combo';

interface Req { id: number; state: MCState; moves: (Combo | null)[]; budgetMs: number; maxSamples: number; mode: 'full' | 'shallow' }

parentPort?.on('message', (q: Req) => {
  const run = q.mode === 'shallow' ? monteCarloShallow : monteCarlo;
  try {
    const r = run(q.state, q.moves, q.budgetMs, q.maxSamples, Date.now() % 100000);
    parentPort!.postMessage({ id: q.id, ...r });
  } catch {
    parentPort!.postMessage({ id: q.id, failed: true });
  }
});
