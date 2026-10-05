// 猜牌准确率：电脑自我对打，在每个决策点用模拟的“推测手牌”对比另外三家的真实手牌，
// 比较均匀随机分配和按出牌线索加权分配，猜对的张数占比（同花色同点数的两张算同一种）。
// 用法：npx tsx scripts/infer-accuracy.ts [局数]
//   GD_LACKS=1：改为模拟上一局的名次（进贡/抗贡），比较推测时“不用 / 用”确定不在某家手里的牌（tracker.lacks）
import { GuandanGame, teamOf } from '../shared/game';
import { aiPlay } from '../shared/ai';
import { CardTracker } from '../shared/tracker';
import { card, cardValue, shuffle } from '../shared/cards';
import { determinize, mcInfer, mcStateFrom } from '../shared/mc';
import { smartReturn } from '../shared/tribute';

const N = Number(process.argv[2] ?? 60);
const LACKS = process.env.GD_LACKS === '1';
// GD_INFER_K=0.3 统一设置各牌型的分量（测试加权方向是否正确）
if (process.env.GD_GAP_W) mcInfer.gapWeight = Number(process.env.GD_GAP_W);
if (process.env.GD_USE_PASSES) mcInfer.usePasses = process.env.GD_USE_PASSES === '1';
if (process.env.GD_INFER_K) for (const t of Object.keys(mcInfer.weight) as (keyof typeof mcInfer.weight)[]) mcInfer.weight[t] = Number(process.env.GD_INFER_K);
const SAMPLES = 20;
const key = (id: number) => `${card(id).suit}${card(id).rank}`;

function overlap(guess: number[], truth: number[], filter: (id: number) => boolean): [number, number] {
  const m = new Map<string, number>();
  for (const id of truth) if (filter(id)) m.set(key(id), (m.get(key(id)) ?? 0) + 1);
  let hit = 0, total = 0;
  for (const n of m.values()) total += n;
  for (const id of guess) {
    if (!filter(id)) continue;
    const n = m.get(key(id)) ?? 0;
    if (n > 0) { hit++; m.set(key(id), n - 1); }
  }
  return [hit, total];
}

const acc = { uniform: [0, 0, 0, 0], weighted: [0, 0, 0, 0] };
let points = 0, withClues = 0;
for (let i = 0; i < N; i++) {
  const g = new GuandanGame();
  const tr = [0, 1, 2, 3].map((s) => new CardTracker(s));
  g.on((e) => tr.forEach((t) => t.apply(e)));
  if (LACKS) g.prevOrder = shuffle([0, 1, 2, 3], 7000 + i);
  g.startRound(40000 + i);
  while (g.phase === 'return') {
    const pr = g.pendingReturns[0];
    g.returnTribute(pr.from, smartReturn(g.hands[pr.from], g.level, teamOf(pr.from) === teamOf(pr.to)));
  }
  let guard = 0;
  while (g.phase === 'play' && guard++ < 3000) {
    const s = g.turn;
    const inp = { seat: s, hand: g.hands[s], level: g.level, target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, counts: g.handCounts(), tracker: tr[s] };
    const st = mcStateFrom(inp);
    const hasLacks = st.lacks?.some((l, o) => o !== s && l.length > 0);
    if (LACKS ? hasLacks : st.passed?.length || st.gaps?.length) {
      withClues++;
      const big = (id: number) => cardValue(id, g.level) >= 13;
      for (const [mode, enabled] of [['uniform', false], ['weighted', true]] as const) {
        mcInfer.enabled = LACKS ? false : enabled;
        const lacks = st.lacks;
        if (LACKS && !enabled) st.lacks = undefined;
        for (let k = 0; k < SAMPLES; k++) {
          const hands = determinize(st, 1000 * points + k);
          if (!hands) continue;
          for (let o = 0; o < 4; o++) {
            if (o === s || !g.hands[o].length) continue;
            const [h1, t1] = overlap(hands[o], g.hands[o], () => true);
            const [h2, t2] = overlap(hands[o], g.hands[o], big);
            acc[mode][0] += h1; acc[mode][1] += t1; acc[mode][2] += h2; acc[mode][3] += t2;
          }
        }
        st.lacks = lacks;
      }
      mcInfer.enabled = true;
    }
    points++;
    const c = aiPlay({ seat: s, hand: g.hands[s], level: g.level, target: inp.target, targetSeat: inp.targetSeat, handCounts: inp.counts });
    if (c) g.play(s, c.cards, c); else g.pass(s);
  }
}
const pct = (a: number[], i: number) => ((100 * a[i]) / a[i + 1]).toFixed(2) + '%';
console.log(`${N} 局，决策点 ${points}，其中有${LACKS ? '进贡/抗贡约束' : '出牌线索'} ${withClues}（每点 ${SAMPLES} 次推测）`);
console.log(`  均匀随机：全部牌猜对 ${pct(acc.uniform, 0)}，K 以上大牌猜对 ${pct(acc.uniform, 2)}`);
console.log(`  ${LACKS ? '用确定没有的牌' : '线索加权'}：全部牌猜对 ${pct(acc.weighted, 0)}，K 以上大牌猜对 ${pct(acc.weighted, 2)}`);
