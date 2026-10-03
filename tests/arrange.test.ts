import { describe, it, expect } from 'vitest';
import { DECK, card, cardValue, isWild, type Suit } from '../shared/cards';
import { parseCombos, bombLevel, isBomb, resolvePlay } from '../shared/combo';
import { GuandanGame } from '../shared/game';
import { arrangeSmart } from '../client/src/game/arrange';
import { autoPickFor } from '../client/src/game/autopick';

function ids(spec: string): number[] {
  const used = new Set<number>();
  return spec.split(/\s+/).filter(Boolean).map((t) => {
    let pred: (c: (typeof DECK)[number]) => boolean;
    if (t === 'SJ') pred = (c) => c.rank === 16;
    else if (t === 'BJ') pred = (c) => c.rank === 17;
    else {
      const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(1)] ?? Number(t.slice(1));
      pred = (c) => c.suit === (t[0] as Suit) && c.rank === rank;
    }
    const f = DECK.find((c) => pred(c) && !used.has(c.id));
    if (!f) throw new Error('no card ' + t);
    used.add(f.id);
    return f.id;
  });
}

/** 一列解释成哪种牌型（取最强的解释） */
const colCombo = (col: number[], level: number) => resolvePlay(col, level, null)[0];

const ORDER = ['plate', 'tube', 'straight', 'fullhouse', 'triple', 'pair', 'single'];

describe('一键理牌排列', () => {
  it('随机手牌：每列都是合法牌型、正好用完手牌、炸弹在左且越大越左、其余按类型排列', () => {
    for (let i = 0; i < 400; i++) {
      const g = new GuandanGame();
      g.levels = [2 + (i % 13), 2];
      g.startRound(700 + i);
      const level = g.level;
      const hand = g.hands[i % 4];
      const cols = arrangeSmart(hand, level);
      expect(cols.flat().sort()).toEqual([...hand].sort());
      const combos = cols.map((c) => {
        const cb = colCombo(c, level);
        expect(cb, `第 ${i} 手：${c.map((x) => card(x).rank)}`).toBeDefined();
        return cb;
      });
      // 炸弹全部在最左边，并按炸弹大小从大到小
      const firstNon = combos.findIndex((c) => !isBomb(c));
      const bombs = firstNon < 0 ? combos : combos.slice(0, firstNon);
      expect(combos.slice(bombs.length).every((c) => !isBomb(c))).toBe(true);
      for (let k = 1; k < bombs.length; k++) {
        const a = bombs[k - 1], b = bombs[k];
        expect(bombLevel(a) > bombLevel(b) || (bombLevel(a) === bombLevel(b) && a.value >= b.value)).toBe(true);
      }
      // 炸弹之后：连牌 → 三带二 → 三张 → 对子 → 单张
      const rest = combos.slice(bombs.length);
      const typeIdx = rest.map((c) => (['plate', 'tube', 'straight'].includes(c.type) ? 0 : ORDER.indexOf(c.type)));
      for (let k = 1; k < typeIdx.length; k++) expect(typeIdx[k]).toBeGreaterThanOrEqual(typeIdx[k - 1]);
      // 同类（非连牌）大的在左
      for (let k = 1; k < rest.length; k++) {
        if (rest[k].type === rest[k - 1].type && typeIdx[k] > 0) expect(rest[k - 1].value).toBeGreaterThanOrEqual(rest[k].value);
      }
    }
  });

  it('天王炸最左，大炸在小炸左边', () => {
    const hand = ids('SJ SJ BJ BJ S5 C5 D5 H5 S5 S9 C9 D9 H9 S3');
    const cols = arrangeSmart(hand, 2);
    expect(colCombo(cols[0], 2).type).toBe('jokerbomb');
    expect(cols[1].map((x) => card(x).rank).every((r) => r === 5)).toBe(true); // 5 张的炸弹比 4 张的大
    expect(cols[2].map((x) => card(x).rank).every((r) => r === 9)).toBe(true);
  });

  it('列内从上到下由小到大；三带二三张在上、对子在下；逢人配在顺子里补位', () => {
    const hand = ids('S3 C4 H2 D6 S7 SK CK DK S8 C8');
    const cols = arrangeSmart(hand, 2);
    const straight = cols.find((c) => colCombo(c, 2).type === 'straight')!;
    expect(straight.map((x) => (isWild(x, 2) ? 5 : card(x).rank))).toEqual([3, 4, 5, 6, 7]);
    const fh = cols.find((c) => colCombo(c, 2).type === 'fullhouse')!;
    expect(fh.map((x) => card(x).rank)).toEqual([13, 13, 13, 8, 8]);
  });
});

describe('跟牌智能选牌', () => {
  it('上家出对 8，点一张 J 选中一对 J（包含被点的那张）', () => {
    const hand = ids('SJ CJ DJ S5 C5 S9');
    const target = parseCombos(ids('D8 H8'), 2)[0];
    const tapped = hand[2]; // 方块 J
    const pick = autoPickFor(tapped, hand, 2, target)!;
    expect(pick).toContain(tapped);
    expect(pick.map((x) => card(x).rank)).toEqual([11, 11]);
  });

  it('压不过时不自动选；不会自动用逢人配，也不拆炸弹', () => {
    const hand = ids('S5 C6 H2 S9 C9 D9 H9');
    const target = parseCombos(ids('D8 H8'), 2)[0];
    expect(autoPickFor(hand[0], hand, 2, target)).toBeNull(); // 5 只有一张，不用配凑对
    expect(autoPickFor(hand[3], hand, 2, target)).toBeNull();  // 9 有四张：选一对会拆掉炸弹，不自动选
  });

  it('不会为了凑顺子拆掉炸弹', () => {
    const hand = ids('SA CA DA HA SQ CQ DQ HQ CJ D10 CK S8');
    const target = parseCombos(ids('H4 D5 C6 S7 C8'), 2)[0];
    const j = hand[8];
    expect(autoPickFor(j, hand, 2, target)).toBeNull();
  });

  it('上家出单张时点一张牌只选这一张', () => {
    const hand = ids('CJ DJ S5');
    const target = parseCombos(ids('D8'), 2)[0];
    const pick = autoPickFor(hand[0], hand, 2, target);
    expect(pick === null || pick.length === 1).toBe(true);
    expect(cardValue(hand[0], 2)).toBe(11);
  });
});
