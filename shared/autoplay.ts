// 托管出牌：与“提示”相同的策略——顾问（含教材规则库）给出候选，再用蒙特卡洛模拟从前几个候选里选团队结果最好的。
// 托管在牌桌控制器里同步执行（单机在浏览器，联机在服务端），所以模拟限定较短的时间预算；
// 时间内样本不够时直接用顾问的首选（顾问单独对打也略好于原电脑出牌）。
import { advise, type Advice, type AdviceInput } from './advisor';
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

/** 一次决策的依据（复盘日志用）：候选出法、评分、模拟结果和命中的规则 */
export interface DecisionLog {
  /** auto 托管 / timeout 超时代打 / hint 提示 / manual 自己出牌（记录当时的建议） */
  source: 'auto' | 'timeout' | 'hint' | 'manual';
  stage?: string;
  /** 采用的出法 */
  chosen: string;
  /** 决定方式：advisor 顾问首选 / mc 模拟后保留首选 / mc-override 模拟推翻首选 / jev */
  method: 'advisor' | 'mc' | 'mc-override' | 'jev';
  mc?: { mode: string; samples: number; gain: number };
  /** 顾问排序前几名 */
  candidates: { label: string; score: number; mc?: number; reasons: string[]; rules: string[] }[];
}

/** 把顾问结果和模拟结果整理成决策记录 */
export function decisionLog(adv: Advice, source: DecisionLog['source'], chosenIdx: number, method: DecisionLog['method'],
  mc?: { mode: string; samples: number; gain: number; scores: number[] }): DecisionLog {
  return {
    source,
    stage: adv.stage,
    chosen: adv.options[chosenIdx]?.label ?? '不出',
    method,
    ...(mc ? { mc: { mode: mc.mode, samples: mc.samples, gain: Number(mc.gain.toFixed(3)) } } : {}),
    candidates: adv.options.slice(0, 6).map((o, i) => ({
      label: o.label,
      score: Number(o.score.toFixed(2)),
      ...(mc && i < mc.scores.length ? { mc: Number(mc.scores[i].toFixed(3)) } : {}),
      reasons: o.reasons.slice(0, 3),
      rules: o.rules.map((h) => `${h.id}${h.weight > 0 ? '+' : ''}${h.weight}`),
    })),
  };
}

/** 托管出一手牌（combo 为 null 表示不出），同时给出决策依据 */
export function smartDecide(inp: AdviceInput, budgetMs: number, source: DecisionLog['source'] = 'auto', seed = Date.now() % 100000): { combo: Combo | null; log: DecisionLog | null } {
  const adv = advise(inp);
  const opts = adv.options;
  if (!opts.length) return { combo: null, log: null };
  if (opts.length === 1 || budgetMs <= 0) return { combo: opts[0].combo, log: decisionLog(adv, source, 0, 'advisor') };
  const cfg = mcConfigFor(inp.counts);
  const top = opts.slice(0, MC_K);
  const run = cfg.mode === 'full' ? monteCarlo : monteCarloShallow;
  const r = run(mcStateFrom(inp), top.map((o) => o.combo), budgetMs, cfg.samples, seed);
  const pick = pickByMC(r, cfg);
  const best = pick?.best ?? 0;
  const log = decisionLog(adv, source, best, !pick ? 'advisor' : best ? 'mc-override' : 'mc',
    { mode: cfg.mode, samples: r.samples, gain: pick?.gain ?? 0, scores: r.scores });
  return { combo: top[best].combo, log };
}

/** 托管出一手牌；null 表示不出 */
export function smartPlay(inp: AdviceInput, budgetMs: number, seed = Date.now() % 100000): Combo | null {
  return smartDecide(inp, budgetMs, 'auto', seed).combo;
}
