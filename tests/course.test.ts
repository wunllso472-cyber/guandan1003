// 《掼蛋规则与实战技巧》接入：课程牌力评分与五档角色、出牌规则（末位负责、防空炸、谁先出炸、打上放下）、报牌结构和五问
import { describe, it, expect } from 'vitest';
import { DECK, type Suit } from '../shared/cards';
import { parseCombos } from '../shared/combo';
import { CardTracker } from '../shared/tracker';
import { advise, decisionContext } from '../shared/advisor';
import { courseRules } from '../shared/strategy';

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

/** 打 level 的局面：我坐 0 号位，下家 1、对家 2、上家 3 */
function setup(level: number) {
  const tr = new CardTracker(0);
  tr.apply({ type: 'roundStart', level, levelTeam: 0, hands: [[], [], [], []], levels: [level, level], roundNo: 2 });
  return tr;
}
const rule = (o: { rules: { id: string; weight: number; effect: string }[] } | undefined, id: string) => o?.rules.find((h) => h.id === id);

describe('课程牌力评分', () => {
  it('四头炸 +2、五头炸 +3、登基牌 +1、坠牌 -1，按五档定角色', () => {
    const used = new Set<number>();
    // 四头炸（+2）+ 五头炸（+3）+ 大王（登基 +1）+ 一手坠牌对4（-1）= 5 分：可切换
    const hand = ids('S9 H9 C9 D9 S7 H7 C7 D7 S7 BJ S4 C4', used);
    const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [12, 27, 27, 27], tracker: setup(2) });
    expect(adv.power).toMatchObject({ points: 5, tier: 'flex', bombs: 2, bombPoints: 5, controls: 1, lows: 1, role: 'undecided' });
    // 同类有登基牌能收回牌权的弱牌不算坠牌：小单张有大王回收
    const single = advise({ seat: 0, hand: ids('S9 H9 C9 D9 BJ S4'), level: 2, target: null, targetSeat: null, counts: [6, 27, 27, 27], tracker: setup(2) });
    expect(single.power).toMatchObject({ points: 3, lows: 0, tier: 'support' });
  });

  it('8 分以上强主攻；没有炸弹、坠牌多是弱助攻', () => {
    const strong = advise({ seat: 0, hand: ids('S9 H9 C9 D9 S9 S7 H7 C7 D7 S7 SK HK CK DK BJ'), level: 2, target: null, targetSeat: null, counts: [15, 27, 27, 27], tracker: setup(2) });
    expect(strong.power).toMatchObject({ tier: 'strongAttack', role: 'attack' });
    expect(strong.power!.points).toBeGreaterThanOrEqual(8);
    const weak = advise({ seat: 0, hand: ids('S3 H5 C7 D9 SJ'), level: 2, target: null, targetSeat: null, counts: [5, 27, 27, 27], tracker: setup(2) });
    expect(weak.power).toMatchObject({ tier: 'weakSupport', role: 'support', bombs: 0 });
  });

  it('被打双下（本方两人都进贡）评分减 2', () => {
    const used = new Set<number>();
    const hand = ids('S9 H9 C9 D9 S4', used);
    const calm = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [5, 27, 27, 27], tracker: setup(2) });
    const tr = setup(2);
    const [a, b] = ids('SA HA', used);
    tr.apply({ type: 'tribute', list: [{ from: 0, to: 1, card: a }, { from: 2, to: 3, card: b }] });
    const down = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [5, 27, 27, 27], tracker: tr });
    expect(down.power!.doubleDown).toBe(true);
    expect(down.power!.points).toBe(calm.power!.points - 2);
  });
});

describe('课程出牌规则', () => {
  it('末位负责：下家的牌压在桌上、他剩得不多时，放过要扣分；上家的牌还有对家把关', () => {
    const used = new Set<number>();
    const hand = ids('S3 S5 H7 C9 DJ SK SA HA C4 D6 S8 HQ', used);
    const target = parseCombos(ids('D8', used), 2)[0];
    const fromNext = advise({ seat: 0, hand, level: 2, target, targetSeat: 1, counts: [12, 8, 15, 20], tracker: setup(2) });
    expect(rule(fromNext.options.find((o) => o.id === 'pass'), 'LAST_DEFENSE')?.weight).toBeGreaterThan(0);
    expect(rule(fromNext.options.find((o) => o.label === '单张J'), 'LAST_DEFENSE')?.weight).toBeLessThan(0);
    expect(fromNext.options[0].combo).not.toBeNull();
    const fromPrev = advise({ seat: 0, hand, level: 2, target, targetSeat: 3, counts: [12, 20, 15, 8], tracker: setup(2) });
    expect(rule(fromPrev.options.find((o) => o.id === 'pass'), 'LAST_DEFENSE')).toBeUndefined();
  });

  it('防空炸：下家剩 5 张（可能一单加炸弹）时，首出小单张要扣分，三带二不受影响', () => {
    const used = new Set<number>();
    const hand = ids('S3 S8 H8 C8 D5 C5 SK HK', used);
    const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [8, 5, 15, 20], tracker: setup(2) });
    expect(rule(adv.options.find((o) => o.label === '单张3'), 'EMPTY_BOMB')?.weight).toBeGreaterThan(0);
    expect(rule(adv.options.find((o) => o.combo?.type === 'fullhouse'), 'EMPTY_BOMB')).toBeUndefined();
  });

  it('谁先出炸：我牌还散、对家快到位时，拦截的炸弹由我来出', () => {
    const used = new Set<number>();
    const hand = ids('S9 H9 C9 D9 S3 H5 C7 DJ SQ', used);
    const target = parseCombos(ids('SA HA', used), 2)[0];
    const adv = advise({ seat: 0, hand, level: 2, target, targetSeat: 3, counts: [9, 20, 5, 8], tracker: setup(2) });
    const bomb = adv.options.find((o) => o.features?.isBomb)!;
    expect(rule(bomb, 'WHO_BOMBS')?.weight).toBeLessThan(0);
    expect(bomb.reasons.join()).toContain('这一炸由我来出');
  });

  it('炸后要能推进：自己很散、对家也远没到位、对手不急时，炸了只是白耗火力', () => {
    const used = new Set<number>();
    const hand = ids('S9 H9 C9 D9 S3 H5 C7 DJ SQ D4 C6 S8 H10 CK', used);
    const target = parseCombos(ids('SA HA', used), 2)[0];
    const adv = advise({ seat: 0, hand, level: 2, target, targetSeat: 3, counts: [14, 20, 22, 18], tracker: setup(2) });
    expect(rule(adv.options.find((o) => o.features?.isBomb), 'BOMB_FOLLOWUP')?.weight).toBeGreaterThan(0);
    expect(adv.options[0].id).toBe('pass');
  });

  it('打上放下：助攻前期放下家领牌；下家剩 10 张以内就不再放', () => {
    const used = new Set<number>();
    const hand = ids('S3 H5 C7 D9 SJ SQ HK BJ D4 C6', used);
    const target = parseCombos(ids('D8', used), 2)[0];
    const inp = { seat: 0, hand, level: 2, target, targetSeat: 1, counts: [10, 20, 20, 20], tracker: setup(2) };
    const adv = advise(inp);
    expect(adv.power!.role).toBe('support');
    const pass = adv.options.find((o) => o.id === 'pass')!;
    // 对打评估里给它加分会变差，所以只作提示理由、分量为 0
    expect(rule(pass, 'UP_DOWN')?.effect).toBe('support');
    expect(Math.abs(rule(pass, 'UP_DOWN')!.weight)).toBe(0);
    expect(pass.reasons.join()).toContain('打上放下');
    expect(rule(adv.options.find((o) => o.label === '单张大王'), 'UP_DOWN')?.effect).toBe('oppose');
    const late = advise({ ...inp, counts: [10, 9, 20, 20] });
    expect(rule(late.options.find((o) => o.id === 'pass'), 'UP_DOWN')).toBeUndefined();
  });

  it('开关关闭后不再触发', () => {
    const used = new Set<number>();
    const hand = ids('S3 S8 H8 C8 D5 C5 SK HK', used);
    courseRules.enabled = false;
    try {
      const adv = advise({ seat: 0, hand, level: 2, target: null, targetSeat: null, counts: [8, 5, 15, 20], tracker: setup(2) });
      expect(adv.options.some((o) => rule(o, 'EMPTY_BOMB'))).toBe(false);
    } finally { courseRules.enabled = true; }
  });
});

describe('报牌结构与五问', () => {
  it('按剩余张数列出常见结构（只是候选）', () => {
    const tr = setup(2);
    tr.seats[1].count = 5;
    tr.seats[3].count = 9;
    const adv = advise({ seat: 0, hand: ids('S3 H5 C7'), level: 2, target: null, targetSeat: null, counts: [3, 5, 20, 9], tracker: tr });
    expect(adv.inferred.find((x) => x.who === 'right' && x.text.includes('只剩 5 张'))?.text).toContain('一单加四头炸');
    expect(adv.inferred.find((x) => x.who === 'left' && x.text.includes('只剩 9 张'))?.text).toContain('五张普通牌加四头炸');
  });

  it('决策依据里回答这手牌的五问，并列出命中的课程规则', () => {
    const used = new Set<number>();
    const hand = ids('S3 S5 H7 C9 DJ SK SA HA C4 D6 S8 HQ', used);
    const target = parseCombos(ids('D8', used), 2)[0];
    const inp = { seat: 0, hand, level: 2, target, targetSeat: 1, counts: [12, 8, 15, 20], tracker: setup(2) };
    const adv = advise(inp);
    const ctx = decisionContext(inp, adv, adv.options[0]);
    expect(ctx.five!.map((x) => x.q)).toEqual(['谁更有机会先走', '这一手在做什么', '谁会因此拿牌权', '拿到牌权出什么', '还留几次控制']);
    expect(ctx.five![0].a).toContain('下家 8 张');
    expect(ctx.book.some((x) => x.startsWith('末位负责'))).toBe(true);
    expect(ctx.focus[0]).toContain('助攻');
  });
});
