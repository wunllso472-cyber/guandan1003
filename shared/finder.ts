// 从手牌中枚举可出的牌组（每种类型/点数取一个代表），用于提示和 AI。
import { card, isWild, value, isJoker, SMALL_JOKER, BIG_JOKER, SUITS } from './cards';
import { canBeat, chainRank, isBomb, bombLevel, type Combo, type ComboType } from './combo';

export class HandIndex {
  /** 非逢人配牌按 rank 分组（王也在内） */
  byRank = new Map<number, number[]>();
  wilds: number[] = [];

  constructor(public hand: number[], public level: number) {
    for (const id of hand) {
      if (isWild(id, level)) { this.wilds.push(id); continue; }
      const r = card(id).rank;
      if (!this.byRank.has(r)) this.byRank.set(r, []);
      this.byRank.get(r)!.push(id);
    }
  }

  count(rank: number): number {
    return this.byRank.get(rank)?.length ?? 0;
  }

  /** 取 rank 的 k 张（不够用逢人配补）；不可能时返回 null。 */
  take(rank: number, k: number, usedWilds: number[]): number[] | null {
    const have = this.byRank.get(rank) ?? [];
    const out = have.slice(0, k);
    if (out.length < k) {
      if (isJoker(rank)) return null;
      const free = this.wilds.filter((w) => !usedWilds.includes(w));
      if (free.length < k - out.length) return null;
      const add = free.slice(0, k - out.length);
      usedWilds.push(...add);
      out.push(...add);
    }
    return out;
  }
}

const BOMB_TYPES = new Set<ComboType>(['bomb', 'straightflush', 'jokerbomb']);
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function findAllPlays(hand: number[], level: number, target: Combo | null = null): Combo[] {
  const h = new HandIndex(hand, level);
  const out: Combo[] = [];
  const push = (type: ComboType, cards: number[] | null, v: number) => {
    if (!cards) return;
    const c: Combo = { type, cards, value: v };
    if (canBeat(c, target)) out.push(c);
  };
  const want = (t: ComboType) =>
    !target || BOMB_TYPES.has(t) || (!isBomb(target) && t === target.type);
  const allRanks = [...RANKS, SMALL_JOKER, BIG_JOKER];

  // 单张
  if (want('single')) {
    for (const r of allRanks) if (h.count(r)) push('single', [h.byRank.get(r)![0]], value(r, level));
    if (h.wilds.length && !h.count(level)) push('single', [h.wilds[0]], 15);
  }
  // 对子、三张
  for (const [t, k] of [['pair', 2], ['triple', 3]] as [ComboType, number][]) {
    if (!want(t)) continue;
    for (const r of allRanks) {
      if (!h.count(r)) continue;
      push(t, h.take(r, k, []), value(r, level));
    }
    if (t === 'pair' && h.wilds.length === 2 && !h.count(level)) push('pair', [...h.wilds], 15);
  }
  // 三带二：每个三张配一个最合适的对子
  if (want('fullhouse')) {
    for (const t of RANKS) {
      if (!h.count(t)) continue;
      const used: number[] = [];
      const tri = h.take(t, 3, used);
      if (!tri) continue;
      let best: number[] | null = null;
      let bestCost = Infinity;
      for (const p of allRanks) {
        if (p === t || !h.count(p)) continue;
        const u2 = [...used];
        const pr = h.take(p, 2, u2);
        if (!pr) continue;
        // 优先：正好一对、不用配、点小
        const cost = (u2.length - used.length) * 100 + (h.count(p) === 2 ? 0 : h.count(p) === 3 ? 30 : 60) + value(p, level);
        if (cost < bestCost) { bestCost = cost; best = [...tri, ...pr]; }
      }
      push('fullhouse', best, value(t, level));
    }
  }
  // 连牌
  const chains: [ComboType, number, number][] = [['straight', 5, 1], ['tube', 3, 2], ['plate', 2, 3]];
  for (const [type, len, mult] of chains) {
    if (!want(type)) continue;
    for (let start = 1; start + len - 1 <= 14; start++) {
      const used: number[] = [];
      const cards: number[] = [];
      let ok = true;
      for (let p = 0; p < len && ok; p++) {
        const got = h.take(chainRank(start, p), mult, used);
        if (!got) ok = false; else cards.push(...got);
      }
      if (ok) push(type, cards, start);
    }
  }
  // 炸弹
  for (const r of RANKS) {
    const c = h.count(r);
    if (c === 0) continue;
    for (let size = 4; size <= c + h.wilds.length; size++) {
      push('bomb', h.take(r, size, []), value(r, level));
    }
  }
  // 同花顺
  for (const suit of SUITS) {
    for (let start = 1; start + 4 <= 14; start++) {
      const used: number[] = [];
      const cards: number[] = [];
      let ok = true;
      for (let p = 0; p < 5 && ok; p++) {
        const r = chainRank(start, p);
        const id = (h.byRank.get(r) ?? []).find((x) => card(x).suit === suit);
        if (id !== undefined) { cards.push(id); continue; }
        const w = h.wilds.find((x) => !used.includes(x));
        if (w === undefined) ok = false; else { used.push(w); cards.push(w); }
      }
      if (ok) push('straightflush', cards, start);
    }
  }
  // 天王炸
  if (h.count(SMALL_JOKER) === 2 && h.count(BIG_JOKER) === 2) {
    push('jokerbomb', [...h.byRank.get(SMALL_JOKER)!, ...h.byRank.get(BIG_JOKER)!], 0);
  }
  return dedupe(out);
}

function dedupe(list: Combo[]): Combo[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = [...c.cards].sort((a, b) => a - b).join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 出牌开销：普通牌型在前，炸弹在后，同类按点数。 */
export function playOrderKey(c: Combo): number {
  return isBomb(c) ? 10000 + bombLevel(c) * 100 + c.value : c.value * 10 + c.cards.length;
}
