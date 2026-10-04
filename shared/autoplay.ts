// 托管出牌：与“提示”相同的策略——顾问（含教材规则库）给出候选，再用蒙特卡洛模拟从前几个候选里选团队结果最好的。
// 托管在牌桌控制器里同步执行（单机在浏览器，联机在服务端），所以模拟限定较短的时间预算；
// 时间内样本不够时直接用顾问的首选（顾问单独对打也略好于原电脑出牌）。
import { advise, type AdviceInput } from './advisor';
import { mcStateFrom, monteCarlo, monteCarloShallow, type MCResult } from './mc';
import type { Combo } from './combo';

/** 场上剩余牌数不超过它时按残局模拟到整局结束 */
export const MC_MAXCARDS = 40;
/** 模拟顾问前几个候选 */
export const MC_K = 4;
/**
 * 残局：模拟到整局结束；开局和中盘：模拟到本轮结束再用局面评分。
 * 结果比顾问首选好 margin 级以上才推翻首选（与 1002 局对打评估的设置一致）。
 */
export const MC_END = { mode: 'full', samples: 40, minSamples: 15, margin: 0.25, label: '残局' } as const;
export const MC_MID = { mode: 'shallow', samples: 30, minSamples: 12, margin: 0.4, label: '牌局' } as const;
export type MCConfig = typeof MC_END | typeof MC_MID;

export function mcConfigFor(counts: number[]): MCConfig {
  return counts.reduce((a, x) => a + x, 0) <= MC_MAXCARDS ? MC_END : MC_MID;
}

/** 根据模拟结果决定是否推翻顾问首选：返回选中的候选下标和多赢的级数 */
export function pickByMC(r: MCResult | null, cfg: MCConfig): { best: number; gain: number } | null {
  if (!r || r.samples < cfg.minSamples) return null;
  let best = 0;
  r.scores.forEach((v, i) => { if (v > r.scores[best] + 1e-9) best = i; });
  const gain = r.scores[best] - r.scores[0];
  return { best: best !== 0 && gain >= cfg.margin ? best : 0, gain };
}

/** 托管出一手牌；null 表示不出 */
export function smartPlay(inp: AdviceInput, budgetMs: number, seed = Date.now() % 100000): Combo | null {
  const adv = advise(inp);
  const opts = adv.options;
  if (!opts.length) return null;
  if (opts.length === 1 || budgetMs <= 0) return opts[0].combo;
  const cfg = mcConfigFor(inp.counts);
  const top = opts.slice(0, MC_K);
  const run = cfg.mode === 'full' ? monteCarlo : monteCarloShallow;
  const r = run(mcStateFrom(inp), top.map((o) => o.combo), budgetMs, cfg.samples, seed);
  const pick = pickByMC(r, cfg);
  return top[pick?.best ?? 0].combo;
}
