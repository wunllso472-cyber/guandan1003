import { describe, it, expect } from 'vitest';
import { DECK, type Suit } from '../shared/cards';
import { parseCombos } from '../shared/combo';
import { CardTracker } from '../shared/tracker';
import { advise, buildJevContext } from '../shared/advisor';
import { BOOK_RULES } from '../shared/rulebook';

function ids(spec: string, used = new Set<number>()): number[] {
  return spec.split(/\s+/).filter(Boolean).map((t) => {
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(1)] ?? Number(t.slice(1));
    const f = DECK.find((c) => c.suit === (t[0] as Suit) && c.rank === rank && !used.has(c.id));
    if (!f) throw new Error('no card ' + t);
    used.add(f.id);
    return f.id;
  });
}

function setup(level: number) {
  const tr = new CardTracker(0);
  tr.apply({ type: 'roundStart', level, levelTeam: 0, hands: [[], [], [], []], levels: [level, level], roundNo: 2 });
  return tr;
}

describe('教材规则库接入', () => {
  it('规则库完整载入 56 条', () => {
    expect(Object.keys(BOOK_RULES).length).toBe(56);
  });

  it('开局按实际局面判断阶段', () => {
    const used = new Set<number>();
    const hand = ids('S3 S4 H6 C8 D9 S10 HJ CQ DK SA', used);
    const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [27, 27, 27, 27], tracker: setup(2) });
    expect(adv.stage).toBe('opening');
  });

  it('对手出小牌给快出完的搭档送牌时，不建议放过（M03 堵截敌方传牌）', () => {
    const used = new Set<number>();
    const tr = setup(2);
    const hand = ids('S3 S5 H7 C9 DJ SK SA HA', used);
    const target = parseCombos(ids('D4', used), 2)[0];
    // 上家（3 号位）出小单张，他的搭档（1 号位）只剩 2 张
    const inp = { seat: 0, hand, level: 2, target, targetSeat: 3, counts: [8, 2, 12, 15], tracker: tr };
    const adv = advise(inp);
    expect(adv.options[0].combo).not.toBeNull();
    const pass = adv.options.find((o) => o.id === 'pass')!;
    expect(pass.rules.some((h) => h.id === 'M03')).toBe(true);
    // 交给 Jev 的信息包含相关教材规则
    const ctx = buildJevContext(inp, adv);
    expect(ctx.textbookRules.some((s: string) => s.startsWith('M03'))).toBe(true);
  });

  it('对手在本方领出的牌型上反复顺牌时，换一条路（M01）', () => {
    const used = new Set<number>();
    const tr = setup(2);
    const play = (seat: number, spec: string, left: number) => tr.apply({ type: 'play', seat, combo: parseCombos(ids(spec, used), 2)[0], left });
    // 两轮：我领出对子，下家都跟对子
    for (const [a, b] of [['S3 H3', 'S6 H6'], ['S4 H4', 'S8 H8']]) {
      tr.apply({ type: 'turn', seat: 0, lead: true } as never);
      play(0, a, 20); play(1, b, 20);
      tr.apply({ type: 'trickEnd' } as never);
    }
    tr.apply({ type: 'turn', seat: 0, lead: true } as never);
    const hand = ids('C5 D5 C7 D9 CJ DQ SK', used);
    const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [7, 20, 22, 23], tracker: tr });
    const pair = adv.options.find((o) => o.combo?.type === 'pair')!;
    expect(pair.rules.some((h) => h.id === 'M01')).toBe(true);
  });
});
