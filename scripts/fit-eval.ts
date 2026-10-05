// 拟合中盘局面评分：电脑自我对打，在每一轮结束（下一手是首出）时记录局面特征，
// 用线性回归预测这一局最后的团队结果（该队净升级），得到各特征的权重。
//
// 用法：npx tsx scripts/fit-eval.ts [局数]     GD_EVAL=v1 只用第一版的 9 个特征（默认 v2）
// 每 5 局拿 1 局作验证（不参与拟合），分别报告拟合集和验证集的 R²。
import { GuandanGame, teamOf, partnerOf } from '../shared/game';
import { aiPlay } from '../shared/ai';
import { evalFeatures, EVAL_FEATURES, EVAL_FEATURES_V1 } from '../shared/mc';

const N = Number(process.argv[2] ?? 3000);
const VERSION = (process.env.GD_EVAL ?? 'v2') as 'v1' | 'v2';
const NAMES = VERSION === 'v1' ? EVAL_FEATURES_V1 : EVAL_FEATURES;
const X: number[][] = [];
const y: number[] = [];
const Xv: number[][] = [];
const yv: number[] = [];

for (let i = 0; i < N; i++) {
  const g = new GuandanGame();
  g.levels = [2 + (i % 13), 2 + (i % 13)];
  g.startRound(700000 + i);
  const samples: { f: number[]; team: number }[] = [];
  let guard = 0;
  while (g.phase === 'play' && guard++ < 3000) {
    // 每轮开始（首出）时记录一次，两队视角各一条
    if (!g.lastPlay && g.finishOrder.length < 2) {
      for (const team of [0, 1]) samples.push({ f: evalFeatures(g.hands, g.level, team, g.turn, g.finishOrder, VERSION), team });
    }
    const s = g.turn;
    const c = aiPlay({ seat: s, hand: g.hands[s], level: g.level, target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, handCounts: g.handCounts() });
    if (c) g.play(s, c.cards, c); else g.pass(s);
  }
  const o = g.prevOrder!;
  const up = [0, 3, 2, 1][o.indexOf(partnerOf(o[0]))];
  const hold = i % 5 === 4;
  for (const sm of samples) {
    (hold ? Xv : X).push([1, ...sm.f]);
    (hold ? yv : y).push(teamOf(o[0]) === sm.team ? up : -up);
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
const r2 = (xs: number[][], ys: number[]) => {
  const pred = xs.map((x) => x.reduce((s, v, i) => s + v * w[i], 0));
  const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
  const ssTot = ys.reduce((s, v) => s + (v - mean) ** 2, 0);
  const ssRes = ys.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  return 1 - ssRes / ssTot;
};
console.log(`${VERSION}：拟合 ${X.length} 条、验证 ${Xv.length} 条（${N} 局），拟合集 R² = ${r2(X, y).toFixed(3)}，验证集 R² = ${r2(Xv, yv).toFixed(3)}`);
console.log('权重：');
console.log(`  常数项: ${w[0].toFixed(4)}`);
NAMES.forEach((name, i) => console.log(`  ${name}: ${w[i + 1].toFixed(4)}`));
console.log('\nEVAL_WEIGHTS = ' + JSON.stringify(w.map((v) => Number(v.toFixed(4)))));
