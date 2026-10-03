import { describe, it, expect } from 'vitest';
import { DECK, card, type Suit } from '../shared/cards';
import { parseCombos, canBeat, resolvePlay, type Combo } from '../shared/combo';
import { findAllPlays } from '../shared/finder';
import { bestSplit, aiPlay, returnCard } from '../shared/ai';
import { GuandanGame, teamOf } from '../shared/game';

// 'H5' 'S10' 'DA' 'SJ'(小王) 'BJ'(大王)；同一张牌第二次取第二副
function ids(spec: string): number[] {
  const used = new Set<number>();
  return spec.split(/\s+/).filter(Boolean).map((t) => {
    let pred: (id: number) => boolean;
    if (t === 'SJ') pred = (id) => card(id).rank === 16;
    else if (t === 'BJ') pred = (id) => card(id).rank === 17;
    else {
      const suit = t[0] as Suit;
      const rs = t.slice(1);
      const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[rs] ?? Number(rs);
      pred = (id) => card(id).suit === suit && card(id).rank === rank;
    }
    const found = DECK.find((c) => pred(c.id) && !used.has(c.id));
    if (!found) throw new Error('no card ' + t);
    used.add(found.id);
    return found.id;
  });
}

const types = (spec: string, level = 2) => parseCombos(ids(spec), level).map((c) => c.type).sort();
const one = (spec: string, level = 2): Combo => {
  const r = resolvePlay(ids(spec), level, null);
  expect(r.length).toBeGreaterThan(0);
  return r[0];
};

describe('牌型识别', () => {
  it('基础牌型', () => {
    expect(types('S3')).toEqual(['single']);
    expect(types('S3 H3')).toEqual(['pair']);
    expect(types('S3 H3 D3')).toEqual(['triple']);
    expect(types('S3 H3 D3 C5 D5')).toEqual(['fullhouse']);
    expect(types('S3 H4 D5 C6 D7')).toEqual(['straight']);
    expect(types('S3 H3 D4 C4 D5 S5')).toEqual(['tube']);
    expect(types('S3 H3 D3 C4 D4 S4')).toEqual(['plate']);
    expect(types('S3 H3 D3 C3')).toEqual(['bomb']);
    expect(types('S3 S4 S5 S6 S7')).toEqual(['straight', 'straightflush']);
    expect(types('SJ SJ BJ BJ')).toEqual(['jokerbomb']);
    expect(types('SJ BJ')).toEqual([]);
    expect(types('SJ SJ')).toEqual(['pair']);
    expect(types('S3 H4 D5 C6')).toEqual([]);
  });

  it('A 可作 1 或 A，但不能绕圈', () => {
    expect(one('SA H2 D3 C4 D5').value).toBe(1);
    expect(one('S10 HJ DQ CK DA').value).toBe(10);
    expect(types('SQ HK DA C2 D3')).toEqual([]);
    expect(one('SA HA D2 C2 D3 S3').type).toBe('tube');
    expect(one('SK HK DK CA DA SA').type).toBe('plate');
  });

  it('逢人配（红桃级牌）', () => {
    // 打 2，红桃 2 是配
    expect(one('S3 H4 D5 C6 H2').type).toBe('straight');
    expect(one('S3 H4 D5 C6 H2').value).toBe(3); // 3-7 最大
    expect(one('S3 S3 D3 H2').type).toBe('bomb');
    expect(types('S9 H2')).toEqual(['pair']);
    expect(types('SJ H2')).toEqual([]); // 配不能当王
    expect(one('S5 S6 S7 S8 H2').type).toBe('straightflush');
    const fh = resolvePlay(ids('S3 D3 C3 H2 H2'), 2, null).map((c) => c.type);
    expect(fh).toContain('bomb');
    expect(fh).toContain('fullhouse');
  });

  it('级牌大于 A', () => {
    const a = one('SA', 5), lv = one('S5', 5);
    expect(canBeat(lv, a)).toBe(true);
    expect(canBeat(one('SJ', 5), lv)).toBe(true);
  });

  it('炸弹大小', () => {
    const b4 = one('S3 H3 D3 C3'), b5 = one('S3 H3 D3 C3 S3'), sf = one('S3 S4 S5 S6 S7');
    const b6 = one('S2 C2 D2 S2 C2 D2', 5), jb = one('SJ SJ BJ BJ');
    expect(canBeat(b5, b4)).toBe(true);
    expect(canBeat(sf, b5)).toBe(true);
    expect(canBeat(b6, sf)).toBe(true);
    expect(canBeat(jb, b6)).toBe(true);
    expect(canBeat(b4, one('SA HA DA CA SA'))).toBe(false);
    expect(canBeat(b4, one('S10 HJ DQ CK DA'))).toBe(true);
  });

  it('同类型同张数才可比', () => {
    expect(canBeat(one('S9 H9'), one('S3'))).toBe(false);
    expect(canBeat(one('S4 H5 D6 C7 D8'), one('S3 H4 D5 C6 D7'))).toBe(true);
    expect(canBeat(one('S3 H4 D5 C6 D7'), one('SA H2 D3 C4 D5'))).toBe(true);
  });
});

describe('枚举与 AI', () => {
  it('枚举的每个出法都能被识别', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = new GuandanGame();
      g.levels = [((seed % 13) + 2), 2];
      g.startRound(seed);
      const hand = g.hands[0];
      for (const c of findAllPlays(hand, g.level)) {
        const parsed = parseCombos(c.cards, g.level);
        expect(parsed.some((p) => p.type === c.type), `${c.type} ${c.cards}`).toBe(true);
      }
    }
  });

  it('拆牌覆盖所有手牌且每组合法', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = new GuandanGame();
      g.startRound(seed);
      const hand = g.hands[1];
      const sp = bestSplit(hand, g.level);
      expect(sp.combos.flatMap((c) => c.cards).sort()).toEqual([...hand].sort());
      for (const c of sp.combos) {
        expect(parseCombos(c.cards, g.level).some((p) => p.type === c.type), `${c.type}`).toBe(true);
      }
    }
  });

  it('还贡选 10 及以下', () => {
    const hand = ids('SA HK D3 C9 D9 S9');
    expect(card(returnCard(hand, 2)).rank).toBeLessThanOrEqual(10);
  });
});

describe('整局流程（4 个 AI）', () => {
  it('能打完多局直到过 A', () => {
    const g = new GuandanGame();
    let rounds = 0;
    let gameOver = false;
    g.on((e) => {
      if (e.type === 'roundEnd') { rounds++; gameOver = e.result.gameOver; }
    });
    const t0 = Date.now();
    let seed = 1;
    while (!gameOver && rounds < 80) {
      g.startRound(seed++);
      let guard = 0;
      while (g.phase === 'return') {
        const p = g.pendingReturns[0];
        expect(g.returnTribute(p.from, returnCard(g.hands[p.from], g.level))).toBeNull();
      }
      while (g.phase === 'play') {
        if (++guard > 2000) throw new Error('死循环');
        const s = g.turn;
        const c = aiPlay({
          seat: s, hand: g.hands[s], level: g.level,
          target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, handCounts: g.handCounts(),
        });
        const err = c ? g.play(s, c.cards, c) : g.pass(s);
        expect(err).toBeNull();
      }
      const total = g.hands.reduce((a, h) => a + h.length, 0);
      expect(total).toBeLessThanOrEqual(108);
    }
    expect(gameOver).toBe(true);
    console.log(`打完一整盘：${rounds} 局，用时 ${Date.now() - t0}ms，等级 ${g.levels}，胜方 ${teamOf(g.prevOrder![0])}`);
  }, 120000);
});
