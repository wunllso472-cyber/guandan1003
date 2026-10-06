// 托管出牌：与“提示”相同的策略——顾问（含教材规则库）给出候选，再用蒙特卡洛模拟从前几个候选里选团队结果最好的。
// 托管在牌桌控制器里同步执行（单机在浏览器，联机在服务端），所以模拟限定较短的时间预算；
// 时间内样本不够时直接用顾问的首选（顾问单独对打也略好于原电脑出牌）。
import { advise, decisionContext, type Advice, type AdviceInput, type DecisionContext } from './advisor';
import { mcStateFrom, monteCarlo, monteCarloShallow, type MCResult, type MCState } from './mc';
import type { Combo } from './combo';

/** 场上剩余牌数不超过它时按残局模拟到整局结束 */
export const MC_MAXCARDS = 40;
/** 模拟顾问前几个候选 */
export const MC_K = 4;

/**
 * 前 MC_K 个之外最多再补几个不同类型的候选（评估用可调，0 表示不补）。
 * 600 局配对评估（补 2 个，总计算量不变）：对原电脑每局少 0.17 ±0.13 级、对顾问少 0.19 ±0.14 级，所以默认不补。
 */
export const mcExtra = { n: 0 };

/**
 * 交给模拟的候选：顾问前 MC_K 个，再按顾问排序补上前面没有的牌型（含“不出”），最多补 mcExtra.n 个。
 * 顾问排序靠后但类型不同的出法也能被模拟看到。
 */
export function mcCandidates<T extends { combo: Combo | null }>(opts: T[], extra = mcExtra.n): T[] {
  const top = opts.slice(0, MC_K);
  if (extra <= 0) return top;
  const kind = (o: T) => o.combo ? o.combo.type + ':' + o.combo.cards.length : 'pass';
  const seen = new Set(top.map(kind));
  for (const o of opts.slice(MC_K)) {
    if (top.length >= MC_K + extra) break;
    if (seen.has(kind(o))) continue;
    seen.add(kind(o));
    top.push(o);
  }
  return top;
}
/**
 * 残局：模拟到整局结束；开局和中盘：模拟到本轮结束再用局面评分。
 * 结果比顾问首选好 margin 级以上才推翻首选（与 1002 局对打评估的设置一致）。
 */
export interface MCConfig { mode: 'full' | 'shallow'; samples: number; minSamples: number; margin: number; label: string }
/**
 * 评估用可调（scripts/bench.ts 的 GD_END_MARGIN、GD_MID_MARGIN 等）。
 * 600 局配对评估（mcjev 对原电脑，基准 +0.745）：中盘门槛 0.2 每局 -0.300 ±0.177、0.6 -0.005 ±0.140、0.9 -0.168 ±0.168；
 * 残局门槛 0.1 +0.007 ±0.063；残局界限 54 张 +0.040 ±0.107。现有设置已在最好的区间，默认不变。
 */
export const MC_END: MCConfig = { mode: 'full', samples: 40, minSamples: 15, margin: 0.25, label: '残局' };
export const MC_MID: MCConfig = { mode: 'shallow', samples: 30, minSamples: 12, margin: 0.4, label: '牌局' };
/** 残局界限（评估用可调，默认 MC_MAXCARDS） */
export const mcStage = { maxCards: MC_MAXCARDS };

export function mcConfigFor(counts: number[]): MCConfig {
  return counts.reduce((a, x) => a + x, 0) <= mcStage.maxCards ? MC_END : MC_MID;
}

/** 根据模拟结果决定是否推翻顾问首选：返回选中的候选下标和多赢的级数 */
export function pickByMC(r: MCResult | null, cfg: MCConfig): { best: number; gain: number } | null {
  if (!r || r.samples < cfg.minSamples) return null;
  let best = 0;
  r.scores.forEach((v, i) => { if (v > r.scores[best] + 1e-9) best = i; });
  const gain = r.scores[best] - r.scores[0];
  return { best: best !== 0 && gain >= cfg.margin ? best : 0, gain };
}

/** 模拟结果与最好的候选相差不到这么多级时，认为模拟拿不准 */
export const JEV_TIE = 0.05;

/**
 * 模拟拿不准的候选：得分与最好的相差不到 eps 级的候选下标（含最好的）；模拟失败、样本不够或差距明显时返回空。
 * 评估（scripts/bench.ts 的 mcjev，200 局配对）：拿不准时改用 Jev 的排序，每局净升级比只用模拟少 0.29 ±0.27 级，
 * 所以提示没有采用，只保留用于以后再评估。
 */
export function mcTies(r: MCResult | null, cfg: MCConfig, eps = JEV_TIE): number[] {
  if (!r || r.samples < cfg.minSamples) return [];
  const best = Math.max(...r.scores);
  const ids = r.scores.map((v, i) => (best - v <= eps ? i : -1)).filter((i) => i >= 0);
  return ids.length >= 2 ? ids : [];
}

/** 一次决策的依据（复盘日志用）：候选出法、评分、模拟结果和命中的规则 */
export interface DecisionLog {
  /** auto 托管 / timeout 超时代打 / hint 提示 / manual 自己出牌（记录当时的建议） */
  source: 'auto' | 'timeout' | 'hint' | 'manual';
  stage?: string;
  /** 牌力和打法，如“弱 -3 分，送对家：…” */
  power?: string;
  /** 采用的出法 */
  chosen: string;
  /** 决定方式：advisor 顾问首选 / mc 模拟后保留首选 / mc-override 模拟推翻首选 / jev */
  method: 'advisor' | 'mc' | 'mc-override' | 'jev';
  mc?: { mode: string; samples: number; gain: number };
  /** 当时对三家的推断（教材 I01–I08 等，只是倾向） */
  beliefs?: string[];
  /** 顾问排序前几名 */
  candidates: { label: string; score: number; mc?: number; reasons: string[]; rules: string[] }[];
  /** 托管时给玩家看的局面依据（见 withContext；复盘日志不保存） */
  ctx?: DecisionContext;
}

/** 把顾问结果和模拟结果整理成决策记录 */
export function decisionLog(adv: Advice, source: DecisionLog['source'], chosenIdx: number, method: DecisionLog['method'],
  mc?: { mode: string; samples: number; gain: number; scores: number[] }): DecisionLog {
  return {
    source,
    stage: adv.stage,
    ...(adv.power ? { power: `${{ strong: '强', medium: '中等', weak: '弱' }[adv.power.strength]} ${adv.power.points} 分，${{ attack: '主攻', support: '助攻', undecided: '未定' }[adv.power.role]}：${adv.power.why}` } : {}),
    chosen: adv.options[chosenIdx]?.label ?? '不出',
    method,
    ...(mc ? { mc: { mode: mc.mode, samples: mc.samples, gain: Number(mc.gain.toFixed(3)) } } : {}),
    beliefs: adv.inferred.slice(0, 8).map((x) => `${{ partner: '对家', left: '上家', right: '下家' }[x.who]}：${x.text}${x.rule ? `（${x.rule}）` : ''}`),
    candidates: adv.options.slice(0, 6).map((o, i) => ({
      label: o.label,
      score: Number(o.score.toFixed(2)),
      ...(mc && i < mc.scores.length ? { mc: Number(mc.scores[i].toFixed(3)) } : {}),
      reasons: o.reasons.slice(0, 3),
      rules: o.rules.map((h) => `${h.id}${h.weight > 0 ? '+' : ''}${h.weight}`),
    })),
  };
}

type Decision = { combo: Combo | null; log: DecisionLog | null; adv?: Advice };

/** 给决策记录附上局面依据（阶段要点、三家出牌、手牌拆分、命中的教材规则）；只在要显示给玩家时调用 */
export function withContext(d: Decision, inp: AdviceInput): DecisionLog | null {
  if (!d.log || !d.adv) return d.log;
  const key = (c: Combo | null) => (c ? [...c.cards].sort().join(',') : 'pass');
  const chosen = d.adv.options.find((o) => key(o.combo) === key(d.combo));
  return { ...d.log, ctx: decisionContext(inp, d.adv, chosen) };
}

/** 先用顾问给出候选；只有一个候选或不模拟时直接给出结果，否则返回要模拟的前几个候选 */
function prepare(inp: AdviceInput, budgetMs: number, source: DecisionLog['source']) {
  const adv = advise(inp);
  const opts = adv.options;
  if (!opts.length) return { done: { combo: null, log: null } as Decision };
  if (opts.length === 1 || budgetMs <= 0) return { done: { combo: opts[0].combo, log: decisionLog(adv, source, 0, 'advisor'), adv } as Decision };
  return { adv, cfg: mcConfigFor(inp.counts), top: mcCandidates(opts) };
}

/** 按模拟结果选定出法（模拟失败或样本不够时用顾问首选） */
function finish(adv: Advice, cfg: MCConfig, top: Advice['options'], r: MCResult | null, source: DecisionLog['source']): Decision {
  if (!r) return { combo: top[0].combo, log: decisionLog(adv, source, 0, 'advisor'), adv };
  const pick = pickByMC(r, cfg);
  const best = pick?.best ?? 0;
  const log = decisionLog(adv, source, best, !pick ? 'advisor' : best ? 'mc-override' : 'mc',
    { mode: cfg.mode, samples: r.samples, gain: pick?.gain ?? 0, scores: r.scores });
  return { combo: top[best].combo, log, adv };
}

/** 托管出一手牌（combo 为 null 表示不出），同时给出决策依据；模拟在当前线程同步执行 */
export function smartDecide(inp: AdviceInput, budgetMs: number, source: DecisionLog['source'] = 'auto', seed = Date.now() % 100000): Decision {
  const p = prepare(inp, budgetMs, source);
  if (p.done) return p.done;
  const run = p.cfg.mode === 'full' ? monteCarlo : monteCarloShallow;
  return finish(p.adv, p.cfg, p.top, run(mcStateFrom(inp), p.top.map((o) => o.combo), budgetMs, p.cfg.samples, seed), source);
}

/** 异步执行模拟（单机交给后台线程，避免界面卡顿）；超时或出错时返回 null */
export type MCRunner = (st: MCState, moves: (Combo | null)[], budgetMs: number, maxSamples: number, mode: 'full' | 'shallow') => Promise<MCResult | null>;

/** 与 smartDecide 相同的策略，模拟交给 run 异步执行 */
export async function smartDecideAsync(inp: AdviceInput, budgetMs: number, run: MCRunner, source: DecisionLog['source'] = 'auto'): Promise<Decision> {
  const p = prepare(inp, budgetMs, source);
  if (p.done) return p.done;
  const r = await run(mcStateFrom(inp), p.top.map((o) => o.combo), budgetMs, p.cfg.samples, p.cfg.mode).catch(() => null);
  return finish(p.adv, p.cfg, p.top, r, source);
}

/** 托管出一手牌；null 表示不出 */
export function smartPlay(inp: AdviceInput, budgetMs: number, seed = Date.now() % 100000): Combo | null {
  return smartDecide(inp, budgetMs, 'auto', seed).combo;
}
