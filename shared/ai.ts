// 中等水平 AI：把手牌拆成“最少手数”的组合，据此决定出牌、跟牌、进还贡。
import { card, isWild, value, cardValue, BIG_JOKER, SMALL_JOKER } from './cards';
import { bombLevel, chainRank, isBomb, parseCombos, type Combo, type ComboType } from './combo';
import { findAllPlays } from './finder';
import { sameTypeBeatable, type UnseenStat } from './tracker';

// ---------- 拆牌 ----------

interface ChainSpec { type: ComboType; start: number; len: number; mult: number }
interface Part { rank: number; n: number }
interface Group { type: ComboType; parts: Part[]; wild: number; value: number }

const CHAIN_DEFS: [ComboType, number, number][] = [['straight', 5, 1], ['tube', 3, 2], ['plate', 2, 3]];

/**
 * 结合外面的牌评估组合（教材“手数 − 控制手数”）：外面同类压不住的组合是控制牌，几乎不占手数。
 * 只在传入外面的牌（UnseenStat）时生效；评估用开关和分量。
 */
export const splitControl = {
  enabled: true,
  cost: 0.4,
  /**
   * group：外面的牌只用来决定怎么拆，返回的评分仍按原代价（跟牌、出牌的取舍不变）；
   * cost：评分也按控制牌计算（实测 2000 局让顾问明显变差：打出控制牌显得“不划算”，不再用大牌抢出牌权）。
   */
  mode: 'group' as 'group' | 'cost',
};

type CostFn = (type: ComboType, v: number, size?: number) => number;

/** 拆牌代价函数：传入外面的牌时，外面同类压不住的非炸弹组合代价降到 splitControl.cost */
function costFn(level: number, st?: UnseenStat): CostFn {
  if (!st || !splitControl.enabled) return comboCost;
  const memo = new Map<string, boolean>();
  return (type, v, size = 0) => {
    const base = comboCost(type, v, size);
    if (type === 'bomb' || type === 'straightflush' || type === 'jokerbomb') return base;
    const k = type + v;
    let beat = memo.get(k);
    if (beat === undefined) { beat = sameTypeBeatable({ type, value: v }, st, level); memo.set(k, beat); }
    return beat ? base : Math.min(base, splitControl.cost);
  };
}

function comboCost(type: ComboType, v: number, size = 0): number {
  switch (type) {
    case 'jokerbomb': return -1.6;
    case 'straightflush': return -1.25;
    case 'bomb': return -1 - 0.05 * size;
    // 小单张、小对子难以出手，代价更高；王、级牌、A 有控制力，代价低
    case 'single': return v >= 16 ? 0.3 : v === 15 ? 0.6 : v === 14 ? 0.8 : v >= 11 ? 1.0 : v >= 7 ? 1.2 : 1.35;
    case 'pair': return v >= 15 ? 0.5 : v === 14 ? 0.7 : v >= 11 ? 0.9 : v >= 7 ? 1.1 : 1.2;
    case 'triple': return v >= 14 ? 0.7 : 1.0;
    case 'fullhouse': return v >= 13 ? 0.8 : 1.0;
    default: return v >= 9 ? 0.7 : 0.9; // 连牌，v 为起点
  }
}

/** 逢人配的去向：补到某个点数上，或单独作为单张/对子 */
type WildPlan = number[]; // 每个元素是被补的 rank，0 表示单独使用

/** 按给定的逢人配去向，把散牌分组并计算代价。 */
function groupLeaf(counts: number[], plan: WildPlan, level: number, cost: CostFn): { score: number; groups: Group[] } {
  const v = (r: number) => value(r, level);
  const add = new Map<number, number>();
  let loose = 0;
  for (const r of plan) {
    if (r === 0) loose++;
    else add.set(r, (add.get(r) ?? 0) + 1);
  }
  const triples: Part[] = [], pairs: Part[] = [], singles: Part[] = [];
  const groups: Group[] = [];
  for (let r = 2; r <= BIG_JOKER; r++) {
    const c = counts[r] ?? 0;
    const w = add.get(r) ?? 0;
    if (!c) continue;
    const n = c + w;
    const part: Part = { rank: r, n: c };
    if (n >= 4) groups.push({ type: 'bomb', parts: [part], wild: w, value: v(r) });
    else if (n === 3) triples.push(part);
    else if (n === 2) pairs.push(part);
    else singles.push(part);
  }
  const wildOf = (p: Part) => add.get(p.rank) ?? 0;
  if (loose > 0) groups.push({ type: loose === 2 ? 'pair' : 'single', parts: [], wild: loose, value: 15 });
  // 三带二：小对子配三张（不带王对）
  triples.sort((x, y) => v(x.rank) - v(y.rank));
  pairs.sort((x, y) => v(x.rank) - v(y.rank));
  const pairPool = pairs.filter((p) => p.rank < SMALL_JOKER);
  for (const t of triples) {
    const p = pairPool.shift();
    if (p) {
      pairs.splice(pairs.indexOf(p), 1);
      groups.push({ type: 'fullhouse', parts: [t, p], wild: wildOf(t) + wildOf(p), value: v(t.rank) });
    } else {
      groups.push({ type: 'triple', parts: [t], wild: wildOf(t), value: v(t.rank) });
    }
  }
  for (const p of pairs) groups.push({ type: 'pair', parts: [p], wild: wildOf(p), value: v(p.rank) });
  for (const p of singles) groups.push({ type: 'single', parts: [p], wild: 0, value: v(p.rank) });
  let score = 0;
  for (const g of groups) score += cost(g.type, g.value, g.parts.reduce((a, p) => a + p.n, 0) + g.wild);
  return { score, groups };
}

/** 余下的散牌分组；逢人配在“补炸弹/补三张/补对子/补单张/单独使用”之间取最优。 */
function leaf(counts: number[], wilds: number, level: number, cost: CostFn): { score: number; groups: Group[] } {
  if (wilds === 0) return groupLeaf(counts, [], level, cost);
  const v = (r: number) => value(r, level);
  // 每类只取最小和最大的点数作候选，控制枚举量
  const byCount = (k: (c: number) => boolean) => {
    const rs: number[] = [];
    for (let r = 2; r <= 14; r++) if ((counts[r] ?? 0) > 0 && k(counts[r])) rs.push(r);
    rs.sort((a, b) => v(a) - v(b));
    return rs.length ? [...new Set([rs[0], rs[rs.length - 1]])] : [];
  };
  const targets = [0, ...byCount((c) => c >= 4), ...byCount((c) => c === 3), ...byCount((c) => c === 2), ...byCount((c) => c === 1)];
  let best: { score: number; groups: Group[] } | null = null;
  const tryPlan = (plan: WildPlan) => {
    const r = groupLeaf(counts, plan, level, cost);
    if (!best || r.score < best.score - 1e-9) best = r;
  };
  for (const a of targets) {
    if (wilds === 1) { tryPlan([a]); continue; }
    for (const b of targets) tryPlan([a, b]);
  }
  return best!;
}

interface SearchResult { score: number; chains: ChainSpec[]; groups: Group[] }

function search(counts: number[], wilds: number, level: number, minKey: number, memo: Map<string, SearchResult>, depth: number, cost: CostFn): SearchResult {
  const key = counts.join(',') + '|' + wilds + '|' + minKey;
  const hit = memo.get(key);
  if (hit) return hit;
  const lf = leaf(counts, wilds, level, cost);
  let best: SearchResult = { score: lf.score, chains: [], groups: lf.groups };
  if (depth < 5) {
    CHAIN_DEFS.forEach(([type, len, mult], ti) => {
      for (let start = 1; start + len - 1 <= 14; start++) {
        const k = ti * 20 + start;
        if (k < minKey) continue;
        let need = 0, ok = true, natural = 0;
        for (let p = 0; p < len; p++) {
          const c = counts[chainRank(start, p)] ?? 0;
          const use = Math.min(mult, c);
          // 不拆炸弹（除非拆后仍是炸弹）
          if (c >= 4 && c - use < 4) { ok = false; break; }
          natural += use;
          need += mult - use;
        }
        // 允许用逢人配补连牌（最多 2 张），与补炸弹、同花顺等用法一起比较代价
        if (!ok || need > wilds || need > 2) continue;
        const next = [...counts];
        for (let p = 0; p < len; p++) {
          const r = chainRank(start, p);
          next[r] = (next[r] ?? 0) - Math.min(mult, next[r] ?? 0);
        }
        const sub = search(next, wilds - need, level, k, memo, depth + 1, cost);
        const score = sub.score + cost(type, start);
        if (score < best.score - 1e-9) {
          best = { score, chains: [{ type, start, len, mult }, ...sub.chains], groups: sub.groups };
        }
      }
    });
  }
  memo.set(key, best);
  return best;
}

export interface Split { score: number; combos: Combo[] }

/** 计算手牌的最优拆分。unseen 为外面还没出现的牌：传入时外面压不住的组合按控制牌计（见 splitControl）。 */
export function bestSplit(hand: number[], level: number, unseen?: UnseenStat): Split {
  const cost = costFn(level, unseen);
  const wildIds = hand.filter((id) => isWild(id, level));
  const naturals = hand.filter((id) => !isWild(id, level));

  // 先挑出天王炸和同花顺（可用逢人配补齐）的组合方案
  const jokers = naturals.filter((id) => card(id).rank >= SMALL_JOKER);
  const hasJokerBomb = jokers.length === 4;
  const sfs = findAllPlays(hand, level).filter((c) => c.type === 'straightflush');
  const options: Combo[][] = [[]];
  for (let i = 0; i < sfs.length && i < 8; i++) {
    options.push([sfs[i]]);
    for (let j = i + 1; j < sfs.length && j < 8; j++) {
      if (sfs[j].cards.every((x) => !sfs[i].cards.includes(x))) options.push([sfs[i], sfs[j]]);
    }
  }

  let best: Split | null = null;
  for (const pre of options) {
    const used = new Set(pre.flatMap((c) => c.cards));
    const pool = new Map<number, number[]>();
    for (const id of naturals) {
      if (used.has(id)) continue;
      if (hasJokerBomb && card(id).rank >= SMALL_JOKER) continue;
      const r = card(id).rank;
      if (!pool.has(r)) pool.set(r, []);
      pool.get(r)!.push(id);
    }
    const counts: number[] = [];
    for (const [r, ids] of pool) counts[r] = ids.length;
    for (let r = 0; r <= BIG_JOKER; r++) counts[r] = counts[r] ?? 0;
    const wildsLeft = wildIds.filter((id) => !used.has(id));
    const res = search(counts, wildsLeft.length, level, 0, new Map(), 0, cost);
    let score = res.score + pre.reduce((a, c) => a + cost(c.type, c.value), 0);
    if (hasJokerBomb) score += cost('jokerbomb', 0);
    if (best && score >= best.score - 1e-9) continue;

    // 落实成具体的牌
    const wpool = [...wildsLeft];
    const takeR = (r: number, n: number) => pool.get(r)!.splice(0, n);
    const combos: Combo[] = [...pre];
    if (hasJokerBomb) combos.push({ type: 'jokerbomb', cards: jokers, value: 0 });
    for (const ch of res.chains) {
      const ids: number[] = [];
      for (let p = 0; p < ch.len; p++) {
        const r = chainRank(ch.start, p);
        const got = pool.has(r) ? takeR(r, ch.mult) : [];
        ids.push(...got);
        for (let k = got.length; k < ch.mult; k++) ids.push(wpool.shift()!);
      }
      combos.push({ type: ch.type, cards: ids, value: ch.start });
    }
    for (const g of res.groups) {
      const ids: number[] = [];
      for (const p of g.parts) ids.push(...takeR(p.rank, p.n));
      for (let k = 0; k < g.wild; k++) ids.push(wpool.shift()!);
      combos.push({ type: g.type, cards: ids, value: g.value });
    }
    // 按点数组出的顺子可能碰巧同花，那就是同花顺（炸弹）
    for (const c of combos) {
      if (c.type === 'straight' && parseCombos(c.cards, level).some((x) => x.type === 'straightflush')) c.type = 'straightflush';
    }
    best = { score, combos };
  }
  // 只用来选拆法时，评分换回原代价，与不结合外面的牌时可比
  if (unseen && splitControl.enabled && splitControl.mode === 'group') {
    return { score: best!.combos.reduce((a, c) => a + comboCost(c.type, c.value, c.cards.length), 0), combos: best!.combos };
  }
  return best!;
}

/** 某张牌所在组合的“紧密程度”：单张 0、对子 1、三张/三带二 2、连牌 3、炸弹 4 */
const TIGHTNESS: Partial<Record<ComboType, number>> = {
  single: 0, pair: 1, triple: 2, fullhouse: 2, straight: 3, tube: 3, plate: 3, bomb: 4, straightflush: 4, jokerbomb: 4,
};

/**
 * 出牌时同点数有多张可选，优先用不属于其他组合的那张：单张 > 对子 > 三张 > 连牌 > 炸弹里的。
 * groups 为手牌的分组（界面上理好的列）；不传时按拆牌结果。牌型和大小不变，只是换成等价的另一张。
 */
export function preferLooseCards(c: Combo, hand: number[], level: number, groups?: number[][]): Combo {
  if (c.type === 'straightflush' || c.type === 'jokerbomb') return c; // 同花顺要看花色，天王炸没有可换的
  const gs = groups ?? bestSplit(hand, level).combos.map((x) => x.cards);
  const groupOf = new Map<number, number[]>();
  for (const g of gs) for (const id of g) groupOf.set(id, g);
  const tight = (id: number) => {
    const g = groupOf.get(id);
    if (!g || g.length === 1) return 0;
    const t = parseCombos(g, level)[0]?.type;
    return t ? TIGHTNESS[t] ?? 2 : 2;
  };
  const inCombo = new Set(c.cards);
  const cards: number[] = [];
  const used = new Set<number>();
  for (const id of c.cards) {
    if (isWild(id, level)) { cards.push(id); used.add(id); continue; }
    const r = card(id).rank;
    // 同点数、同样不是逢人配、还没被选中的牌里挑最“散”的（并列时保留原来的牌）
    const best = hand
      .filter((x) => !used.has(x) && !isWild(x, level) && card(x).rank === r)
      .sort((a, b) => tight(a) - tight(b) || Number(inCombo.has(b)) - Number(inCombo.has(a)))[0] ?? id;
    cards.push(best);
    used.add(best);
  }
  return { ...c, cards };
}

function without(hand: number[], cards: number[]): number[] {
  const s = new Set(cards);
  return hand.filter((x) => !s.has(x));
}

// ---------- 决策 ----------

export interface AIContext {
  seat: number;
  hand: number[];
  level: number;
  /** 当前要压的牌；为 null 表示自己首出 */
  target: Combo | null;
  targetSeat: number | null;
  /** 每个座位剩余张数（已出完为 0） */
  handCounts: number[];
  /** 外面还没出现的牌（记牌器）；传入时拆牌按控制牌评估，不传时与原电脑相同 */
  unseen?: UnseenStat;
}

const partnerOf = (s: number) => (s + 2) % 4;

function leadKey(c: Combo): number {
  const bonus = c.type === 'single' ? 0 : c.type === 'pair' ? -1 : -3;
  return c.value + (c.type === 'straight' || c.type === 'tube' || c.type === 'plate' ? 3 : 0) + bonus;
}

/** 首出时的候选顺序（提示也用）。 */
export function leadOptions(ctx: AIContext): Combo[] {
  const { hand, level, seat, handCounts, unseen } = ctx;
  const split = bestSplit(hand, level, unseen);
  if (split.combos.length === 1) return split.combos;
  const nonBomb = split.combos.filter((c) => !isBomb(c)).sort((a, b) => leadKey(a) - leadKey(b));
  const bombs = split.combos.filter(isBomb).sort((a, b) => bombLevel(a) - bombLevel(b) || a.value - b.value);
  if (!nonBomb.length) return bombs;

  const partner = partnerOf(seat);
  const next = (seat + 1) % 4;
  const pc = handCounts[partner];
  // 帮对家走牌
  if (pc === 1 || pc === 2) {
    const t: ComboType = pc === 1 ? 'single' : 'pair';
    const baseHands = handsOf(split);
    const keeps = (c: Combo) => (handsOf(bestSplit(without(hand, c.cards), level, unseen)) < baseHands ? 0 : 1);
    // 下家也只剩 1 张时，小单张会先被下家接走，改送大一点的（不超过 A）
    const nextAlsoOne = pc === 1 && handCounts[(seat + 1) % 4] === 1;
    const byValue = (a: Combo, b: Combo) => (nextAlsoOne ? (b.value <= 14 ? b.value : 0) - (a.value <= 14 ? a.value : 0) : a.value - b.value);
    // 下家也只剩 1 张时宁可拆对子也要送大一点的单张（手册牌例04）；否则优先不拆牌的
    const small = findAllPlays(hand, level).filter((c) => c.type === t)
      .sort((a, b) => (nextAlsoOne ? byValue(a, b) : keeps(a) - keeps(b) || byValue(a, b)));
    if (small.length) return [small[0], ...nonBomb, ...bombs];
  }
  const nc = handCounts[next];
  if (nc === 1 || nc === 2) {
    const avoid: ComboType = nc === 1 ? 'single' : 'pair';
    const safe = nonBomb.filter((c) => c.type !== avoid);
    const risky = nonBomb.filter((c) => c.type === avoid).sort((a, b) => b.value - a.value);
    return [...safe, ...risky, ...bombs];
  }
  return [...nonBomb, ...bombs];
}

interface Scored {
  combo: Combo;
  delta: number;
  /** 是否从连牌（顺子/三连对/钢板）里拆牌，且出完后剩余牌需要的手数没有减少 */
  breaksChain: boolean;
}

const handsOf = (split: Split) => split.combos.filter((c) => !isBomb(c)).length;

/** 跟牌候选，按代价从小到大。 */
export function followOptions(ctx: AIContext): Scored[] {
  const { hand, level, target, unseen } = ctx;
  const baseSplit = bestSplit(hand, level, unseen);
  const base = baseSplit.score;
  const baseHands = handsOf(baseSplit);
  const groups = baseSplit.combos.map((x) => x.cards);
  const chainCards = new Set(baseSplit.combos.filter((x) => x.type === 'straight' || x.type === 'tube' || x.type === 'plate').flatMap((x) => x.cards));
  const cands = findAllPlays(hand, level, target);
  const scored = cands.map((c0) => {
    const combo = preferLooseCards(c0, hand, level, groups);
    const rest = without(hand, combo.cards);
    const split = rest.length ? bestSplit(rest, level, unseen) : null;
    const s = split ? split.score : -10;
    const delta = s - base + (isBomb(combo) ? 1.2 + bombLevel(combo) * 0.05 : 0) + combo.value * 0.01;
    const breaksChain = !!split && !isBomb(combo) && combo.cards.some((id) => chainCards.has(id)) && handsOf(split) >= baseHands;
    return { combo, delta, breaksChain };
  });
  return scored.sort((a, b) => a.delta - b.delta);
}

/**
 * 跟对手的牌时，对手剩几张以内就用外面压不住的牌收回出牌权（0 表示不启用；只在传入记牌信息 unseen 时生效，
 * 即困难电脑/托管/提示，原电脑和模拟推演不受影响）。评估用可调。
 */
export const aiTake = { cards: 0 };

/**
 * 决定出炸弹时，先找比炸弹代价低、不拆连牌的非炸弹出法（如用王跟单张）；enabled=false 恢复旧逻辑，评估用。
 * 评估（scripts/bench.ts，对旧逻辑配对对打）：电脑每局净升级 +0.079 ±0.048（2000 局）、+0.119 ±0.033（4000 局，另一组牌）；
 * 顾问 +0.137 ±0.070（1000 局）。
 */
export const bombAlt = { enabled: true };

export function aiPlay(ctx: AIContext): Combo | null {
  const c = decide(ctx);
  return c ? preferLooseCards(c, ctx.hand, ctx.level) : null;
}

function decide(ctx: AIContext): Combo | null {
  const { hand, target, targetSeat, seat, handCounts } = ctx;
  if (!target) return leadOptions(ctx)[0];

  const opts = followOptions(ctx);
  if (!opts.length) return null;
  const finishing = opts.find((o) => o.combo.cards.length === hand.length);
  if (finishing) return finishing.combo;
  if (targetSeat === partnerOf(seat)) return null;

  const oppLeft = targetSeat !== null ? handCounts[targetSeat] : 27;
  const urgent = oppLeft <= 6;
  const nonBomb = opts.filter((o) => !isBomb(o.combo));
  // 不急的时候不为了跟牌拆散已有的牌型（例如从顺子里拆一张去跟单张）
  const pick = nonBomb.find((o) => o.delta <= (urgent ? 3 : -0.35) && (urgent || !o.breaksChain));
  if (pick) return pick.combo;
  // 对手剩的牌不多时，用外面同类压不住的牌（如对手出小王、自己有大王）收回出牌权，不让他顺下去
  if (aiTake.cards > 0 && ctx.unseen && oppLeft <= aiTake.cards) {
    const ctl = nonBomb.find((o) => !o.breaksChain && !sameTypeBeatable(o.combo, ctx.unseen!, ctx.level));
    if (ctl) return ctl.combo;
  }

  const bombs = opts.filter((o) => isBomb(o.combo));
  if (!bombs.length) return null;
  const restCombos = bestSplit(without(hand, bombs[0].combo.cards), ctx.level, ctx.unseen).combos.filter((c) => !isBomb(c)).length;
  const bigTarget = !isBomb(target) && target.value >= 14;
  if (oppLeft <= 8 || restCombos <= 2 || (bigTarget && hand.length <= 15)) {
    if (isBomb(target) && oppLeft > 8 && restCombos > 2) return null;
    // 能用更便宜的牌（如王）压住就不动炸弹
    const cheaper = bombAlt.enabled ? nonBomb.find((o) => !o.breaksChain && o.delta < bombs[0].delta) : undefined;
    return (cheaper ?? bombs[0]).combo;
  }
  return null;
}

/** 提示顺序：首出按出牌顺序，跟牌按代价。 */
export function hintOptions(ctx: AIContext): Combo[] {
  if (!ctx.target) return leadOptions(ctx);
  return followOptions(ctx).map((o) => o.combo);
}

/** 进贡：最大的牌（不含逢人配）。 */
export function tributeCard(hand: number[], level: number): number {
  let best = -1, bv = -1;
  for (const id of hand) {
    if (isWild(id, level)) continue;
    const v = cardValue(id, level);
    if (v > bv) { bv = v; best = id; }
  }
  return best;
}

/** 还贡：一张 10 及以下的牌，尽量不拆牌。 */
export function returnCard(hand: number[], level: number): number {
  let cands = hand.filter((id) => card(id).rank <= 10 && card(id).rank !== level);
  if (!cands.length) cands = hand.filter((id) => card(id).rank <= 10);
  if (!cands.length) return [...hand].sort((a, b) => cardValue(a, level) - cardValue(b, level))[0];
  let best = cands[0], bs = Infinity;
  const seen = new Set<number>();
  for (const id of cands) {
    const r = card(id).rank;
    if (seen.has(r)) continue;
    seen.add(r);
    const s = bestSplit(without(hand, [id]), level).score + cardValue(id, level) * 0.02;
    if (s < bs) { bs = s; best = id; }
  }
  return best;
}
