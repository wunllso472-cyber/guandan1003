// 后台线程：执行蒙特卡洛模拟，避免点“提示”时界面卡顿
import { monteCarlo, monteCarloShallow, type MCState } from '@shared/mc';
import type { Combo } from '@shared/combo';

/** full：模拟到整局结束（残局）；shallow：模拟到本轮结束再给局面打分（中盘） */
interface Req { id: number; state: MCState; moves: (Combo | null)[]; budgetMs: number; maxSamples: number; mode: 'full' | 'shallow' }

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, state, moves, budgetMs, maxSamples, mode } = e.data;
  const run = mode === 'shallow' ? monteCarloShallow : monteCarlo;
  const r = run(state, moves, budgetMs, maxSamples, Date.now() % 100000);
  (self as unknown as Worker).postMessage({ id, ...r });
};
