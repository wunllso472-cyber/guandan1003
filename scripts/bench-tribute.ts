// 贡牌/还贡规则评估：先打一局定出名次，第二局进贡还贡时一队用新规则（shared/tribute.ts），另一队用原来的选法，
// 之后四家都按电脑出牌打完。同一组牌两队交换各打一次（配对），统计用新规则一队的净升级。
//
// 用法：npx tsx scripts/bench-tribute.ts [组数] [起始种子]
import { GuandanGame, teamOf, partnerOf } from '../shared/game';
import { aiPlay, returnCard, tributeCard } from '../shared/ai';
import { smartReturn } from '../shared/tribute';
import { card } from '../shared/cards';

/** 两副牌同花色同点数的两张等价 */
const same = (a: number, b: number) => card(a).suit === card(b).suit && card(a).rank === card(b).rank;

const N = Number(process.argv[2] ?? 1000);
const SEED = Number(process.argv[3] ?? 900000);

function playOut(g: GuandanGame) {
  let guard = 0;
  while (g.phase === 'play' && guard++ < 3000) {
    const s = g.turn;
    const c = aiPlay({ seat: s, hand: g.hands[s], level: g.level, target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, handCounts: g.handCounts() });
    if (c) g.play(s, c.cards, c); else g.pass(s);
  }
}

/** smartTeam 用新规则时，第二局 smartTeam 的净升级；另返回这一局贡牌/还贡是否和原选法不同 */
function run(i: number, smartTeam: number): { net: number; changed: number; any: boolean } {
  const g = new GuandanGame();
  g.levels = [2 + (i % 13), 2 + ((i * 7) % 13)];
  g.startRound(SEED + i * 2);
  playOut(g);
  for (const s of [0, 1, 2, 3]) if (teamOf(s) !== smartTeam) g.basicTributeSeats.add(s);
  // 统计新规则实际改变了几次选择（进贡在发牌后由引擎完成，这里按进贡前的手牌重算一遍原选法）
  let changed = 0, any = false;
  g.on((e) => {
    if (e.type !== 'tribute') return;
    any = true;
    for (const t of e.list) {
      if (teamOf(t.from) !== smartTeam) continue;
      const before = [...g.hands[t.from], t.card];
      if (!same(tributeCard(before, g.level), t.card)) changed++;
    }
  });
  g.startRound(SEED + i * 2 + 1);
  while (g.phase === 'return' && g.pendingReturns.length) {
    const p = g.pendingReturns[0];
    const basic = returnCard(g.hands[p.from], g.level);
    const id = teamOf(p.from) === smartTeam ? smartReturn(g.hands[p.from], g.level, teamOf(p.from) === teamOf(p.to)) : basic;
    if (!same(id, basic)) changed++;
    g.returnTribute(p.from, id);
  }
  playOut(g);
  const o = g.prevOrder!;
  const up = [0, 3, 2, 1][o.indexOf(partnerOf(o[0]))];
  return { net: teamOf(o[0]) === smartTeam ? up : -up, changed, any };
}

const pairs: number[] = [];
let changed = 0, withTribute = 0;
for (let i = 0; i < N; i++) {
  const a = run(i, 0), b = run(i, 1);
  pairs.push((a.net + b.net) / 2);
  if (a.any) withTribute++;
  changed += a.changed + b.changed;
}
const m = pairs.reduce((s, x) => s + x, 0) / pairs.length;
const sd = Math.sqrt(pairs.reduce((s, x) => s + (x - m) ** 2, 0) / (pairs.length - 1));
console.log(`贡牌规则评估：${N} 组（每组交换使用新规则的队各打一次）`);
console.log(`  有进贡的组 ${withTribute}，新规则改变选择 ${changed} 次（共 ${2 * N} 局）`);
console.log(`  新规则一队每局净升级：${m >= 0 ? '+' : ''}${m.toFixed(3)}（95% 区间 ±${(1.96 * sd / Math.sqrt(pairs.length)).toFixed(3)}）`);
