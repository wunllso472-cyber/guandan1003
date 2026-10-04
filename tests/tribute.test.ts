import { describe, it, expect } from 'vitest';
import { DECK, card, type Suit } from '../shared/cards';
import { smartTribute, smartReturn, suitNeighbors } from '../shared/tribute';

function ids(spec: string, used = new Set<number>()): number[] {
  return spec.split(/\s+/).filter(Boolean).map((t) => {
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(1)] ?? Number(t.slice(1));
    const f = DECK.find((c) => c.suit === (t[0] as Suit) && c.rank === rank && !used.has(c.id));
    if (!f) throw new Error('no card ' + t);
    used.add(f.id);
    return f.id;
  });
}
const suitOf = (id: number) => card(id).suit;

describe('贡牌与还贡（教材 R01、R02）', () => {
  it('同花相邻牌计数：A 也能接 2-5', () => {
    const hand = ids('SA S2 S3 S9 HA');
    expect(suitNeighbors(hand, hand[0], 7)).toBe(2); // ♠2 ♠3 与 ♠A 相邻，♠9 不相邻
  });

  it('并列最大牌：贡给敌方选本家同花相邻牌多的花色，贡给搭档相反', () => {
    // 打 7：没有王和级牌，最大是两张 A
    const hand = ids('SA HA SK SQ C3 D4 C5 D8 C9 DJ');
    expect(suitOf(smartTribute(hand, 7, false))).toBe('S');
    expect(suitOf(smartTribute(hand, 7, true))).toBe('H');
  });

  it('不拆自己的同花顺：即使贡给敌方也不贡同花顺里的那张', () => {
    const hand = ids('SA SK SQ SJ S10 HA C3 D4 C6 D8');
    expect(suitOf(smartTribute(hand, 7, false))).toBe('H');
  });

  it('只有一张最大牌时照常进贡', () => {
    const hand = ids('SA SK HQ C3');
    expect(card(smartTribute(hand, 7)).rank).toBe(14);
  });

  it('还贡只还 10 及以下的牌', () => {
    const hand = ids('SA SK HQ C3 D4 C9 D9 S9 H5 C6');
    for (const toPartner of [false, true]) expect(card(smartReturn(hand, 7, toPartner)).rank).toBeLessThanOrEqual(10);
  });
});
