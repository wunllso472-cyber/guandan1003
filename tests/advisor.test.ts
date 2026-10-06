import { describe, it, expect } from 'vitest';
import { DECK, card, type Suit } from '../shared/cards';
import { parseCombos } from '../shared/combo';
import { CardTracker } from '../shared/tracker';
import { advise, buildJevContext, controlOf, decisionContext } from '../shared/advisor';
import { unseenStat } from '../shared/tracker';

function ids(spec: string, used = new Set<number>()): number[] {
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

/** 构造一个打 level 的局面：我坐 0 号位 */
function setup(level: number) {
  const tr = new CardTracker(0);
  tr.apply({ type: 'roundStart', level, levelTeam: 0, hands: [[], [], [], []], levels: [level, level], roundNo: 2 });
  return tr;
}
const top = (adv: ReturnType<typeof advise>) => adv.options[0];

describe('记牌器', () => {
  it('打出的牌不再算在外面；进贡的牌记为确定持有', () => {
    const used = new Set<number>();
    const tr = setup(5);
    const [bj] = ids('BJ', used);
    tr.apply({ type: 'tribute', list: [{ from: 1, to: 2, card: bj }] });
    expect(tr.seats[2].known.has(bj)).toBe(true);
    const played = ids('S9 C9', used);
    tr.apply({ type: 'play', seat: 1, combo: parseCombos(played, 5)[0], left: 24 });
    const hand = ids('S3 C4', used);
    const unseen = tr.unseen(hand);
    expect(unseen.length).toBe(108 - 2 - 2);
    expect(unseen.includes(played[0])).toBe(false);
  });

  it('进贡：进贡者没有比贡牌大的非逢人配牌（硬约束），还贡得到的牌除外', () => {
    const used = new Set<number>();
    const tr = setup(5);
    const [sa] = ids('SA', used);
    tr.apply({ type: 'tribute', list: [{ from: 1, to: 2, card: sa }] });
    const lacks = tr.seats[1].lacks;
    expect(tr.seats[1].tributed).toBe(sa);
    // 级牌 5（非红桃）和大小王都比 A 大
    expect([...lacks].some((id) => card(id).rank === 5 && card(id).suit === 'S')).toBe(true);
    expect([...lacks].filter((id) => card(id).rank >= 16).length).toBe(4);
    // 逢人配（红桃 5）不受限制；同点数的 A 也不受限制
    expect([...lacks].some((id) => card(id).rank === 5 && card(id).suit === 'H')).toBe(false);
    expect([...lacks].some((id) => card(id).rank === 14)).toBe(false);
    const adv = advise({ seat: 0, hand: ids('S3 C4', used), level: 5, target: null, targetSeat: null, counts: [2, 26, 28, 27], tracker: tr });
    expect(adv.facts.join()).toContain('下家进贡了♠A');
  });

  it('抗贡：单下时进贡者确定有两张大王，其他人没有大王', () => {
    const tr = setup(2);
    tr.apply({ type: 'antiTribute', seats: [3] });
    const bjs = DECK.filter((c) => c.rank === 17).map((c) => c.id);
    for (const id of bjs) {
      expect(tr.seats[3].known.has(id)).toBe(true);
      for (const s of [0, 1, 2]) expect(tr.seats[s].lacks.has(id)).toBe(true);
    }
  });

  it('抗贡：双下时大王在两个进贡者之间，另一队没有大王', () => {
    const tr = setup(2);
    tr.apply({ type: 'antiTribute', seats: [1, 3] });
    const bjs = DECK.filter((c) => c.rank === 17).map((c) => c.id);
    for (const id of bjs) {
      expect(tr.seats[2].lacks.has(id)).toBe(true);
      expect(tr.seats[1].lacks.has(id) || tr.seats[1].known.has(id)).toBe(false);
    }
  });

  it('面对搭档的牌不出是让牌，不推断缺牌', () => {
    const used = new Set<number>();
    const tr = setup(2);
    tr.apply({ type: 'turn', seat: 1, lead: true });
    tr.apply({ type: 'play', seat: 1, combo: parseCombos(ids('S9', used), 2)[0], left: 26 });
    tr.apply({ type: 'pass', seat: 2 });
    tr.apply({ type: 'pass', seat: 3 }); // 下家（座位 1）的搭档：让牌
    const adv = advise({ seat: 0, hand: ids('S3 C4', used), level: 2, target: parseCombos(ids('C9', used), 2)[0], targetSeat: 1, counts: [2, 26, 27, 27], tracker: tr });
    const txt = adv.inferred.filter((x) => x.text.includes('曾选择不出')).map((x) => x.who);
    expect(txt).toContain('partner');
    expect(txt).not.toContain('left');
  });

  it('大小王都出完后，提示理由会说明级牌最大', () => {
    const used = new Set<number>();
    const tr = setup(5);
    const jokers = ids('SJ SJ BJ BJ', used);
    tr.apply({ type: 'play', seat: 1, combo: parseCombos(jokers, 5)[0], left: 23 });
    tr.apply({ type: 'trickEnd', leader: 1, jiefeng: false });
    const hand = ids('S5 C3 D8 SK', used);
    const adv = advise({ seat: 0, hand, level: 5, target: null, targetSeat: null, counts: [4, 23, 27, 27], tracker: tr });
    expect(adv.facts.join()).toContain('没有大小王');
    const single5 = adv.options.find((o) => o.label === '单张5')!;
    expect(single5.reasons.join()).toContain('级牌是最大的单张');
  });
});

describe('提示推荐', () => {
  it('对家只剩 2 张：首出时送一对小牌', () => {
    const tr = setup(2);
    const hand = ids('S4 C4 S9 SJ CQ DK SA');
    const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [7, 20, 2, 18], tracker: tr });
    expect(top(adv).label).toBe('对4');
    expect(top(adv).reasons.join()).toContain('对家只剩 2 张');
  });

  it('对家只剩 1 张：首出小单张', () => {
    const tr = setup(2);
    const hand = ids('S4 C4 S6 D9 D9 SK');
    const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [6, 20, 1, 18], tracker: tr });
    expect(top(adv).combo?.type).toBe('single');
    expect(card(top(adv).combo!.cards[0]).rank).toBeLessThanOrEqual(10);
  });

  it('下家只剩 1 张：首出避免单张', () => {
    const tr = setup(2);
    const hand = ids('S4 S7 C7 D9 SK');
    const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [5, 1, 20, 18], tracker: tr });
    expect(top(adv).combo?.type).not.toBe('single');
  });

  it('对家手里有大王（进贡可知）：首出小单张，并说明理由', () => {
    const used = new Set<number>();
    const tr = setup(2);
    const bjs = ids('BJ BJ', used);
    tr.apply({ type: 'tribute', list: [{ from: 1, to: 2, card: bjs[0] }] });
    tr.apply({ type: 'play', seat: 3, combo: parseCombos([bjs[1]], 2)[0], left: 20 });
    tr.apply({ type: 'trickEnd', leader: 3, jiefeng: false });
    const hand = ids('S3 S7 C7 D9 D9 SK', used);
    const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [6, 20, 15, 20], tracker: tr });
    const s3 = adv.options.find((o) => o.label === '单张3')!;
    expect(s3.reasons.join()).toContain('对家手里有外面最大的牌');
  });

  it('对家出的牌：推荐不出', () => {
    const tr = setup(2);
    const hand = ids('S4 C4 S9 C9 SK');
    const target = parseCombos(ids('DQ HQ'), 2)[0];
    const adv = advise({ seat: 0, hand, level: 2, target, targetSeat: 2, counts: [5, 20, 10, 18], tracker: tr });
    expect(top(adv).id).toBe('pass');
  });

  it('能一手出完时排第一', () => {
    const tr = setup(2);
    const hand = ids('S9 C9');
    const target = parseCombos(ids('D5 H5'), 2)[0];
    const adv = advise({ seat: 0, hand, level: 2, target, targetSeat: 1, counts: [2, 20, 10, 18], tracker: tr });
    expect(top(adv).label).toBe('对9');
    expect(top(adv).reasons).toContain('一手出完');
  });

  it('外面没人压得住的牌标记为 unbeatable', () => {
    const tr = setup(2);
    const hand = ids('SA CA DA HA');           // 自己有 4 张 A……
    const st = unseenStat(tr.unseen(hand), 2);
    const pairBJ = parseCombos(ids('BJ BJ'), 2)[0];
    expect(controlOf(pairBJ, st, 2)).not.toBe('beatable'); // 对大王只可能被炸弹压
  });

  it('炸弹按张数和点数比较：外面只有更小的炸弹时压不住', () => {
    const used = new Set<number>();
    const my5 = parseCombos(ids('S9 C9 D9 S9 C9', used), 3)[0]; // 打 3：5 张 9
    const my4 = parseCombos(ids('S10 C10 D10 H10', used), 3)[0];
    expect(my5.type).toBe('bomb');
    expect(my4.cards.length).toBe(4);
    const small4 = unseenStat(ids('S5 C5 D5 H5', used), 3);       // 外面只能凑 4 张 5
    expect(controlOf(my5, small4, 3)).toBe('unbeatable');
    expect(controlOf(my4, small4, 3)).toBe('unbeatable');
    const big4 = unseenStat(ids('SK CK DK HK', used), 3);         // 外面能凑 4 张 K
    expect(controlOf(my4, big4, 3)).toBe('beatable');
    expect(controlOf(my5, big4, 3)).toBe('unbeatable');
  });

  it('外面凑不出同点数炸弹、但可能有同花顺时，顺子只可能被炸弹压', () => {
    const used = new Set<number>();
    const straight = parseCombos(ids('S10 CJ DQ SK CA', used), 2)[0];
    expect(straight.type).toBe('straight');
    const st = unseenStat(ids('D3 D4 D5 D6 D7 S8', used), 2);
    expect(st.maxSfStart).toBe(3);
    expect(controlOf(straight, st, 2)).toBe('bombOnly');
    // 我的同花顺：外面只有更小的同花顺压不住，更大的能压
    const mySf = parseCombos(ids('S5 S6 S7 S8 S9', used), 2).find((c) => c.type === 'straightflush')!;
    expect(mySf.type).toBe('straightflush');
    expect(controlOf(mySf, st, 2)).toBe('unbeatable');
    expect(controlOf(mySf, unseenStat(ids('C8 C9 C10 CJ CQ', used), 2), 2)).toBe('beatable');
  });

  it('生成交给 Jev 的信息', () => {
    const tr = setup(2);
    const hand = ids('S4 C4 S9 SK');
    const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [4, 20, 2, 18], tracker: tr });
    const ctx = buildJevContext({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [4, 20, 2, 18], tracker: tr }, adv);
    expect(ctx.options.length).toBe(adv.options.length);
    expect(ctx.players.find((p) => p.who === '对家')!.cardsLeft).toBe(2);
    expect(JSON.stringify(ctx).length).toBeLessThan(20000);
  });
});

describe('决策理由与牌力评估', () => {
  it('同样剩几手时用最小的对子压，理由里写明留着大对子；并给出牌力和打法', () => {
    const used = new Set<number>();
    const tr = setup(2);
    const played = ids('S6 C6', used);
    const target = parseCombos(played, 2)[0];
    tr.apply({ type: 'play', seat: 3, combo: target, left: 25 });
    const hand = ids('SA DA HK CK SQ SQ HQ DJ H10 C10 D10 S9 C9 H8 C8 C8 S7 C7 D7 H6 D6 S5 C5 D4 S3 C3 C3', used);
    const adv = advise({ seat: 0, hand, level: 2, target, targetSeat: 3, counts: [27, 27, 27, 25], tracker: tr });
    expect(top(adv).label).toBe('对10');
    expect(top(adv).reasons[0]).toContain('留着对K、对A');
    expect(adv.options.find((o) => o.label === '对A')!.reasons.join()).toContain('没必要花掉对A');
    // 没有炸弹、小牌多：牌力弱，打助攻
    expect(adv.power).toMatchObject({ strength: 'weak', role: 'support', bombs: 0 });
    // 外面的大牌：手里有两张 A、两张 K，没有王和 2
    const ctx = decisionContext({ seat: 0, hand, level: 2, target, targetSeat: 3, counts: [27, 27, 27, 25], tracker: tr }, adv, top(adv));
    expect(ctx.outside).toEqual([
      { name: '大王', left: 2, total: 2 },
      { name: '小王', left: 2, total: 2 },
      { name: '级牌2', left: 8, total: 8, note: '含逢人配 2' },
      { name: 'A', left: 6, total: 8 },
      { name: 'K', left: 6, total: 8 },
    ]);
  });
});

describe('外面的大牌张数', () => {
  it('其他三家还有的：总数减自己手里的、再减打出去的；级牌含逢人配', () => {
    const used = new Set<number>();
    const tr = setup(2);
    // 对手打出过一张大王、一张 A，不再算外面
    const played = ids('BJ SA', used);
    for (const id of played) tr.apply({ type: 'play', seat: 1, combo: parseCombos([id], 2)[0], left: 20 });
    const hand = ids('BJ H2 S2 CA DK S5 C6', used);
    const inp = { seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [7, 20, 27, 27], tracker: tr };
    const adv = advise(inp);
    expect(decisionContext(inp, adv, top(adv)).outside).toEqual([
      { name: '大王', left: 0, total: 2 },
      { name: '小王', left: 2, total: 2 },
      { name: '级牌2', left: 6, total: 8, note: '含逢人配 1' },
      { name: 'A', left: 6, total: 8 },
      { name: 'K', left: 7, total: 8 },
    ]);
  });
});

describe('拆炸弹的理由', () => {
  /** 外面已经没有比 Q 大的牌（K、A、2、王都出过了），对手出对10 */
  function endgame(prevLeft: number) {
    const used = new Set<number>();
    const tr = setup(2);
    const gone = ids('SK SK HK HK CK CK DK DK SA SA HA HA CA CA DA DA S2 S2 H2 H2 C2 C2 D2 D2 SJ SJ BJ BJ', used);
    for (const id of gone) tr.apply({ type: 'play', seat: 2, combo: parseCombos([id], 2)[0], left: 0 });
    const tens = ids('D10 D10', used);
    const target = parseCombos(tens, 2)[0];
    tr.apply({ type: 'play', seat: 3, combo: target, left: prevLeft });
    const hand = ids('SQ HQ CQ DQ S10 S9 D9', used);
    return advise({ seat: 0, hand, level: 2, target, targetSeat: 3, counts: [7, 1, 0, prevLeft], tracker: tr });
  }

  it('对手都不可能有炸弹、拆开的两对都压不住：拆炸是支持理由', () => {
    const adv = endgame(3);
    const pq = adv.options.find((o) => o.label === '对Q')!;
    expect(top(adv).label).toBe('对Q');
    expect(pq.reasons.join()).toContain('不可能有炸弹');
    expect(pq.reasons.join()).not.toContain('剩下的牌未必更好走');
  });

  it('对手还可能有炸弹时，仍提示拆炸的风险', () => {
    const pq = endgame(5).options.find((o) => o.label === '对Q')!;
    expect(pq.reasons.join()).toContain('剩下的牌未必更好走');
  });
});
