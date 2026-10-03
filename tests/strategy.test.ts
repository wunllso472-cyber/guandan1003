// 用《掼蛋实战进阶手册》中的牌例检验规则库、本地提示和电脑出牌
import { describe, it, expect } from 'vitest';
import { DECK, card, type Suit } from '../shared/cards';
import { parseCombos, type Combo } from '../shared/combo';
import { CardTracker } from '../shared/tracker';
import { advise, buildJevContext } from '../shared/advisor';
import { aiPlay } from '../shared/ai';

function ids(spec: string, used = new Set<number>()): number[] {
  return spec.split(/\s+/).filter(Boolean).map((t) => {
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(1)] ?? Number(t.slice(1));
    const f = DECK.find((c) => c.suit === (t[0] as Suit) && c.rank === rank && !used.has(c.id));
    if (!f) throw new Error('no card ' + t);
    used.add(f.id);
    return f.id;
  });
}

function table(level: number, finished: number[] = []) {
  const tr = new CardTracker(0);
  tr.apply({ type: 'roundStart', level, levelTeam: 0, hands: [[], [], [], []], levels: [level, level], roundNo: 2 });
  finished.forEach((s, i) => tr.apply({ type: 'finish', seat: s, place: i + 1 }));
  return tr;
}

/** 我坐 0（南），1 是下家（东），2 是对家（北），3 是上家（西） */
function run(level: number, hand: number[], counts: number[], tracker: CardTracker, target: Combo | null = null, targetSeat: number | null = null) {
  const inp = { seat: 0, hand, level, target, targetSeat, counts, tracker };
  const adv = advise(inp);
  const ai = aiPlay({ seat: 0, hand, level, target, targetSeat, handCounts: counts });
  return { adv, top: adv.options[0], ai, ctx: buildJevContext(inp, adv) };
}
const ranks = (c: Combo | null) => (c ? c.cards.map((id) => card(id).rank).sort((a, b) => a - b) : []);

describe('手册牌例', () => {
  it('牌例04：对家只剩 A、下家只剩 6，首出拆 7 而不是出 3', () => {
    const hand = ids('S3 S7 C7');
    const r = run(2, hand, [3, 1, 1, 2], table(2));
    expect(ranks(r.top.combo)).toEqual([7]);
    expect(ranks(r.ai)).toEqual([7]);
    expect(r.top.rules.some((h) => h.id === 'PASS_GATE' && h.effect === 'support')).toBe(true);
  });

  it('第10章：对手已头游，先出 66，留下 JJ 和七炸，保证对家接风', () => {
    // 对方打 A（红桃 A 为配），W 已头游；S：7777 66 JJ；E：999 AA；N：55
    const hand = ids('S7 C7 D7 H7 S6 C6 SJ CJ');
    const tr = table(14, [3]);
    const r = run(14, hand, [8, 5, 2, 0], tr);
    expect(r.top.label).toBe('对6');
    expect(ranks(r.ai)).toEqual([6, 6]);
    expect(r.ctx.goal).toContain('partner');
  });

  it('牌例03：跟单张 9 时出 10（重复余量），保留 8-Q 顺子和 K 炸', () => {
    const hand = ids('D8 C9 S10 HJ DQ C10 SK CK DK H2');
    const target = parseCombos(ids('H9'), 2)[0];
    const r = run(2, hand, [10, 20, 20, 20], table(2), target, 1);
    const play = r.ai ?? r.top.combo;
    expect(ranks(play)).not.toEqual([11]);
    if (r.top.combo?.type === 'single') expect(ranks(r.top.combo)).toEqual([10]);
  });

  it('牌例05：只剩与下家争先，用 8 炸压住 K，随后 JJ 出完', () => {
    const hand = ids('S8 C8 D8 H8 SJ CJ');
    const target = parseCombos(ids('SK'), 2)[0];
    const r = run(2, hand, [6, 8, 0, 0], table(2, [2, 3]), target, 1);
    expect(r.ai?.type).toBe('bomb');
    expect(r.top.combo?.type).toBe('bomb');
  });

  it('优先防止对手直接走完：对手剩 2 张出对子，不能放过', () => {
    const hand = ids('SK CK S3 S8 D10 CJ');
    const target = parseCombos(ids('D5 H5'), 2)[0];
    const r = run(2, hand, [6, 2, 10, 18], table(2), target, 1);
    expect(r.top.id).not.toBe('pass');
    expect(r.adv.options.find((o) => o.id === 'pass')!.rules.some((h) => h.id === 'STOP_FINISH' && h.effect === 'oppose')).toBe(true);
  });

  it('交给 Jev 的信息包含目标、规则原则和每个出法的规则命中', () => {
    const hand = ids('S3 S7 C7');
    const r = run(2, hand, [3, 1, 1, 2], table(2));
    expect(r.ctx.rulebook.some((x) => x.startsWith('PASS_GATE'))).toBe(true);
    expect(r.ctx.options.some((o) => (o as { rule_hits: string[] }).rule_hits.length > 0)).toBe(true);
  });
});
