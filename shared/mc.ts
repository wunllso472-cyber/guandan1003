// 蒙特卡洛模拟：按已知信息随机推测其他三家的手牌，把每个候选出法推演到本局结束，比较团队结果。
// 只用玩家本来就能知道的信息（自己的手牌、已出的牌、剩余张数、进贡/还贡时亮过的牌）。
import { GuandanGame, partnerOf, teamOf } from './game';
import { bestSplit, aiPlay } from './ai';
import { findAllPlays } from './finder';
import { bombLevel, isBomb, type Combo } from './combo';
import { card, shuffle } from './cards';
import type { CardTracker } from './tracker';

/** 模拟需要的局面数据（纯数据，可以传给 Web Worker） */
export interface MCState {
  seat: number;
  level: number;
  hand: number[];
  /** 每个座位剩余张数（已出完为 0） */
  counts: number[];
  /** 外面还没出现的牌（分布在其他仍在打的玩家手里） */
  unseen: number[];
  /** 确定在某人手里的牌（进贡/还贡亮过、还没打出） */
  known: number[][];
  /** 已出完的座位，按名次顺序 */
  finishOrder: number[];
  /** 当前要压的牌 */
  lastPlay: { seat: number; combo: Combo } | null;
  /** 上一手之后已经有几人不出 */
  passCount: number;
  /** 自己出完后能看到的对家手牌 */
  partnerHand?: number[] | null;
}

export interface MCResult {
  /** 每个候选的平均团队得分（我方净升级） */
  scores: number[];
  /** 实际模拟的牌局数 */
  samples: number;
}

/** 随机推测其他人的手牌：已知的牌先放好，其余随机分配，张数与实际一致 */
function determinize(st: MCState, seed: number): number[][] | null {
  const hands: number[][] = [[], [], [], []];
  hands[st.seat] = [...st.hand];
  const partner = partnerOf(st.seat);
  const pool = new Set(st.unseen);
  if (st.partnerHand) { hands[partner] = [...st.partnerHand]; for (const id of st.partnerHand) pool.delete(id); }
  for (let s = 0; s < 4; s++) {
    if (s === st.seat || (st.partnerHand && s === partner)) continue;
    for (const id of st.known[s] ?? []) if (pool.has(id)) { hands[s].push(id); pool.delete(id); }
  }
  const rest = shuffle([...pool], seed);
  let k = 0;
  for (let s = 0; s < 4; s++) {
    if (s === st.seat || (st.partnerHand && s === partner)) continue;
    const need = st.counts[s] - hands[s].length;
    if (need < 0 || k + need > rest.length) return null;
    hands[s].push(...rest.slice(k, k + need));
    k += need;
  }
  return hands;
}

/** 推演用的简化电脑：首出按拆牌结果出最小的组合；跟牌出最小的、不拆炸弹的牌；不压对家；对手快走完才炸 */
function quickPlay(g: GuandanGame, seat: number): Combo | null {
  const hand = g.hands[seat];
  const target = g.lastPlay?.combo ?? null;
  const counts = g.handCounts();
  if (!target) {
    const combos = bestSplit(hand, g.level).combos;
    if (combos.length === 1) return combos[0];
    const nonBomb = combos.filter((c) => !isBomb(c));
    const pool = nonBomb.length ? nonBomb : combos;
    // 连牌、三张等多张的组合先出，同类出小的
    return pool.sort((a, b) => (b.cards.length > 2 ? 1 : 0) - (a.cards.length > 2 ? 1 : 0) || a.value - b.value)[0];
  }
  const ts = g.lastPlay!.seat;
  const cands = findAllPlays(hand, g.level, target);
  if (!cands.length) return null;
  const finishing = cands.find((c) => c.cards.length === hand.length);
  if (finishing) return finishing;
  if (ts === partnerOf(seat)) return null;
  const urgent = counts[ts] <= 6;
  const nonBomb = cands.filter((c) => !isBomb(c)).sort((a, b) => a.value - b.value);
  if (nonBomb.length) {
    // 不急的时候只出“正好一组”的牌（同点数张数相同），避免拆牌
    const exact = nonBomb.find((c) => urgent || fitsExactly(c, hand));
    if (exact) return exact;
  }
  if (urgent) {
    const bombs = cands.filter(isBomb).sort((a, b) => bombLevel(a) - bombLevel(b) || a.value - b.value);
    if (bombs.length) return bombs[0];
  }
  return null;
}

/** 牌组里每个点数的张数，正好等于手里这个点数的张数（不拆对子、三张、炸弹） */
function fitsExactly(c: Combo, hand: number[]): boolean {
  if (c.type === 'straight' || c.type === 'tube' || c.type === 'plate') return true;
  const have = new Map<number, number>();
  for (const id of hand) have.set(card(id).rank, (have.get(card(id).rank) ?? 0) + 1);
  const used = new Map<number, number>();
  for (const id of c.cards) used.set(card(id).rank, (used.get(card(id).rank) ?? 0) + 1);
  for (const [r, n] of used) if ((have.get(r) ?? 0) !== n) return false;
  return true;
}

/** 推演时各家的出牌方式：quick 为简化版（快但弱），ai 为正式电脑出牌（慢但接近真实对局） */
export type RolloutPolicy = 'quick' | 'ai';

function policyPlay(policy: RolloutPolicy, g: GuandanGame, seat: number): Combo | null {
  if (policy === 'quick') return quickPlay(g, seat);
  return aiPlay({ seat, hand: g.hands[seat], level: g.level, target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, handCounts: g.handCounts() });
}

/** 从当前局面开始，先执行候选出法，再推演到本局结束；返回我方净升级 */
function rollout(st: MCState, hands: number[][], move: Combo | null, policy: RolloutPolicy): number {
  const g = new GuandanGame();
  g.levels = [st.level, st.level];
  g.levelTeam = 0;
  g.phase = 'play';
  g.hands = hands.map((h) => [...h]);
  g.finishOrder = [...st.finishOrder];
  g.turn = st.seat;
  g.lastPlay = st.lastPlay ? { seat: st.lastPlay.seat, combo: st.lastPlay.combo } : null;
  g.passCount = st.passCount;
  let result = 0;
  g.on((e) => {
    if (e.type === 'roundEnd') {
      const o = e.result.order;
      const up = [0, 3, 2, 1][o.indexOf(partnerOf(o[0]))];
      result = teamOf(o[0]) === teamOf(st.seat) ? up : -up;
    }
  });
  const err = move ? g.play(st.seat, move.cards, move) : g.pass(st.seat);
  if (err) return NaN;
  let guard = 0;
  while (g.phase === 'play' && guard++ < 400) {
    const s = g.turn;
    const c = policyPlay(policy, g, s);
    const e = c ? g.play(s, c.cards, c) : g.pass(s);
    if (e) { if (g.lastPlay) g.pass(s); else g.play(s, [g.hands[s][0]]); }
  }
  return result;
}

/**
 * 对每个候选出法做蒙特卡洛模拟。所有候选使用同一批推测出的牌局（公平比较）。
 * budgetMs：时间预算；maxSamples：最多模拟多少种牌局。
 */
export function monteCarlo(st: MCState, moves: (Combo | null)[], budgetMs = 800, maxSamples = 200, seed = 1, policy: RolloutPolicy = 'ai'): MCResult {
  const t0 = Date.now();
  const sums = moves.map(() => 0);
  let n = 0;
  for (let k = 0; k < maxSamples * 3 && n < maxSamples; k++) {
    if (Date.now() - t0 > budgetMs && n >= 8) break;
    const hands = determinize(st, seed + k);
    if (!hands) continue;
    const vals = moves.map((m) => rollout(st, hands, m, policy));
    if (vals.some((v) => Number.isNaN(v))) continue;
    vals.forEach((v, i) => (sums[i] += v));
    n++;
  }
  return { scores: sums.map((s) => (n ? s / n : 0)), samples: n };
}

/** 由记牌器和当前局面生成模拟数据 */
export function mcStateFrom(inp: {
  seat: number; hand: number[]; level: number; target: Combo | null; targetSeat: number | null;
  counts: number[]; tracker: CardTracker; partnerHand?: number[] | null;
}): MCState {
  const { seat, hand, level, target, targetSeat, counts, tracker } = inp;
  // 上一手之后连续“不出”的次数
  let passCount = 0;
  for (let i = tracker.history.length - 1; i >= 0 && !tracker.history[i].combo; i--) passCount++;
  const finishOrder = [0, 1, 2, 3].filter((s) => tracker.seats[s].place > 0).sort((a, b) => tracker.seats[a].place - tracker.seats[b].place);
  return {
    seat, level, hand: [...hand], counts: [...counts],
    unseen: tracker.unseen(hand, inp.partnerHand ?? null),
    known: tracker.seats.map((r) => [...r.known]),
    finishOrder,
    lastPlay: target && targetSeat !== null ? { seat: targetSeat, combo: target } : null,
    passCount: target ? passCount : 0,
    partnerHand: inp.partnerHand ?? null,
  };
}
