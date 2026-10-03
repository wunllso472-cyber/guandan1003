// 手牌分列：每列一组牌，列内从上到下排列（index 0 在最上面）。左边是大牌。
import { card, cardValue, isWild, sortByValueDesc } from '@shared/cards';
import { bestSplit } from '@shared/ai';
import { isBomb, bombLevel, parseCombos, type Combo } from '@shared/combo';

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

/** 炸弹之后各类牌的先后：连牌 → 三带二 → 三张 → 对子 → 单张 */
const TYPE_ORDER: Record<string, number> = {
  plate: 0, tube: 1, straight: 2, fullhouse: 3, triple: 4, pair: 5, single: 6,
};

/** 连牌的最大一张（用于比大小） */
function chainTop(c: Combo): number {
  const len = c.type === 'straight' ? 5 : c.type === 'tube' ? 3 : 2;
  return c.value + len - 1;
}

/** 一列内的顺序：从上到下由小到大，最下面完整露出的是这一列最大的牌 */
function columnOrder(c: Combo, level: number): number[] {
  switch (c.type) {
    case 'straight': case 'tube': case 'plate': case 'straightflush':
      return [...c.cards]; // 拆牌结果已按连牌位置从小到大排列，逢人配在它替代的位置
    case 'fullhouse': {
      // 三张在上、对子在下；用规则引擎重新识别，得到逢人配的正确位置
      const fh = parseCombos(c.cards, level).find((x) => x.type === 'fullhouse');
      return fh ? [...fh.cards] : [...c.cards];
    }
    default: {
      // 同点数的组：逢人配放最上面，露出的是本点数的牌
      const wild = c.cards.filter((id) => isWild(id, level));
      const nat = sortByValueDesc(c.cards.filter((id) => !isWild(id, level)), level).reverse();
      return [...wild, ...nat];
    }
  }
}

/**
 * 一键理牌：每列都是一手能出的牌。
 * 炸弹在最左（天王炸 > 大炸 > 同花顺 > 小炸，越大越左），之后依次是连牌、三带二、三张、对子、单张，同类大的在左。
 */
export function arrangeSmart(hand: number[], level: number): number[][] {
  // 用规则引擎重新识别每组的大小（逢人配可能有多种解释，出牌时按最大的算）
  const combos = bestSplit(hand, level).combos.map((c) => parseCombos(c.cards, level).find((x) => x.type === c.type) ?? c);
  const bombs = combos.filter(isBomb).sort((a, b) => bombLevel(b) - bombLevel(a) || b.value - a.value);
  const rest = combos.filter((c) => !isBomb(c)).sort((a, b) => {
    const ta = TYPE_ORDER[a.type], tb = TYPE_ORDER[b.type];
    const chain = (t: number) => t <= 2;
    if (chain(ta) && chain(tb)) return chainTop(b) - chainTop(a) || ta - tb;
    return ta - tb || b.value - a.value;
  });
  return [...bombs, ...rest].map((c) => columnOrder(c, level));
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
