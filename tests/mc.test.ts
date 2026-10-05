import { describe, it, expect } from 'vitest';
import { DECK, ALL_IDS, type Suit } from '../shared/cards';
import { parseCombos } from '../shared/combo';
import { determinize, monteCarlo, type MCState } from '../shared/mc';
import { mcCandidates, MC_K } from '../shared/autoplay';

function ids(spec: string, used = new Set<number>()): number[] {
  return spec.split(/\s+/).filter(Boolean).map((t) => {
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(1)] ?? Number(t.slice(1));
    const f = DECK.find((c) => c.suit === (t[0] as Suit) && c.rank === rank && !used.has(c.id))!;
    used.add(f.id);
    return f.id;
  });
}

function state(hand: number[], counts: number[], extra: Partial<MCState> = {}): MCState {
  return {
    seat: 0, level: 2, hand, counts,
    unseen: ALL_IDS.filter((id) => !hand.includes(id)),
    known: [[], [], [], []], finishOrder: [], lastPlay: null, passCount: 0, ...extra,
  };
}

describe('蒙特卡洛模拟', () => {
  it('手册牌例04：对家和下家都只剩 1 张时，模拟认为出 7 比出 3 好', () => {
    const hand = ids('S3 S7 C7');
    const [three, seven] = [parseCombos([hand[0]], 2)[0], parseCombos([hand[1]], 2)[0]];
    const r = monteCarlo(state(hand, [3, 1, 1, 2]), [three, seven], 1e9, 200, 3);
    expect(r.samples).toBe(200);
    expect(r.scores[1]).toBeGreaterThan(r.scores[0]);
  });

  it('能一手出完的出法得分最高', () => {
    const hand = ids('S9 C9');
    const target = parseCombos(ids('D5 H5'), 2)[0];
    const st = state(hand, [2, 10, 10, 10], { lastPlay: { seat: 1, combo: target } });
    const r = monteCarlo(st, [parseCombos(hand, 2)[0], null], 1e9, 50, 5);
    expect(r.scores[0]).toBeGreaterThan(r.scores[1]);
  });

  it('进贡亮过的牌一定分给对应的人；张数对不上时跳过该样本', () => {
    const hand = ids('S3 S4');
    const bigJoker = DECK.find((c) => c.rank === 17)!.id;
    // 下家确定有大王：他只剩 1 张，那张一定是大王 → 首出单张 3 一定被大王压住
    const st = state(hand, [2, 1, 20, 20], { known: [[], [bigJoker], [], []] });
    const r = monteCarlo(st, [parseCombos([hand[0]], 2)[0]], 1e9, 30, 9);
    expect(r.samples).toBe(30);
    expect(r.scores[0]).toBeLessThan(0); // 下家必然走掉头游
  });

  it('带随机的推演（noisy）：同一种子结果相同，能一手出完的出法仍然最好', () => {
    const hand = ids('S9 C9');
    const target = parseCombos(ids('D5 H5'), 2)[0];
    const st = state(hand, [2, 10, 10, 10], { lastPlay: { seat: 1, combo: target } });
    const moves = [parseCombos(hand, 2)[0], null];
    const a = monteCarlo(st, moves, 1e9, 30, 5, 'noisy');
    const b = monteCarlo(st, moves, 1e9, 30, 5, 'noisy');
    expect(a.scores).toEqual(b.scores);
    expect(a.scores[0]).toBeGreaterThan(a.scores[1]);
  });

  it('确定不在某人手里的牌（进贡约束、抗贡）不会分给他', () => {
    const hand = ids('S3 S4');
    const unseen = ALL_IDS.filter((id) => !hand.includes(id));
    // 下家进贡过 9：比 9 大的非逢人配牌都不在他手里（级牌 2，逢人配为红桃 2）
    const big = unseen.filter((id) => DECK[id].rank > 9 && !(DECK[id].suit === 'H' && DECK[id].rank === 2) || (DECK[id].rank === 2 && DECK[id].suit !== 'H'));
    const st = state(hand, [2, 30, 34, 40], { lacks: [[], big, [], []] });
    let ok = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const h = determinize(st, seed);
      if (!h) continue;
      ok++;
      expect(h[1].length).toBe(30);
      expect(h[1].some((id) => big.includes(id))).toBe(false);
      expect(h[2].length + h[3].length).toBe(74);
    }
    expect(ok).toBe(50);
  });

  it('模拟候选：前 4 个之外按顺序补上没出现过的牌型（含不出）', () => {
    const o = (type: string | null, n = 1) => ({ combo: type ? { type, cards: new Array(n).fill(0), value: 0 } as never : null });
    const opts = [o('single'), o('single'), o('single'), o('single'), o('single'), o('pair', 2), o('pair', 2), o(null), o('straight', 5)];
    expect(mcCandidates(opts, 0)).toHaveLength(MC_K);
    const c = mcCandidates(opts, 2);
    expect(c.slice(MC_K)).toEqual([opts[5], opts[7]]);
  });
});
