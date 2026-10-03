// 跟牌时的智能选牌：点一张牌，选出包含它、刚好能压过上家的最小一组。
import { card, isWild } from '@shared/cards';
import { isBomb, type Combo } from '@shared/combo';
import { findAllPlays } from '@shared/finder';

/** 返回要选中的牌；找不到合适的组合（只能用炸弹或要拆炸弹）时返回 null */
export function autoPickFor(id: number, hand: number[], level: number, target: Combo): number[] | null {
  if (!hand.includes(id)) return null;
  const tappedWild = isWild(id, level);
  const rank = card(id).rank;
  // 手里每个点数的张数（不含逢人配），用来判断会不会拆炸弹
  const have = new Map<number, number>();
  for (const x of hand) if (!isWild(x, level)) have.set(card(x).rank, (have.get(card(x).rank) ?? 0) + 1);
  const breaksBomb = (cards: number[]) => {
    const take = new Map<number, number>();
    for (const x of cards) if (!isWild(x, level)) take.set(card(x).rank, (take.get(card(x).rank) ?? 0) + 1);
    for (const [r, n] of take) {
      const h = have.get(r) ?? 0;
      if (h >= 4 && h - n < 4) return true;
    }
    return false;
  };
  const options: { cards: number[]; combo: Combo; wilds: number }[] = [];
  for (const c of findAllPlays(hand, level, target)) {
    if (isBomb(c)) continue; // 不自动拆出炸弹
    let cards = c.cards;
    if (!cards.includes(id)) {
      // 枚举结果只给每个点数一个代表；把同点数的一张换成被点的牌
      if (tappedWild) continue;
      const j = cards.findIndex((x) => !isWild(x, level) && card(x).rank === rank);
      if (j < 0) continue;
      cards = [...cards];
      cards[j] = id;
    }
    const wilds = cards.filter((x) => isWild(x, level)).length;
    // 除非点的就是逢人配，否则不自动动用逢人配；也不自动拆炸弹
    if (wilds > 0 && !tappedWild) continue;
    if (breaksBomb(cards)) continue;
    options.push({ cards, combo: c, wilds });
  }
  if (!options.length) return null;
  options.sort((a, b) => a.combo.value - b.combo.value || a.wilds - b.wilds || a.cards.length - b.cards.length);
  return options[0].cards;
}
