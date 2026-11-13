// 记牌训练：记牌器各格的数、快问的答案和选项、段位升级
import { describe, it, expect } from 'vitest';
import { DECK, type Suit } from '../shared/cards';
import { parseCombos, type Combo } from '../shared/combo';
import { CardTracker } from '../shared/tracker';
import {
  bombsPlayed, lastVoid, makeQuestion, newProgress, panelCells, progressText, quizDue, record, voidLine,
  MAX_TIER, PROMOTE_NEED,
} from '../shared/training';

function ids(spec: string, used: Set<number>): number[] {
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

/** 打 level 的局面：我坐 0 号位，下家 1、对家 2、上家 3 */
function setup(level: number) {
  const tr = new CardTracker(0);
  tr.apply({ type: 'roundStart', level, levelTeam: 0, hands: [[], [], [], []], levels: [level, level], roundNo: 2 });
  return tr;
}
const combo = (cards: number[], level: number): Combo => parseCombos(cards, level)[0];
const play = (tr: CardTracker, seat: number, c: Combo, left = 20) => tr.apply({ type: 'play', seat, combo: c, left });
/** 固定的“随机数”：依次返回给定的值，用完后一直返回最后一个 */
const seq = (...xs: number[]) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };

describe('记牌器', () => {
  it('外面还剩 = 总数 − 手里 − 已出；级牌含逢人配，级牌点数不再单独出现', () => {
    const used = new Set<number>();
    const hand = ids('BJ S8 H8 SA', used); // 打 8：手里大王 1、级牌 2（含 1 张逢人配）、A 1
    const tr = setup(8);
    play(tr, 1, combo(ids('SJ', used), 8));
    play(tr, 2, combo(ids('C8 D8', used), 8));
    const cells = panelCells({ tracker: tr, hand, level: 8 }, 2);
    const get = (l: string) => cells.find((c) => c.label === l)!;
    expect(get('大王')).toMatchObject({ left: 1, tier: 1, hidden: true });
    expect(get('小王')).toMatchObject({ left: 1, tier: 1, hidden: true });
    expect(get('级8')).toMatchObject({ left: 4, tier: 2, hidden: true });
    expect(get('配')).toMatchObject({ left: 1, tier: 2, hidden: true });
    expect(get('A')).toMatchObject({ left: 7, tier: 3, hidden: false });
    expect(cells.filter((c) => c.label === '8')).toHaveLength(0);
  });

  it('打 A 时 A 归到级牌那一段，第 3 段只有 K', () => {
    const cells = panelCells({ tracker: setup(14), hand: [], level: 14 }, 1);
    expect(cells.filter((c) => c.tier === 3).map((c) => c.label)).toEqual(['K']);
    expect(cells.find((c) => c.tier === 2)?.label).toBe('级A');
  });

  it('炸弹按座位统计；空门只算面对对手的不出', () => {
    const used = new Set<number>();
    const tr = setup(2);
    play(tr, 1, combo(ids('S9 H9 C9 D9', used), 2));
    play(tr, 3, combo(ids('S5', used), 2));
    tr.apply({ type: 'pass', seat: 1 }); // 下家面对搭档（上家）不出：是让牌，不算
    tr.apply({ type: 'trickEnd', leader: 3, jiefeng: false });
    play(tr, 0, combo(ids('S6 H6', used), 2));
    tr.apply({ type: 'pass', seat: 1 }); // 下家面对我的对子不出
    expect(bombsPlayed(tr)).toEqual({ total: 1, bySeat: [0, 1, 0, 0] });
    expect(lastVoid(tr, 1)).toEqual({ type: 'pair', from: 0 });
    expect(lastVoid(tr, 3)).toBeNull();
    expect(voidLine(tr, 0)).toBe('上家没要：—　下家没要：对子');
  });
});

describe('快问', () => {
  it('数量题的答案在选项里，选项是相邻的数且不超出范围', () => {
    const used = new Set<number>();
    const hand = ids('SA HA', used);
    const tr = setup(2);
    play(tr, 1, combo(ids('CA', used), 2));
    for (const r of [0, 0.5, 0.99]) {
      // 第一个随机数决定不复习；之后选题、选项窗口
      const q = makeQuestion({ tracker: tr, hand, level: 2 }, 0, 3, seq(0.9, 0, r))!;
      expect(q.tier).toBe(3);
      expect(q.text).toContain('A');
      expect(q.options[q.answer]).toBe('5');
      const nums = q.options.map(Number);
      expect(nums).toEqual([nums[0], nums[0] + 1, nums[0] + 2, nums[0] + 3]);
      expect(nums[0]).toBeGreaterThanOrEqual(0);
      expect(nums[3]).toBeLessThanOrEqual(8);
      expect(q.explain).toBe('共 8 − 手里 2 − 已出 1 = 外面 5 张');
    }
  });

  it('王只有 0、1、2 三个选项', () => {
    const q = makeQuestion({ tracker: setup(2), hand: [], level: 2 }, 0, 1, seq(0))!;
    expect(q.options).toEqual(['0', '1', '2']);
    expect(q.answer).toBe(2);
  });

  it('三成复习更低段位；空门没有可出的题时换别的段', () => {
    const inp = { tracker: setup(2), hand: [], level: 2 };
    expect(makeQuestion(inp, 0, 3, seq(0.1, 0))!.tier).toBe(1);
    // 段位 6 但没人不出过：不复习时换成段位 5 的题
    expect(makeQuestion(inp, 0, 6, seq(0.9, 0))!.tier).toBe(5);
  });

  it('空门题的答案是该家最近一次面对对手不出时的牌型', () => {
    const used = new Set<number>();
    const tr = setup(2);
    play(tr, 0, combo(ids('S7 S8 S9 S10 HJ', used), 2));
    tr.apply({ type: 'pass', seat: 1 });
    const q = makeQuestion({ tracker: tr, hand: [], level: 2 }, 0, 6, seq(0.9, 0))!;
    expect(q.tier).toBe(6);
    expect(q.text).toContain('下家');
    expect(q.options).toHaveLength(4);
    expect(q.options[q.answer]).toBe('顺子');
  });

  it('出题时机：隔够轮数、出够张数、每局有上限', () => {
    expect(quizDue({ tricksSinceAsk: 2, played: 12, askedThisRound: 0 })).toBe(true);
    expect(quizDue({ tricksSinceAsk: 1, played: 30, askedThisRound: 0 })).toBe(false);
    expect(quizDue({ tricksSinceAsk: 3, played: 11, askedThisRound: 0 })).toBe(false);
    expect(quizDue({ tricksSinceAsk: 3, played: 40, askedThisRound: 5 })).toBe(false);
  });
});

describe('段位', () => {
  it('当前段位最近 10 题答对 8 题升段；复习题不触发升段', () => {
    const p = newProgress();
    for (let i = 0; i < PROMOTE_NEED - 1; i++) expect(record(p, { tier: 1 }, true).promoted).toBe(false);
    expect(progressText(p)).toBe('最近 7 题答对 7 题，再答对 1 题升到“记级牌”');
    expect(record(p, { tier: 1 }, true).promoted).toBe(true);
    expect(p.tier).toBe(2);
    // 段位 2 时答对段位 1 的复习题，不会再升
    for (let i = 0; i < 10; i++) record(p, { tier: 1 }, true);
    expect(p.tier).toBe(2);
    expect(p).toMatchObject({ asked: 18, correct: 18 });
  });

  it('答错拉低窗口里的正确数，最高段位不再升', () => {
    const p = newProgress();
    for (let i = 0; i < 3; i++) record(p, { tier: 1 }, false);
    for (let i = 0; i < 7; i++) record(p, { tier: 1 }, true);
    expect(p.tier).toBe(1); // 10 题对 7 题
    record(p, { tier: 1 }, true); // 窗口滑动：最近 10 题对 8 题
    expect(p.tier).toBe(2);
    const top = { ...newProgress(), tier: MAX_TIER };
    for (let i = 0; i < 10; i++) record(top, { tier: MAX_TIER }, true);
    expect(top.tier).toBe(MAX_TIER);
    expect(progressText(top)).toContain('已经是最高段位');
  });
});
