// 拟合中盘局面评分：电脑自我对打，在每一轮结束（下一手是首出）时记录局面特征，
// 用线性回归预测这一局最后的团队结果（该队净升级），得到各特征的权重。
//
// 用法：npx tsx scripts/fit-eval.ts [局数]
import { GuandanGame, teamOf, partnerOf } from '../shared/game';
import { aiPlay } from '../shared/ai';
import { evalFeatures, EVAL_FEATURES } from '../shared/mc';

const N = Number(process.argv[2] ?? 3000);
const X: number[][] = [];
const y: number[] = [];

for (let i = 0; i < N; i++) {
  const g = new GuandanGame();
  g.levels = [2 + (i % 13), 2 + (i % 13)];
  g.startRound(700000 + i);
  const samples: { f: number[]; team: number }[] = [];
  let guard = 0;
  while (g.phase === 'play' && guard++ < 3000) {
    // 每轮开始（首出）时记录一次，两队视角各一条
    if (!g.lastPlay && g.finishOrder.length < 2) {
      for (const team of [0, 1]) samples.push({ f: evalFeatures(g.hands, g.level, team, g.turn, g.finishOrder), team });
    }
    const s = g.turn;
    const c = aiPlay({ seat: s, hand: g.hands[s], level: g.level, target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, handCounts: g.handCounts() });
    if (c) g.play(s, c.cards, c); else g.pass(s);
  }
  const o = g.prevOrder!;
  const up = [0, 3, 2, 1][o.indexOf(partnerOf(o[0]))];
  for (const sm of samples) {
    X.push([1, ...sm.f]);
    y.push(teamOf(o[0]) === sm.team ? up : -up);
  }
}

// 最小二乘：解 (XᵀX + λI) w = Xᵀy
const d = X[0].length;
const A = Array.from({ length: d }, () => new Array(d).fill(0));
const b = new Array(d).fill(0);
for (let r = 0; r < X.length; r++) {
  for (let i = 0; i < d; i++) {
    b[i] += X[r][i] * y[r];
    for (let j = 0; j < d; j++) A[i][j] += X[r][i] * X[r][j];
  }
}
for (let i = 1; i < d; i++) A[i][i] += 1e-3 * X.length;
for (let i = 0; i < d; i++) { // 高斯消元
  let p = i;
  for (let r = i + 1; r < d; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
  [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
  for (let r = 0; r < d; r++) {
    if (r === i) continue;
    const f = A[r][i] / A[i][i];
    for (let c = i; c < d; c++) A[r][c] -= f * A[i][c];
    b[r] -= f * b[i];
  }
}
const w = b.map((v, i) => v / A[i][i]);
const pred = X.map((x) => x.reduce((s, v, i) => s + v * w[i], 0));
const mean = y.reduce((s, v) => s + v, 0) / y.length;
const ssTot = y.reduce((s, v) => s + (v - mean) ** 2, 0);
const ssRes = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
console.log(`样本 ${X.length} 条（${N} 局），R² = ${(1 - ssRes / ssTot).toFixed(3)}`);
console.log('权重：');
console.log(`  常数项: ${w[0].toFixed(4)}`);
EVAL_FEATURES.forEach((name, i) => console.log(`  ${name}: ${w[i + 1].toFixed(4)}`));
console.log('\nEVAL_WEIGHTS = ' + JSON.stringify(w.map((v) => Number(v.toFixed(4)))));
