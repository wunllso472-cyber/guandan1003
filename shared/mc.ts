// 蒙特卡洛模拟：按已知信息随机推测其他三家的手牌，把每个候选出法推演到本局结束，比较团队结果。
// 只用玩家本来就能知道的信息（自己的手牌、已出的牌、剩余张数、进贡/还贡时亮过的牌）。
import { GuandanGame, partnerOf, teamOf } from './game';
import { bestSplit, aiPlay, leadOptions, followOptions, type AIContext } from './ai';
import { findAllPlays } from './finder';
import { bombLevel, isBomb, type Combo, type ComboType } from './combo';
import { card, cardValue, isWild, shuffle } from './cards';
import { sameTypeBeatable, unseenStat, type CardTracker } from './tracker';

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
  /** 确定不在某人手里的牌（进贡者没有比贡牌大的牌、抗贡后其他人没有大王），推测手牌时不分给他 */
  lacks?: number[][];
  /** 已出完的座位，按名次顺序 */
  finishOrder: number[];
  /** 当前要压的牌 */
  lastPlay: { seat: number; combo: Combo } | null;
  /** 上一手之后已经有几人不出 */
  passCount: number;
  /** 自己出完后能看到的对家手牌 */
  partnerHand?: number[] | null;
  /**
   * 出牌记录里的线索：某家面对对手出的这种牌选择了不出（每家每种牌型取最小的那次）。
   * 推测手牌时降低他持有能压过这手牌的同类大牌的概率（只降低，不排除：不跟不代表没有）。
   */
  passed?: { seat: number; type: ComboType; value: number }[];
  /**
   * 线索（教材 I02 点数空隙）：某家跟牌时用 hi 压了 lo，跳过了中间的点数——
   * 通常说明他没有中间点数的同类牌（否则会用更小的压），降低他持有这些点数的概率。
   */
  gaps?: { seat: number; type: ComboType; lo: number; hi: number }[];
}

/**
 * 推断加权猜牌的开关与分量（分量是该家持有对应牌的相对概率）。
 * 实测（scripts/infer-accuracy.ts，电脑对局 40–60 局、约 4000 个决策点）：
 *   均匀随机猜对约 47.4%；“不跟”线索按 0.6/0.3/0.1 加权、“跟牌空隙”按 0.5/0.2 加权都让猜牌略差，
 *   反向加权也只在 ±0.1% 内——这些公开线索对推测手牌几乎没有信息量（印证教材 L05“不跟不是缺牌证明”）。
 * 因此默认关闭，保留用于以后验证新的线索。
 */
export const mcInfer = {
  enabled: false,
  /** 面对对手的牌不出：实测会让猜牌更不准（不跟的人常常留着大牌），默认不用 */
  usePasses: false,
  weight: { single: 0.6, pair: 0.8, triple: 0.85, fullhouse: 0.85 } as Partial<Record<ComboType, number>>,
  useGaps: true,
  gapWeight: 0.5,
};

export interface MCResult {
  /** 每个候选的平均团队得分（我方净升级） */
  scores: number[];
  /** 实际模拟的牌局数 */
  samples: number;
}

/** 随机推测其他人的手牌：已知的牌先放好，其余随机分配，张数与实际一致 */
export function determinize(st: MCState, seed: number): number[][] | null {
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
  const seats = [0, 1, 2, 3].filter((s) => s !== st.seat && !(st.partnerHand && s === partner));
  const need = seats.map((s) => st.counts[s] - hands[s].length);
  if (need.some((n) => n < 0) || need.reduce((a, b) => a + b, 0) > rest.length) return null;
  const weightOf = cardWeights(st, seats);
  const lacks = seats.map((s) => new Set(st.lacks?.[s] ?? []));
  const constrained = lacks.some((l) => rest.some((id) => l.has(id)));
  if (!weightOf && !constrained) {
    let k = 0;
    seats.forEach((s, i) => { hands[s].push(...rest.slice(k, k + need[i])); k += need[i]; });
    return hands;
  }
  // 每张牌能给哪几家：排除确定没有的；全被排除说明信息矛盾，这张牌不加限制
  const eligible = new Map<number, number[]>();
  for (const id of rest) {
    const can = seats.map((_, i) => i).filter((i) => !lacks[i].has(id));
    eligible.set(id, can.length ? can : seats.map((_, i) => i));
  }
  // 受限最多的牌先分（洗牌后的顺序内稳定排序，仍然随机）；某家剩下能拿的牌正好等于还缺的张数时必须给他
  const order = [...rest].sort((a, b) => eligible.get(a)!.length - eligible.get(b)!.length);
  const avail = seats.map((_, i) => rest.filter((id) => eligible.get(id)!.includes(i)).length);
  // 加权分配：每张牌按“该家还缺几张 × 该家持有这张牌的相对概率”随机给一家
  let r = (seed * 2654435761) >>> 0;
  const rand = () => { r = (r + 0x6d2b79f5) >>> 0; let t = Math.imul(r ^ (r >>> 15), 1 | r); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (const id of order) {
    if (need.every((n) => n <= 0)) break;
    const can = eligible.get(id)!;
    let pick = can.find((i) => need[i] > 0 && need[i] >= avail[i]);
    if (pick === undefined) {
      let total = 0;
      const ws = can.map((i) => { const w = need[i] > 0 ? need[i] * (weightOf ? weightOf(i, id) : 1) : 0; total += w; return w; });
      if (total <= 0) return null;
      let x = rand() * total, k = 0;
      while (k < ws.length - 1 && x >= ws[k]) { x -= ws[k]; k++; }
      pick = can[k];
    }
    for (const i of can) avail[i]--;
    hands[seats[pick]].push(id);
    need[pick]--;
  }
  return need.every((n) => n === 0) ? hands : null;
}

/** 每家持有某张牌的相对概率（没有线索时返回 null，按均匀随机分配） */
function cardWeights(st: MCState, seats: number[]): ((i: number, id: number) => number) | null {
  if (!mcInfer.enabled) return null;
  const passes = seats.map((s) => (mcInfer.usePasses ? (st.passed ?? []).filter((p) => p.seat === s) : []));
  const gaps = seats.map((s) => (mcInfer.useGaps ? (st.gaps ?? []).filter((p) => p.seat === s) : []));
  if (passes.every((l) => !l.length) && gaps.every((l) => !l.length)) return null;
  const lv = st.level;
  return (i, id) => {
    if (isWild(id, lv)) return 1; // 逢人配什么都能凑，不受影响
    const v = cardValue(id, lv);
    let w = 1;
    for (const p of passes[i]) {
      const k = mcInfer.weight[p.type];
      if (k !== undefined && v > p.value) w *= k;
    }
    for (const gp of gaps[i]) if (v > gp.lo && v < gp.hi) { w *= mcInfer.gapWeight; break; }
    return w;
  };
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

/**
 * 推演时各家的出牌方式：quick 为简化版（快但弱），ai 为正式电脑出牌（慢但接近真实对局），
 * noisy 为电脑出牌加随机：以 rolloutNoise.eps 的概率改出其他合理的选择（首出换成前几个候选之一；跟牌改为不出或换一手），
 * 避免把对手当成和原电脑一模一样（对手风格不同时推演更稳）。
 */
export type RolloutPolicy = 'quick' | 'ai' | 'noisy';

/** noisy 推演的随机程度（评估用可调） */
export const rolloutNoise = { eps: 0.2 };

/** 推演用的随机数（每个推测牌局一个，所有候选出法共用同一串，比较公平） */
export function rolloutRng(seed: number): () => number {
  let r = (seed * 2246822519 + 1) >>> 0;
  return () => { r = (r + 0x6d2b79f5) >>> 0; let t = Math.imul(r ^ (r >>> 15), 1 | r); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function noisyPlay(g: GuandanGame, seat: number, rand: () => number): Combo | null {
  const ctx: AIContext = { seat, hand: g.hands[seat], level: g.level, target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, handCounts: g.handCounts() };
  const base = aiPlay(ctx);
  // 能一手出完时不随机
  if (rand() >= rolloutNoise.eps || (base && base.cards.length === ctx.hand.length)) return base;
  if (!ctx.target) {
    const opts = leadOptions(ctx).slice(0, 3);
    return opts[Math.floor(rand() * opts.length)] ?? base;
  }
  const alts: (Combo | null)[] = [null, ...followOptions(ctx).filter((o) => !isBomb(o.combo)).slice(0, 2).map((o) => o.combo)];
  return alts[Math.floor(rand() * alts.length)];
}

function policyPlay(policy: RolloutPolicy, g: GuandanGame, seat: number, rand: () => number): Combo | null {
  if (policy === 'quick') return quickPlay(g, seat);
  if (policy === 'noisy') return noisyPlay(g, seat, rand);
  return aiPlay({ seat, hand: g.hands[seat], level: g.level, target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, handCounts: g.handCounts() });
}

/** 从当前局面开始，先执行候选出法，再推演到本局结束；返回我方净升级 */
function rollout(st: MCState, hands: number[][], move: Combo | null, policy: RolloutPolicy, rand: () => number): number {
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
    const c = policyPlay(policy, g, s, rand);
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
    const vals = moves.map((m) => rollout(st, hands, m, policy, rolloutRng(seed + k)));
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
  // 线索：面对对手出的单张/对子/三张/三带二选择不出（面对对家的牌不出是让牌，不算）
  const minPass = new Map<string, { seat: number; type: ComboType; value: number }>();
  let last: { seat: number; combo: Combo } | null = null;
  const gaps: { seat: number; type: ComboType; lo: number; hi: number }[] = [];
  for (const h of tracker.history) {
    if (h.combo) {
      // 跟牌跳过了中间点数（单张、对子），自己的出牌不用推断
      if (!h.lead && last && h.seat !== seat && (h.combo.type === 'single' || h.combo.type === 'pair')
        && h.combo.type === last.combo.type && h.combo.value - last.combo.value >= 2) {
        gaps.push({ seat: h.seat, type: h.combo.type, lo: last.combo.value, hi: h.combo.value });
      }
      last = { seat: h.seat, combo: h.combo };
      continue;
    }
    if (!last || h.seat === seat || teamOf(h.seat) === teamOf(last.seat)) continue;
    const t = last.combo.type;
    if (!(t in mcInfer.weight)) continue;
    const key = `${h.seat}:${t}`;
    const prev = minPass.get(key);
    if (!prev || last.combo.value < prev.value) minPass.set(key, { seat: h.seat, type: t, value: last.combo.value });
  }
  return {
    seat, level, hand: [...hand], counts: [...counts],
    unseen: tracker.unseen(hand, inp.partnerHand ?? null),
    known: tracker.seats.map((r) => [...r.known]),
    lacks: tracker.seats.map((r) => [...r.lacks]),
    finishOrder,
    lastPlay: target && targetSeat !== null ? { seat: targetSeat, combo: target } : null,
    passCount: target ? passCount : 0,
    partnerHand: inp.partnerHand ?? null,
    passed: [...minPass.values()],
    gaps,
  };
}

// ---------------- 中盘：浅层模拟 + 局面评分 ----------------

/** 局面特征名称（第一版 9 个，与 EVAL_WEIGHTS_V1 一一对应，常数项除外） */
export const EVAL_FEATURES_V1 = [
  '下一手由我方先出（+1）或对方先出（-1）',
  '对方最快的人还要几手 - 我方最快的人还要几手',
  '对方合计手数 - 我方合计手数',
  '我方炸弹数 - 对方炸弹数',
  '我方已出完人数 - 对方已出完人数',
  '头游属于我方（+1）/ 对方（-1）/ 还没有（0）',
  '对方最快的人剩几张 - 我方最快的人剩几张',
  '对方较慢的人还要几手 - 我方较慢的人还要几手',
  '对方较慢的人剩几张 - 我方较慢的人剩几张',
];

/**
 * 第二版在第一版之后加入控制牌（教材“手数 − 控制数”）：
 * 有效手数 = 不含炸弹的手数 − 对方两家用同类牌压不住的手数（推演里各家手牌已知，直接按对方的牌判断）。
 */
export const EVAL_FEATURES = [
  ...EVAL_FEATURES_V1,
  '对方最快的人有效手数 - 我方最快的人有效手数',
  '对方较慢的人有效手数 - 我方较慢的人有效手数',
  '我方炸弹威力 - 对方炸弹威力（按炸弹等级，天王炸记 6）',
  '我方有人有效手数 ≤ 0（能一路走完）- 对方有人如此',
  '首出方最快的人有效手数 ≤ 1：我方首出 +1 / 对方首出 -1 / 否则 0',
];

/** 由 scripts/fit-eval.ts 拟合得到（3000 局电脑对局、78554 个局面，R² = 0.52；第二版加入“较慢的人”特征）：[常数项, ...各特征权重]，预测该队本局净升级 */
export const EVAL_WEIGHTS_V1 = [0, 0.3651, -0.0107, 0.3298, 0.437, 0.6799, 0.6799, 0.0139, -0.236, 0.0061];

/**
 * 第二版权重（加入控制牌特征）：scripts/fit-eval.ts 3000 局，验证集 R² 0.516（第一版同样数据 0.497）。
 * 600 局配对对打（中盘模拟）：对原电脑每局净升级比第一版多 +0.30 ±0.16，对顾问多 +0.15 ±0.15。
 */
export const EVAL_WEIGHTS = [0, 0.2971, -0.1129, 0.3283, 0.4576, 0.7327, 0.7327, 0.0121, -0.2981, 0.0115, 0.1146, 0.0977, 0.0016, 0.1491, 0.1921];

/** 当前使用的局面评分（评估用可切换） */
export const evalModel: { version: 'v1' | 'v2'; weights: number[] } = { version: 'v2', weights: EVAL_WEIGHTS };

/** 从 team 的视角计算局面特征；leader 是下一手首出的座位。version 为 v1 时只算前 9 个 */
export function evalFeatures(hands: number[][], level: number, team: number, leader: number, finishOrder: number[], version: 'v1' | 'v2' = 'v2'): number[] {
  const hs = hands.map((h) => (h.length ? bestSplit(h, level).combos : []));
  const handsOf = (s: number) => hs[s].filter((c) => !isBomb(c)).length;
  const bombsOf = (s: number) => hs[s].filter(isBomb).length;
  const members = (t: number) => [0, 1, 2, 3].filter((s) => s % 2 === t);
  // 对方两家的牌合在一起，判断同类能不能压过（合在一起会略高估对方，只是近似）
  const oppStat = version === 'v2' ? [0, 1].map((t) => unseenStat(members(1 - t).flatMap((s) => hands[s]), level)) : [];
  const effOf = (s: number) => {
    const st = oppStat[s % 2];
    return handsOf(s) - hs[s].filter((c) => !isBomb(c) && !sameTypeBeatable(c, st, level)).length;
  };
  const powerOf = (s: number) => hs[s].filter(isBomb).reduce((a, c) => a + Math.min(6, bombLevel(c)), 0);
  const stat = (t: number) => {
    const act = members(t).filter((s) => hands[s].length > 0);
    const eff = version === 'v2' ? act.map(effOf) : [];
    return {
      minH: act.length ? Math.min(...act.map(handsOf)) : 0,
      sumH: act.reduce((a, s) => a + handsOf(s), 0),
      bombs: act.reduce((a, s) => a + bombsOf(s), 0),
      done: members(t).filter((s) => finishOrder.includes(s)).length,
      minN: act.length ? Math.min(...act.map((s) => hands[s].length)) : 0,
      // 较慢的那个人：双上、少被双下取决于他（已出完的人记 0）
      maxH: act.length ? Math.max(...act.map(handsOf)) : 0,
      maxN: act.length ? Math.max(...act.map((s) => hands[s].length)) : 0,
      minE: eff.length ? Math.min(...eff) : 0,
      maxE: eff.length ? Math.max(...eff) : 0,
      power: act.reduce((a, s) => a + powerOf(s), 0),
      runs: eff.some((e) => e <= 0) ? 1 : 0,
      active: act.length > 0,
    };
  };
  const us = stat(team), them = stat(1 - team);
  const first = finishOrder.length ? (finishOrder[0] % 2 === team ? 1 : -1) : 0;
  const base = [
    leader % 2 === team ? 1 : -1,
    them.minH - us.minH,
    them.sumH - us.sumH,
    us.bombs - them.bombs,
    us.done - them.done,
    first,
    them.minN - us.minN,
    them.maxH - us.maxH,
    them.maxN - us.maxN,
  ];
  if (version === 'v1') return base;
  const lead = leader % 2 === team ? us : them;
  const leadClose = lead.active && lead.minE <= 1 ? (leader % 2 === team ? 1 : -1) : 0;
  return [
    ...base,
    them.minE - us.minE,
    them.maxE - us.maxE,
    us.power - them.power,
    us.runs - them.runs,
    leadClose,
  ];
}

export function evalPosition(hands: number[][], level: number, team: number, leader: number, finishOrder: number[]): number {
  const w = evalModel.weights;
  const f = evalFeatures(hands, level, team, leader, finishOrder, evalModel.version);
  return f.reduce((s, v, i) => s + v * w[i + 1], w[0]);
}

/** 中盘推演几轮后评分（评估用可调，默认 1 轮） */
export const shallowDepth = { tricks: 1 };

/** 浅层推演：执行候选出法后，用简化出牌推演到这一轮结束（共 shallowDepth.tricks 轮），再给局面打分（本局已结束则用真实结果） */
function shallowRollout(st: MCState, hands: number[][], move: Combo | null, policy: RolloutPolicy, rand: () => number): number {
  const g = new GuandanGame();
  g.levels = [st.level, st.level];
  g.levelTeam = 0;
  g.phase = 'play';
  g.hands = hands.map((h) => [...h]);
  g.finishOrder = [...st.finishOrder];
  g.turn = st.seat;
  g.lastPlay = st.lastPlay ? { seat: st.lastPlay.seat, combo: st.lastPlay.combo } : null;
  g.passCount = st.passCount;
  let result: number | null = null;
  let tricks = 0;
  g.on((e) => {
    if (e.type === 'roundEnd') {
      const o = e.result.order;
      const up = [0, 3, 2, 1][o.indexOf(partnerOf(o[0]))];
      result = teamOf(o[0]) === teamOf(st.seat) ? up : -up;
    }
    if (e.type === 'trickEnd') tricks++;
  });
  const err = move ? g.play(st.seat, move.cards, move) : g.pass(st.seat);
  if (err) return NaN;
  let guard = 0;
  while (g.phase === 'play' && tricks < shallowDepth.tricks && guard++ < 40 * shallowDepth.tricks) {
    const s = g.turn;
    const c = policyPlay(policy, g, s, rand);
    const e = c ? g.play(s, c.cards, c) : g.pass(s);
    if (e) { if (g.lastPlay) g.pass(s); else g.play(s, [g.hands[s][0]]); }
  }
  if (result !== null) return result;
  return evalPosition(g.hands, st.level, teamOf(st.seat), g.turn, g.finishOrder);
}

/** 中盘模拟：同一批推测出的牌局上比较各候选（浅层推演 + 局面评分） */
export function monteCarloShallow(st: MCState, moves: (Combo | null)[], budgetMs = 800, maxSamples = 100, seed = 1, policy: RolloutPolicy = 'quick'): MCResult {
  const t0 = Date.now();
  const sums = moves.map(() => 0);
  let n = 0;
  for (let k = 0; k < maxSamples * 3 && n < maxSamples; k++) {
    if (Date.now() - t0 > budgetMs && n >= 8) break;
    const hands = determinize(st, seed + k);
    if (!hands) continue;
    const vals = moves.map((m) => shallowRollout(st, hands, m, policy, rolloutRng(seed + k)));
    if (vals.some((v) => Number.isNaN(v))) continue;
    vals.forEach((v, i) => (sums[i] += v));
    n++;
  }
  return { scores: sums.map((s) => (n ? s / n : 0)), samples: n };
}
