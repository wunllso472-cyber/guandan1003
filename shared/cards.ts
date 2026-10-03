// 牌的基础定义：两副牌共 108 张，id 0..107。
// rank: 2..14 (A=14)，小王 16，大王 17。

export type Suit = 'S' | 'H' | 'C' | 'D' | 'J';

export interface Card {
  id: number;
  suit: Suit;
  rank: number;
}

export const SMALL_JOKER = 16;
export const BIG_JOKER = 17;
export const SUITS: Suit[] = ['S', 'H', 'C', 'D'];

function makeDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) cards.push({ id: id++, suit, rank });
    }
    cards.push({ id: id++, suit: 'J', rank: SMALL_JOKER });
    cards.push({ id: id++, suit: 'J', rank: BIG_JOKER });
  }
  return cards;
}

export const DECK: readonly Card[] = makeDeck();
export const ALL_IDS: readonly number[] = DECK.map((c) => c.id);

export function card(id: number): Card {
  return DECK[id];
}

export function isJoker(rank: number): boolean {
  return rank >= SMALL_JOKER;
}

/** 比较大小用的点值：级牌高于 A，低于王。 */
export function value(rank: number, level: number): number {
  return rank === level ? 15 : rank;
}

export function cardValue(id: number, level: number): number {
  return value(DECK[id].rank, level);
}

/** 逢人配：红桃级牌。 */
export function isWild(id: number, level: number): boolean {
  const c = DECK[id];
  return c.suit === 'H' && c.rank === level;
}

export function rankName(rank: number): string {
  switch (rank) {
    case 11: return 'J';
    case 12: return 'Q';
    case 13: return 'K';
    case 14: case 1: return 'A';
    case SMALL_JOKER: return '小王';
    case BIG_JOKER: return '大王';
    default: return String(rank);
  }
}

/** 按点值从大到小、同点按花色排序。 */
export function sortByValueDesc(ids: number[], level: number): number[] {
  const suitOrder: Record<Suit, number> = { J: 0, S: 1, H: 2, C: 3, D: 4 };
  return [...ids].sort((a, b) => {
    const dv = cardValue(b, level) - cardValue(a, level);
    if (dv) return dv;
    const ds = suitOrder[DECK[a].suit] - suitOrder[DECK[b].suit];
    return ds || a - b;
  });
}

/** 可复现的洗牌（mulberry32）。 */
export function shuffle<T>(arr: T[], seed?: number): T[] {
  const a = [...arr];
  let s = seed ?? Math.floor(Math.random() * 2 ** 32);
  const rand = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
