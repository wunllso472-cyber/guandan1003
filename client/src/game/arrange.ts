// 手牌分列：每列一组牌，列内从上到下排列。左边是大牌。
import { card, cardValue, sortByValueDesc } from '@shared/cards';
import { bestSplit } from '@shared/ai';
import { isBomb, bombLevel } from '@shared/combo';

export type ArrangeMode = 'rank' | 'smart';

/** 按点数分列：同点数一列，大的在左。 */
export function arrangeByRank(hand: number[], level: number): number[][] {
  const sorted = sortByValueDesc(hand, level);
  const cols: number[][] = [];
  let lastV = -1;
  for (const id of sorted) {
    const v = cardValue(id, level);
    if (v !== lastV || card(id).rank !== card(cols[cols.length - 1][0]).rank) {
      cols.push([]);
      lastV = v;
    }
    cols[cols.length - 1].push(id);
  }
  return cols;
}

/** 一键理牌：炸弹、同花顺、连牌各成一列放左边，其余按点数。 */
export function arrangeSmart(hand: number[], level: number): number[][] {
  const split = bestSplit(hand, level);
  const bombs = split.combos.filter(isBomb).sort((a, b) => bombLevel(b) - bombLevel(a) || b.value - a.value);
  const chains = split.combos
    .filter((c) => c.type === 'straight' || c.type === 'tube' || c.type === 'plate')
    .sort((a, b) => b.value - a.value);
  const used = new Set([...bombs, ...chains].flatMap((c) => c.cards));
  const rest = hand.filter((id) => !used.has(id));
  return [
    ...bombs.map((c) => [...c.cards]),
    ...chains.map((c) => [...c.cards].reverse()),
    ...arrangeByRank(rest, level),
  ];
}

/** 把选中的牌单独成一列放到最左边。 */
export function groupSelected(cols: number[][], selected: number[], level: number): number[][] {
  const sel = new Set(selected);
  const rest = cols.map((c) => c.filter((id) => !sel.has(id))).filter((c) => c.length);
  return [sortByValueDesc(selected, level), ...rest];
}

/** 出牌后去掉的牌。 */
export function removeCards(cols: number[][], ids: number[]): number[][] {
  const s = new Set(ids);
  return cols.map((c) => c.filter((id) => !s.has(id))).filter((c) => c.length);
}

/** 新收到的牌插入到同点数的列；没有则按点数插入新列。 */
export function insertCards(cols: number[][], ids: number[], level: number): number[][] {
  const out = cols.map((c) => [...c]);
  for (const id of ids) {
    const r = card(id).rank;
    const col = out.find((c) => c.every((x) => card(x).rank === r));
    if (col) { col.push(id); continue; }
    const v = cardValue(id, level);
    let at = out.findIndex((c) => c.length && c.every((x) => card(x).rank === card(c[0]).rank) && cardValue(c[0], level) < v);
    if (at < 0) at = out.length;
    out.splice(at, 0, [id]);
  }
  return out;
}
