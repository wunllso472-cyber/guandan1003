import { it } from 'vitest';
import { GuandanGame, teamOf } from '../shared/game';
import { aiPlay } from '../shared/ai';
import { findAllPlays, playOrderKey } from '../shared/finder';

it('AI 对比简单策略', () => {
  let wins = [0, 0];
  for (let seed = 1; seed <= 300; seed++) {
    const g = new GuandanGame();
    g.startRound(seed);
    while (g.phase === 'play') {
      const s = g.turn;
      const target = g.lastPlay?.combo ?? null;
      let c;
      if (teamOf(s) === 0) {
        c = aiPlay({ seat: s, hand: g.hands[s], level: g.level, target, targetSeat: g.lastPlay?.seat ?? null, handCounts: g.handCounts() });
      } else {
        const all = findAllPlays(g.hands[s], g.level, target).sort((a, b) => playOrderKey(a) - playOrderKey(b));
        c = all[0] ?? null;
      }
      if (c) g.play(s, c.cards, c); else g.pass(s);
    }
    wins[teamOf(g.prevOrder![0])]++;
  }
  console.log('AI 头游次数 vs 简单策略:', wins);
}, 120000);
