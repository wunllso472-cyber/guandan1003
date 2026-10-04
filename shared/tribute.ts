// 贡牌与还贡（教材规则库 R01、R02）：
// R01 贡牌并列时考虑花色——必须贡最大的牌，几张一样大时：先保住自己的组合（同花顺等），
//     贡给敌方时选本家同花相邻牌占得多的那张，降低对方补同花顺的机会；贡给搭档时相反。
// R02 回贡同时保护自己与限制敌方——先比较自家拆牌代价；回给敌方时，优先回本家同点数持有较多
//     （外面剩得少、对方难凑炸弹）且同花相邻牌占得多的牌；回给搭档时只看自家代价。
// 两副牌每张牌都有两张，本家持有相邻牌并不能完全阻止对方，这些只是小分量的倾向，不能推断对方确切缺牌。
import { card, cardValue, isWild } from './cards';
import { bestSplit } from './ai';
import { isBomb } from './combo';

const without = (hand: number[], id: number) => {
  const i = hand.indexOf(id);
  return i < 0 ? hand : [...hand.slice(0, i), ...hand.slice(i + 1)];
};

/**
 * 交出这张牌后剩下的牌有多难出：拆牌代价（bestSplit 评分）+ 每少一个炸弹（含同花顺）记 1.5。
 * bestSplit 的评分把同花顺和普通顺子看成一样，单独补上炸弹的价值。
 */
function giveCost(hand: number[], id: number, level: number, bombsBefore: number): number {
  const sp = bestSplit(without(hand, id), level);
  return sp.score + 1.5 * Math.max(0, bombsBefore - sp.combos.filter(isBomb).length);
}

const bombCount = (hand: number[], level: number) => bestSplit(hand, level).combos.filter(isBomb).length;

/** 本家同花色、点数相差 4 以内的牌（同花顺可能用到的相邻牌）张数；A 也可以当 1 */
export function suitNeighbors(hand: number[], id: number, level: number): number {
  const c = card(id);
  if (c.rank > 14) return 0;
  const pos = (r: number) => (r === 14 ? [14, 1] : [r]);
  return hand.filter((h) => {
    const x = card(h);
    if (h === id || isWild(h, level) || x.suit !== c.suit || x.rank === c.rank || x.rank > 14) return false;
    return pos(c.rank).some((a) => pos(x.rank).some((b) => Math.abs(a - b) <= 4));
  }).length;
}

/** 进贡：最大的牌（不含逢人配）；几张一样大时按 R01 选 */
export function smartTribute(hand: number[], level: number, toPartner = false): number {
  let bv = -1;
  for (const id of hand) if (!isWild(id, level)) bv = Math.max(bv, cardValue(id, level));
  const ties = hand.filter((id) => !isWild(id, level) && cardValue(id, level) === bv);
  if (ties.length <= 1) return ties[0] ?? hand[0];
  let best = ties[0], bs = Infinity;
  const seen = new Set<string>();
  const bombs = bombCount(hand, level);
  for (const id of ties) {
    const k = card(id).suit;
    if (seen.has(k)) continue; // 同花色同点数的两张完全等价
    seen.add(k);
    const nb = suitNeighbors(hand, id, level);
    const cost = giveCost(hand, id, level, bombs) + (toPartner ? 0.1 : -0.1) * nb;
    if (cost < bs) { bs = cost; best = id; }
  }
  return best;
}

/** 还贡：10 及以下的牌（没有时任意牌），按 R02 选 */
export function smartReturn(hand: number[], level: number, toPartner = false): number {
  let cands = hand.filter((id) => card(id).rank <= 10 && card(id).rank !== level);
  if (!cands.length) cands = hand.filter((id) => card(id).rank <= 10);
  if (!cands.length) return [...hand].sort((a, b) => cardValue(a, level) - cardValue(b, level))[0];
  const count = new Map<number, number>();
  for (const id of hand) if (!isWild(id, level)) count.set(card(id).rank, (count.get(card(id).rank) ?? 0) + 1);
  let best = cands[0], bs = Infinity;
  const seen = new Set<string>();
  const bombs = bombCount(hand, level);
  for (const id of cands) {
    const c = card(id);
    const k = `${c.rank}${c.suit}`;
    if (seen.has(k)) continue;
    seen.add(k);
    let cost = giveCost(hand, id, level, bombs) + cardValue(id, level) * 0.02;
    if (!toPartner && !isWild(id, level)) {
      // 回给敌方：同点数本家还剩得多 → 外面剩得少，对方难凑炸弹；同花相邻牌本家占得多 → 难补同花顺
      cost -= 0.08 * ((count.get(c.rank) ?? 1) - 1) + 0.04 * suitNeighbors(hand, id, level);
    }
    if (cost < bs) { bs = cost; best = id; }
  }
  return best;
}
