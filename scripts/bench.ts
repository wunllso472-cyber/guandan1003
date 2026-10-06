// 策略评估：两种出牌策略对打，按团队结果统计。
//
// 用法：npx tsx scripts/bench.ts <A策略> <B策略> [局数] [起始种子]
//   策略：ai（原电脑） | advisor（本地提示第一推荐） | jev（Jev 推荐，置信度不足时用本地提示；会消耗 Jev 额度）
//         | mc（蒙特卡洛：顾问前 GD_MC_K 个候选各模拟 GD_MC_SAMPLES 种牌局，选团队结果最好的）
//         | auto（托管：shared/autoplay.ts 的 smartPlay，每手模拟时间预算 GD_AUTO_BUDGET 毫秒，默认 300）
//   例：npx tsx scripts/bench.ts advisor ai 2000
//   策略名后加 ~old：该队出牌时关闭 shared/ai.ts 的 bombGuard（跟牌不拆炸弹）和 shared/autoplay.ts 的 mcLowSample（样本不足但差距大时采纳模拟），
//   例：ai ai~old、advisor advisor~old、auto auto~old（之前评估过 bombAlt、splitSafeRule，结论见各自注释）
//
// 每副牌两队交换座位各打一次（配对比较），抵消牌运差异。
// GD_TRIBUTE=1：每局按随机的“上一局名次”先进贡/还贡（或抗贡）再开打；GD_NO_LACKS=1：mc 推测手牌时不用进贡/抗贡得到的硬约束。
// 主指标是“每局净升级”：A 队赢一局记 +3/+2/+1（双上/一三/一四），输一局记 −3/−2/−1。
import { GuandanGame, teamOf, partnerOf } from '../shared/game';
import { shuffle } from '../shared/cards';
import { smartReturn } from '../shared/tribute';
import { aiPlay, bombGuard } from '../shared/ai';
import { advise, buildJevContext } from '../shared/advisor';
import { CardTracker } from '../shared/tracker';
import type { Combo } from '../shared/combo';
import { monteCarlo, monteCarloShallow, mcStateFrom as mcStateOf, rolloutNoise, evalModel, shallowDepth, EVAL_WEIGHTS_V1, type RolloutPolicy } from '../shared/mc';
import { smartPlay, mcConfigFor, pickByMC, mcTies, mcCandidates, mcExtra, MC_END, MC_MID as MID_CFG, mcStage, mcLowSample } from '../shared/autoplay';
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

export type Strategy = 'ai' | 'advisor' | 'jev' | 'mc' | 'auto' | 'mcjev';
const TRIBUTE = process.env.GD_TRIBUTE === '1';
const NO_LACKS = process.env.GD_NO_LACKS === '1';
const AUTO_BUDGET = Number(process.env.GD_AUTO_BUDGET ?? 300);
type Ctx = { seat: number; g: GuandanGame; tracker: CardTracker };

const JEV_MIN_CONFIDENCE = 0.6;
/** mcjev：GD_NO_JEV=1 时拿不准也不请 Jev（对照组，同时统计会请几次） */
const NO_JEV = process.env.GD_NO_JEV === '1';
/** mcjev 的推演方式：GD_ROLLOUT 残局（默认 ai）、GD_SHALLOW_ROLLOUT 中盘（默认 quick），可选 quick / ai / noisy；GD_NOISE 为 noisy 的随机程度 */
const ROLLOUT = (process.env.GD_ROLLOUT ?? 'ai') as RolloutPolicy;
const SHALLOW_ROLLOUT = (process.env.GD_SHALLOW_ROLLOUT ?? 'quick') as RolloutPolicy;
if (process.env.GD_NOISE) rolloutNoise.eps = Number(process.env.GD_NOISE);
/** 模拟候选：GD_MC_EXTRA 在前 4 个之外补几个不同类型的候选；GD_MC_EQUAL_COST=1 按候选数减少样本，使总计算量与 4 个候选相同 */
if (process.env.GD_MC_EXTRA) mcExtra.n = Number(process.env.GD_MC_EXTRA);
const EQUAL_COST = process.env.GD_MC_EQUAL_COST === '1';
/** 托管/mcjev 的模拟设置：GD_END_MARGIN、GD_MID_MARGIN 推翻顾问首选的门槛，GD_END_SAMPLES、GD_MID_SAMPLES 样本数，GD_STAGE_CARDS 残局界限 */
if (process.env.GD_END_MARGIN) MC_END.margin = Number(process.env.GD_END_MARGIN);
if (process.env.GD_MID_MARGIN) MID_CFG.margin = Number(process.env.GD_MID_MARGIN);
if (process.env.GD_END_SAMPLES) MC_END.samples = Number(process.env.GD_END_SAMPLES);
if (process.env.GD_MID_SAMPLES) MID_CFG.samples = Number(process.env.GD_MID_SAMPLES);
/** GD_AI_TAKE=N：对手剩 N 张以内时用外面压不住的牌收回出牌权（shared/ai.ts 的 aiTake） */
if (process.env.GD_AI_TAKE) { const { aiTake } = await import('../shared/ai'); aiTake.cards = Number(process.env.GD_AI_TAKE); }
if (process.env.GD_DEPTH) shallowDepth.tricks = Number(process.env.GD_DEPTH);
if (process.env.GD_STAGE_CARDS) mcStage.maxCards = Number(process.env.GD_STAGE_CARDS);
/** 中盘局面评分：默认第二版（加入控制牌特征）；GD_EVAL=v1 用第一版 */
if (process.env.GD_EVAL === 'v1') { evalModel.version = 'v1'; evalModel.weights = EVAL_WEIGHTS_V1; }
export const jevStats = { decisions: 0, ties: 0, calls: 0, adopted: 0, changed: 0, failed: 0 };

async function choose(strategy: Strategy, { seat, g, tracker }: Ctx): Promise<Combo | null> {
  const target = g.lastPlay?.combo ?? null, targetSeat = g.lastPlay?.seat ?? null;
  if (strategy === 'ai') return aiPlay({ seat, hand: g.hands[seat], level: g.level, target, targetSeat, handCounts: g.handCounts() });
  if (strategy === 'auto') return smartPlay({ seat, hand: g.hands[seat], level: g.level, target, targetSeat, counts: g.handCounts(), tracker }, AUTO_BUDGET);
  const inp = { seat, hand: g.hands[seat], level: g.level, target, targetSeat, counts: g.handCounts(), tracker };
  const adv = advise(inp);
  const mcStateFrom = (x: typeof inp) => ({ ...mcStateOf(x), ...(NO_LACKS ? { lacks: undefined } : {}) });
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
  if (strategy === 'mcjev' && adv.options.length > 1) {
    // 与托管相同的模拟设置（不限时间、按样本数）；模拟拿不准时请 Jev 在几个差不多的出法里定
    jevStats.decisions++;
    const cfg = mcConfigFor(g.handCounts());
    const top = mcCandidates(adv.options);
    const st = mcStateFrom(inp), moves = top.map((o) => o.combo), seed = g.roundNo * 1000 + g.hands[seat].length;
    const samples = EQUAL_COST ? Math.max(cfg.minSamples, Math.round(cfg.samples * Math.min(MC_K, adv.options.length) / top.length)) : cfg.samples;
    const r = cfg.mode === 'full' ? monteCarlo(st, moves, 1e9, samples, seed, ROLLOUT) : monteCarloShallow(st, moves, 1e9, samples, seed, SHALLOW_ROLLOUT);
    const mcPick = top[pickByMC(r, cfg)?.best ?? 0];
    const ties = mcTies(r, cfg).map((i) => top[i]);
    if (ties.length < 2) return mcPick.combo;
    jevStats.ties++;
    if (NO_JEV) return mcPick.combo;
    const { adviseDirect } = await import('../server/jev');
    jevStats.calls++;
    try {
      // 与提示相同：Jev 对前几个候选排序，在差不多的几手里取排得最前的
      const j = await adviseDirect(buildJevContext(inp, { ...adv, options: top }), 8000);
      const rank = j.ranking?.length && (j.confidence ?? 0) >= JEV_MIN_CONFIDENCE ? j.ranking : null;
      const choice = rank ? ties.filter((o) => rank.includes(o.id)).sort((x, y) => rank.indexOf(x.id) - rank.indexOf(y.id))[0] : undefined;
      if (choice) {
        jevStats.adopted++;
        if (choice !== mcPick) jevStats.changed++;
        return choice.combo;
      }
    } catch { jevStats.failed++; }
    return mcPick.combo;
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

export async function bench(a: string, b: string, n: number, seed = 200000, parallel = 1, onProgress?: (done: number) => void): Promise<BenchResult> {
  const nets: number[] = [];
  let next = 0;
  async function playOne(i: number) {
    const aTeam = i % 2; // 同一副牌两队各坐一次
    const g = new GuandanGame();
    g.levels = [2 + (Math.floor(i / 2) % 13), 2 + (Math.floor(i / 2) % 13)];
    const trackers = [0, 1, 2, 3].map((s) => new CardTracker(s));
    g.on((e) => trackers.forEach((t) => t.apply(e)));
    if (TRIBUTE) g.prevOrder = shuffle([0, 1, 2, 3], seed + 7919 * Math.floor(i / 2));
    g.startRound(seed + Math.floor(i / 2));
    while (g.phase === 'return') {
      const pr = g.pendingReturns[0];
      g.returnTribute(pr.from, smartReturn(g.hands[pr.from], g.level, teamOf(pr.from) === teamOf(pr.to)));
    }
    let guard = 0;
    while (g.phase === 'play' && guard++ < 3000) {
      const s = g.turn;
      const name = teamOf(s) === aTeam ? a : b;
      const old = name.endsWith('~old');
      bombGuard.enabled = mcLowSample.enabled = !old;
      const c = await choose((old ? name.slice(0, -4) : name) as Strategy, { seat: s, g, tracker: trackers[s] }).finally(() => { bombGuard.enabled = mcLowSample.enabled = true; });
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
  // 评估用：GD_SPLIT_CTL=0 拆牌不结合外面的牌；GD_SPLIT_CTL=0.5 设置控制牌的代价
  if (process.env.GD_SPLIT_CTL) {
    const { splitControl } = await import('../shared/ai');
    const v = Number(process.env.GD_SPLIT_CTL);
    if (v <= 0) splitControl.enabled = false; else splitControl.cost = v;
    if (process.env.GD_SPLIT_MODE) splitControl.mode = process.env.GD_SPLIT_MODE as 'group' | 'cost';
    console.log(splitControl.enabled ? `控制牌代价 ${splitControl.cost}（${splitControl.mode}）` : '拆牌不结合外面的牌');
  }
  const usesJev = (x: string) => x === 'jev' || (x === 'mcjev' && !NO_JEV);
  const parallel = Number(process.env.GD_PARALLEL ?? (usesJev(a) || usesJev(b) ? 4 : 1));
  const r = await bench(a, b, Number(n), Number(seed), parallel);
  console.log(formatResult(a, b, r));
  if (a === 'mcjev' || b === 'mcjev') {
    const j = jevStats;
    console.log(`  mcjev：决策 ${j.decisions} 次，模拟拿不准 ${j.ties} 次（${(100 * j.ties / Math.max(1, j.decisions)).toFixed(1)}%）；请 Jev ${j.calls} 次，采用 ${j.adopted}，其中改变选择 ${j.changed}，失败 ${j.failed}`);
  }
}
