// 策略评估：两种出牌策略对打，按团队结果统计。
//
// 用法：npx tsx scripts/bench.ts <A策略> <B策略> [局数] [起始种子]
//   策略：ai（原电脑） | advisor（本地提示第一推荐） | jev（Jev 推荐，置信度不足时用本地提示；会消耗 Jev 额度）
//         | mc（蒙特卡洛：顾问前 GD_MC_K 个候选各模拟 GD_MC_SAMPLES 种牌局，选团队结果最好的）
//         | auto（托管：shared/autoplay.ts 的 smartPlay，每手模拟时间预算 GD_AUTO_BUDGET 毫秒，默认 300）
//   例：npx tsx scripts/bench.ts advisor ai 2000
//
// 每副牌两队交换座位各打一次（配对比较），抵消牌运差异。
// 主指标是“每局净升级”：A 队赢一局记 +3/+2/+1（双上/一三/一四），输一局记 −3/−2/−1。
import { GuandanGame, teamOf, partnerOf } from '../shared/game';
import { aiPlay } from '../shared/ai';
import { advise, buildJevContext } from '../shared/advisor';
import { CardTracker } from '../shared/tracker';
import type { Combo } from '../shared/combo';
import { monteCarlo, monteCarloShallow, mcStateFrom } from '../shared/mc';
import { smartPlay } from '../shared/autoplay';
import { writeFileSync } from 'node:fs';

const MC_K = Number(process.env.GD_MC_K ?? 4);
const MC_SAMPLES = Number(process.env.GD_MC_SAMPLES ?? 40);
/** 只在场上剩余牌数不超过这个值时模拟（残局） */
const MC_MAXCARDS = Number(process.env.GD_MC_MAXCARDS ?? 40);
/** 模拟结果比顾问首选好出这么多，才推翻首选 */
const MC_MARGIN = Number(process.env.GD_MC_MARGIN ?? 0.25);
const MC_POLICY = (process.env.GD_MC_POLICY ?? 'ai') as 'ai' | 'quick';
/** 中盘也模拟（浅层推演 + 局面评分）：GD_MC_MID=1 */
const MC_MID = process.env.GD_MC_MID === '1';
const MC_MID_SAMPLES = Number(process.env.GD_MC_MID_SAMPLES ?? 30);
const MC_MID_MARGIN = Number(process.env.GD_MC_MID_MARGIN ?? 0.2);

export type Strategy = 'ai' | 'advisor' | 'jev' | 'mc' | 'auto';
const AUTO_BUDGET = Number(process.env.GD_AUTO_BUDGET ?? 300);
type Ctx = { seat: number; g: GuandanGame; tracker: CardTracker };

const JEV_MIN_CONFIDENCE = 0.6;

async function choose(strategy: Strategy, { seat, g, tracker }: Ctx): Promise<Combo | null> {
  const target = g.lastPlay?.combo ?? null, targetSeat = g.lastPlay?.seat ?? null;
  if (strategy === 'ai') return aiPlay({ seat, hand: g.hands[seat], level: g.level, target, targetSeat, handCounts: g.handCounts() });
  if (strategy === 'auto') return smartPlay({ seat, hand: g.hands[seat], level: g.level, target, targetSeat, counts: g.handCounts(), tracker }, AUTO_BUDGET);
  const inp = { seat, hand: g.hands[seat], level: g.level, target, targetSeat, counts: g.handCounts(), tracker };
  const adv = advise(inp);
  const onTable = g.handCounts().reduce((a, b) => a + b, 0);
  if (strategy === 'mc' && adv.options.length > 1 && onTable <= MC_MAXCARDS) {
    const top = adv.options.slice(0, MC_K);
    const r = monteCarlo(mcStateFrom(inp), top.map((o) => o.combo), 1e9, MC_SAMPLES, g.roundNo * 1000 + g.hands[seat].length, MC_POLICY);
    // 只有明显比顾问首选好，才换成模拟结果最好的出法
    let best = 0;
    r.scores.forEach((v, i) => { if (v > r.scores[best] + 1e-9) best = i; });
    return r.scores[best] - r.scores[0] >= MC_MARGIN ? top[best].combo : top[0].combo;
  }
  if (strategy === 'mc' && MC_MID && adv.options.length > 1) {
    const top = adv.options.slice(0, MC_K);
    const r = monteCarloShallow(mcStateFrom(inp), top.map((o) => o.combo), 1e9, MC_MID_SAMPLES, g.roundNo * 1000 + g.hands[seat].length);
    let best = 0;
    r.scores.forEach((v, i) => { if (v > r.scores[best] + 1e-9) best = i; });
    return r.scores[best] - r.scores[0] >= MC_MID_MARGIN ? top[best].combo : top[0].combo;
  }
  if (strategy === 'jev' && adv.options.length > 1) {
    const { adviseDirect } = await import('../server/jev');
    try {
      const r = await adviseDirect(buildJevContext(inp, adv), 8000);
      if (r.ranking?.length && (r.confidence ?? 0) >= JEV_MIN_CONFIDENCE) {
        return adv.options.find((o) => o.id === r.ranking![0])?.combo ?? adv.options[0].combo;
      }
    } catch { /* 失败时用本地提示 */ }
  }
  return adv.options[0].combo;
}

export interface BenchResult {
  rounds: number;
  /** A 队每局净升级的均值与 95% 置信区间半宽 */
  net: number; netCI: number;
  winRate: number;
  avgWin: number;   // 赢时平均升级
  avgLoss: number;  // 输时平均输掉的级数（越小越好）
  doubleWin: number;  // 双上率
  doubleLoss: number; // 被双下率
}

export async function bench(a: Strategy, b: Strategy, n: number, seed = 200000, parallel = 1, onProgress?: (done: number) => void): Promise<BenchResult> {
  const nets: number[] = [];
  let next = 0;
  async function playOne(i: number) {
    const aTeam = i % 2; // 同一副牌两队各坐一次
    const g = new GuandanGame();
    g.levels = [2 + (Math.floor(i / 2) % 13), 2 + (Math.floor(i / 2) % 13)];
    const trackers = [0, 1, 2, 3].map((s) => new CardTracker(s));
    g.on((e) => trackers.forEach((t) => t.apply(e)));
    g.startRound(seed + Math.floor(i / 2));
    let guard = 0;
    while (g.phase === 'play' && guard++ < 3000) {
      const s = g.turn;
      const c = await choose(teamOf(s) === aTeam ? a : b, { seat: s, g, tracker: trackers[s] });
      const err = c ? g.play(s, c.cards, c) : g.pass(s);
      if (err) throw new Error(err);
    }
    const o = g.prevOrder!;
    const up = [0, 3, 2, 1][o.indexOf(partnerOf(o[0]))];
    nets[i] = teamOf(o[0]) === aTeam ? up : -up;
    onProgress?.(nets.filter((x) => x !== undefined).length);
  }
  await Promise.all(Array.from({ length: parallel }, async () => { while (next < n) await playOne(next++); }));
  if (process.env.GD_DUMP) writeFileSync(process.env.GD_DUMP, JSON.stringify(nets));
  const mean = nets.reduce((s, x) => s + x, 0) / n;
  // 配对样本：同一副牌的两局合成一个观测，方差更小
  const pairs: number[] = [];
  for (let i = 0; i + 1 < n; i += 2) pairs.push((nets[i] + nets[i + 1]) / 2);
  const pm = pairs.reduce((s, x) => s + x, 0) / pairs.length;
  const sd = Math.sqrt(pairs.reduce((s, x) => s + (x - pm) ** 2, 0) / Math.max(1, pairs.length - 1));
  const wins = nets.filter((x) => x > 0), losses = nets.filter((x) => x < 0);
  return {
    rounds: n, net: mean, netCI: 1.96 * sd / Math.sqrt(pairs.length),
    winRate: wins.length / n,
    avgWin: wins.reduce((s, x) => s + x, 0) / Math.max(1, wins.length),
    avgLoss: -losses.reduce((s, x) => s + x, 0) / Math.max(1, losses.length),
    doubleWin: nets.filter((x) => x === 3).length / n,
    doubleLoss: nets.filter((x) => x === -3).length / n,
  };
}

export function formatResult(a: string, b: string, r: BenchResult): string {
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  return [
    `${a} 对 ${b}，共 ${r.rounds} 局（每副牌交换座位各一次）`,
    `  每局净升级：${r.net >= 0 ? '+' : ''}${r.net.toFixed(3)}（95% 区间 ±${r.netCI.toFixed(3)}）${Math.abs(r.net) > r.netCI ? '  ← 差异显著' : '  （差异不显著）'}`,
    `  胜局率 ${pct(r.winRate)}；赢时平均 +${r.avgWin.toFixed(2)} 级；输时平均 −${r.avgLoss.toFixed(2)} 级`,
    `  双上 ${pct(r.doubleWin)}；被双下 ${pct(r.doubleLoss)}`,
  ].join('\n');
}

// 命令行入口
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/bench.ts')) {
  const [a = 'advisor', b = 'ai', n = '1000', seed = '200000'] = process.argv.slice(2);
  // 评估用：GD_DISABLE_BOOK=1 停用教材规则库（shared/rulebook.ts）
  if (process.env.GD_DISABLE_BOOK === '1') {
    const { bookSwitch } = await import('../shared/rulebook');
    bookSwitch.enabled = false;
    console.log('停用教材规则库');
  }
  // 评估用：GD_DISABLE_RULES=BOMB_PURPOSE,LAST_HAND 临时停用规则库中的规则（ALL 表示全部）
  if (process.env.GD_DISABLE_RULES) {
    const { disabledRules, RULES } = await import('../shared/strategy');
    const list = process.env.GD_DISABLE_RULES === 'ALL' ? Object.keys(RULES) : process.env.GD_DISABLE_RULES.split(',');
    list.forEach((r) => disabledRules.add(r.trim()));
    console.log('停用规则：' + list.join(','));
  }
  const parallel = Number(process.env.GD_PARALLEL ?? (a === 'jev' || b === 'jev' ? 4 : 1));
  const r = await bench(a as Strategy, b as Strategy, Number(n), Number(seed), parallel);
  console.log(formatResult(a, b, r));
}
