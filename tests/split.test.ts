import { describe, it, expect } from 'vitest';
import { DECK, card, isWild, type Suit } from '../shared/cards';
import { bestSplit } from '../shared/ai';
import { parseCombos } from '../shared/combo';

// 'S3' 黑桃3，'H2' 红桃2（打 2 时是逢人配），同一张牌第二次取第二副
function ids(spec: string): number[] {
  const used = new Set<number>();
  return spec.split(/\s+/).filter(Boolean).map((t) => {
    const suit = t[0] as Suit;
    const rs = t.slice(1);
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[rs] ?? Number(rs);
    const found = DECK.find((c) => c.suit === suit && c.rank === rank && !used.has(c.id));
    if (!found) throw new Error('no card ' + t);
    used.add(found.id);
    return found.id;
  });
}

describe('拆牌中逢人配的用法', () => {
  it('四张单张 + 逢人配连成顺子，优于把三张补成炸弹', () => {
    const hand = ids('S3 C4 D6 S7 H2 SK CK DK S9 C9 SJ');
    const sp = bestSplit(hand, 2);
    const straight = sp.combos.find((c) => c.type === 'straight');
    expect(straight, JSON.stringify(sp.combos.map((c) => c.type))).toBeDefined();
    expect(straight!.cards.some((id) => isWild(id, 2))).toBe(true);
    expect(straight!.cards.map((id) => card(id).rank).filter((r) => r !== 2).sort((a, b) => a - b)).toEqual([3, 4, 6, 7]);
  });

  it('三张单张 + 两张逢人配也能连成顺子', () => {
    const hand = ids('S3 C5 D7 H2 H2 SK CK SA');
    const sp = bestSplit(hand, 2);
    const straight = sp.combos.find((c) => c.type === 'straight');
    expect(straight, JSON.stringify(sp.combos.map((c) => c.type))).toBeDefined();
    expect(straight!.cards.filter((id) => isWild(id, 2)).length).toBe(2);
  });

  it('没有可连的单张时，逢人配补成炸弹', () => {
    const hand = ids('SK CK DK H2 S9 C9 D9 SA');
    const sp = bestSplit(hand, 2);
    expect(sp.combos.some((c) => c.type === 'bomb' && c.cards.some((id) => isWild(id, 2)))).toBe(true);
  });

  it('每一组都是合法牌型，且正好用完手牌', () => {
    const hand = ids('S3 C4 D6 S7 H2 H2 SK CK DK S9 C9 SJ D5 C8 SQ');
    const sp = bestSplit(hand, 2);
    expect(sp.combos.flatMap((c) => c.cards).sort()).toEqual([...hand].sort());
    for (const c of sp.combos) expect(parseCombos(c.cards, 2).some((p) => p.type === c.type), c.type).toBe(true);
  });
});
