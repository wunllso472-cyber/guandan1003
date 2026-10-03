import { describe, it, expect } from 'vitest';
import { DECK, card, type Suit } from '../shared/cards';
import { parseCombos } from '../shared/combo';
import { CardTracker } from '../shared/tracker';
import { advise, buildJevContext, controlOf } from '../shared/advisor';
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
