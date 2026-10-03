// 牌型识别与比较（含逢人配）。
import { card, cardValue, isJoker, isWild, value, BIG_JOKER, SMALL_JOKER, type Card } from './cards';

export type ComboType =
  | 'single' | 'pair' | 'triple' | 'fullhouse'
  | 'straight' | 'tube' | 'plate'
  | 'bomb' | 'straightflush' | 'jokerbomb';

export interface Combo {
  type: ComboType;
  /** 按展示顺序排列的牌 id（逢人配放在它替代的位置） */
  cards: number[];
  /** 同类型内的比较值：点值组合比点值，连牌比起始位置（A 作 1 时为 1） */
  value: number;
}

export const TYPE_NAMES: Record<ComboType, string> = {
  single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二',
  straight: '顺子', tube: '三连对', plate: '钢板',
  bomb: '炸弹', straightflush: '同花顺', jokerbomb: '天王炸',
};

export function isBomb(c: Combo): boolean {
  return c.type === 'bomb' || c.type === 'straightflush' || c.type === 'jokerbomb';
}

/** 炸弹等级：4炸<5炸<同花顺<6炸<…<10炸<天王炸 */
export function bombLevel(c: Combo): number {
  if (c.type === 'jokerbomb') return 100;
  if (c.type === 'straightflush') return 3;
  if (c.type === 'bomb') return c.cards.length <= 5 ? c.cards.length - 3 : c.cards.length - 2;
  return 0;
}

export function canBeat(a: Combo, b: Combo | null): boolean {
  if (!b) return true;
  const ab = isBomb(a), bb = isBomb(b);
  if (ab !== bb) return ab;
  if (ab) {
    const la = bombLevel(a), lb = bombLevel(b);
    return la !== lb ? la > lb : a.value > b.value;
  }
  return a.type === b.type && a.cards.length === b.cards.length && a.value > b.value;
}

/** 组合强度排序键（大者在前用）。 */
export function strength(c: Combo): number {
  return bombLevel(c) * 1000 + c.value;
}

export function comboName(c: Combo): string {
  if (c.type === 'bomb') return `${c.cards.length}炸`;
  return TYPE_NAMES[c.type];
}

/** 连牌窗口里 rank 对应的位置；不在窗口内返回 -1。start=1 表示 A 作 1。 */
export function chainPos(rank: number, start: number, len: number): number {
  if (isJoker(rank)) return -1;
  const r = rank === 14 && start === 1 ? 1 : rank;
  const p = r - start;
  return p >= 0 && p < len ? p : -1;
}

/** 窗口位置对应的实际 rank（位置 0 且 start=1 时为 A）。 */
export function chainRank(start: number, pos: number): number {
  const r = start + pos;
  return r === 1 ? 14 : r;
}

function fitChain(normals: Card[], wilds: number[], len: number, mult: number): { start: number; order: number[] }[] {
  if (normals.length + wilds.length !== len * mult) return [];
  const out: { start: number; order: number[] }[] = [];
  for (let start = 1; start + len - 1 <= 14; start++) {
    const slots: number[][] = Array.from({ length: len }, () => []);
    let ok = true;
    for (const c of normals) {
      const p = chainPos(c.rank, start, len);
      if (p < 0 || slots[p].length >= mult) { ok = false; break; }
      slots[p].push(c.id);
    }
    if (!ok) continue;
    const w = [...wilds];
    const order: number[] = [];
    for (const s of slots) {
      order.push(...s);
      while (s.length < mult) { s.push(w[0]); order.push(w.shift()!); }
    }
    out.push({ start, order });
  }
  return out;
}

/** 返回一组牌所有可能的解释（每种类型取最大值）。 */
export function parseCombos(ids: number[], level: number): Combo[] {
  const n = ids.length;
  if (n === 0) return [];
  const wilds: number[] = [];
  const normals: Card[] = [];
  for (const id of ids) (isWild(id, level) ? wilds.push(id) : normals.push(card(id)));
  const byRank = new Map<number, number[]>();
  for (const c of normals) {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank)!.push(c.id);
  }
  const res: Combo[] = [];

  if (n === 1) {
    res.push({ type: 'single', cards: [...ids], value: cardValue(ids[0], level) });
    return res;
  }

  // 同点数：对子、三张、炸弹
  if (byRank.size <= 1) {
    const r = normals.length ? normals[0].rank : undefined;
    const joker = r !== undefined && isJoker(r);
    const v = r === undefined ? 15 : value(r, level);
    const order = [...normals.map((c) => c.id), ...wilds];
    if (joker) {
      if (n === 2 && wilds.length === 0) res.push({ type: 'pair', cards: order, value: v });
    } else if (n === 2) res.push({ type: 'pair', cards: order, value: v });
    else if (n === 3) res.push({ type: 'triple', cards: order, value: v });
    else if (n >= 4) res.push({ type: 'bomb', cards: order, value: v });
  }

  // 天王炸
  if (n === 4 && wilds.length === 0 &&
      normals.filter((c) => c.rank === SMALL_JOKER).length === 2 &&
      normals.filter((c) => c.rank === BIG_JOKER).length === 2) {
    res.push({ type: 'jokerbomb', cards: [...ids], value: 0 });
  }

  // 三带二
  if (n === 5) {
    let best: Combo | null = null;
    const pairRanks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, SMALL_JOKER, BIG_JOKER];
    for (let t = 2; t <= 14; t++) {
      for (const p of pairRanks) {
        if (p === t) continue;
        const ct = byRank.get(t)?.length ?? 0;
        const cp = byRank.get(p)?.length ?? 0;
        if (ct + cp !== normals.length || ct > 3 || cp > 2) continue;
        if (isJoker(p) && cp !== 2) continue;
        if ((3 - ct) + (2 - cp) !== wilds.length) continue;
        const v = value(t, level);
        if (best && best.value >= v) continue;
        const w = [...wilds];
        const tri = [...(byRank.get(t) ?? [])];
        while (tri.length < 3) tri.push(w.shift()!);
        const pr = [...(byRank.get(p) ?? [])];
        while (pr.length < 2) pr.push(w.shift()!);
        best = { type: 'fullhouse', cards: [...tri, ...pr], value: v };
      }
    }
    if (best) res.push(best);
  }

  // 连牌
  const chains: [ComboType, number, number][] = [['straight', 5, 1], ['tube', 3, 2], ['plate', 2, 3]];
  for (const [type, len, mult] of chains) {
    const fits = fitChain(normals, wilds, len, mult);
    if (!fits.length) continue;
    const top = fits[fits.length - 1];
    res.push({ type, cards: top.order, value: top.start });
    if (type === 'straight') {
      const suits = new Set(normals.map((c) => c.suit));
      if (suits.size <= 1) res.push({ type: 'straightflush', cards: top.order, value: top.start });
    }
  }
  return res;
}

/** 选出能压过 target 的解释，强者在前。 */
export function playableInterpretations(ids: number[], level: number, target: Combo | null): Combo[] {
  return parseCombos(ids, level)
    .filter((c) => canBeat(c, target))
    .sort((a, b) => strength(b) - strength(a));
}

/**
 * 需要让玩家选择解释时返回多个；否则返回最佳的一个。
 * 同花顺优先于顺子；不同类型且都可出时交给玩家选择。
 */
export function resolvePlay(ids: number[], level: number, target: Combo | null): Combo[] {
  let opts = playableInterpretations(ids, level, target);
  if (opts.some((c) => c.type === 'straightflush')) opts = opts.filter((c) => c.type !== 'straight');
  return opts;
}
