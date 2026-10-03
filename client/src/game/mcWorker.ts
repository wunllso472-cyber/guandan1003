// 后台线程：执行蒙特卡洛模拟，避免点“提示”时界面卡顿
import { monteCarlo, type MCState } from '@shared/mc';
import type { Combo } from '@shared/combo';

interface Req { id: number; state: MCState; moves: (Combo | null)[]; budgetMs: number; maxSamples: number }

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, state, moves, budgetMs, maxSamples } = e.data;
  const r = monteCarlo(state, moves, budgetMs, maxSamples, Date.now() % 100000);
  (self as unknown as Worker).postMessage({ id, ...r });
};
