// 记牌训练：记牌器面板的各格、随局快问的出题与判分、段位升级。
// 只用某个座位本来就能知道的信息（CardTracker + 自己的手牌），答案在出题那一刻算好，之后的出牌不影响对错。
// 段位从易到难：1 记王 → 2 记级牌（含逢人配）→ 3 记 A、K → 4 记炸弹 → 5 记 10 和 5 → 6 记空门。
// 记牌器上，当前段位及以下的格子隐藏成“?”，要玩家自己记；更高段位的内容照常显示，当作辅助。
import { card, isWild, rankName, BIG_JOKER, SMALL_JOKER } from './cards';
import { isBomb, TYPE_NAMES, type ComboType } from './combo';
import { teamOf } from './game';
import type { CardTracker } from './tracker';

export const MAX_TIER = 6;
export const TIER_NAMES = ['', '记王', '记级牌', '记 A、K', '记炸弹', '记 10 和 5', '记空门'] as const;
/** 升段：当前段位的题目，最近 PROMOTE_WINDOW 题答对 PROMOTE_NEED 题 */
export const PROMOTE_WINDOW = 10;
export const PROMOTE_NEED = 8;
/** 快问：距上一题至少隔几轮、全场至少出了几张牌、每局最多几题、作答秒数 */
export const QUIZ_GAP_TRICKS = 2;
export const QUIZ_MIN_PLAYED = 12;
export const QUIZ_MAX_PER_ROUND = 5;
export const QUIZ_SECONDS = 10;

/** 相对座位的称呼（0 自己、1 下家、2 对家、3 上家） */
const REL = ['你', '下家', '对家', '上家'];
export const relName = (seat: number, me: number) => REL[(seat - me + 4) % 4];

/** 不出时面对的牌型里，可以出成“空门”题的（炸弹不算） */
const VOID_TYPES: ComboType[] = ['single', 'pair', 'triple', 'fullhouse', 'straight', 'tube', 'plate'];

export interface TrainInput {
  tracker: CardTracker;
  /** 自己当前的手牌 */
  hand: number[];
  level: number;
  /** 自己出完后能看到的对家手牌（只用于记牌器显示） */
  partnerHand?: number[] | null;
}

// ---------- 记牌器 ----------

/** 一类要数的牌：某个点数（level 的点数含逢人配），或者逢人配 */
type Target = { kind: 'rank'; rank: number } | { kind: 'wild' };

interface CountItem { target: Target; tier: number; label: string; total: number }

/** 本局要数的各类牌，按段位排列；与级牌重合的点数归到级牌那一段 */
function countItems(level: number): CountItem[] {
  const items: CountItem[] = [
    { target: { kind: 'rank', rank: BIG_JOKER }, tier: 1, label: '大王', total: 2 },
    { target: { kind: 'rank', rank: SMALL_JOKER }, tier: 1, label: '小王', total: 2 },
    { target: { kind: 'rank', rank: level }, tier: 2, label: `级${rankName(level)}`, total: 8 },
    { target: { kind: 'wild' }, tier: 2, label: '配', total: 2 },
  ];
  const add = (ranks: number[], tier: number) => {
    for (const r of ranks) if (r !== level) items.push({ target: { kind: 'rank', rank: r }, tier, label: rankName(r), total: 8 });
  };
  add([14, 13], 3);
  add([10, 5], 5);
  // 其余点数本版不考，一直显示（段位 7 以上留给以后）
  add([12, 11, 9, 8, 7, 6, 4, 3, 2], MAX_TIER + 1);
  return items;
}

const matches = (t: Target, id: number, level: number) => (t.kind === 'wild' ? isWild(id, level) : card(id).rank === t.rank);

/** 某类牌：外面还剩几张，以及算式的各项 */
function countOf(t: Target, inp: TrainInput) {
  const { tracker, hand, level } = inp;
  const outside = tracker.unseen(hand, inp.partnerHand ?? null).filter((id) => matches(t, id, level)).length;
  const mine = hand.filter((id) => matches(t, id, level)).length;
  let played = 0;
  for (const id of tracker.played) if (matches(t, id, level)) played++;
  return { outside, mine, played };
}

export interface Cell {
  label: string;
  /** 外面还剩几张 */
  left: number;
  tier: number;
  /** 当前段位要自己记，显示成“?” */
  hidden: boolean;
}

export function panelCells(inp: TrainInput, tier: number): Cell[] {
  return countItems(inp.level).map((it) => ({ label: it.label, left: countOf(it.target, inp).outside, tier: it.tier, hidden: it.tier <= tier }));
}

/** 全场已出的炸弹（含同花顺、天王炸），按座位统计 */
export function bombsPlayed(tracker: CardTracker): { total: number; bySeat: number[] } {
  const bySeat = [0, 0, 0, 0];
  for (const h of tracker.history) if (h.combo && isBomb(h.combo)) bySeat[h.seat]++;
  return { total: bySeat.reduce((a, b) => a + b, 0), bySeat };
}

export function bombsLine(tracker: CardTracker, me: number): string {
  const { total, bySeat } = bombsPlayed(tracker);
  if (!total) return '已出 0 个';
  const who = [0, 1, 2, 3].filter((s) => bySeat[s]).map((s) => `${relName(s, me)} ${bySeat[s]}`);
  return `已出 ${total} 个（${who.join('、')}）`;
}

/** 某家最近一次面对对手的牌选择不出：对手出的是什么牌型、是谁出的（面对搭档不出是让牌，不算） */
export function lastVoid(tracker: CardTracker, seat: number): { type: ComboType; from: number } | null {
  const passes = tracker.seats[seat].passes;
  for (let i = passes.length - 1; i >= 0; i--) {
    const p = passes[i];
    if (teamOf(p.seat) !== teamOf(seat) && VOID_TYPES.includes(p.type)) return { type: p.type, from: p.seat };
  }
  return null;
}

export function voidLine(tracker: CardTracker, me: number): string {
  const one = (s: number) => {
    const v = lastVoid(tracker, s);
    return `${relName(s, me)}没要：${v ? TYPE_NAMES[v.type] : '—'}`;
  };
  return `${one((me + 3) % 4)}　${one((me + 1) % 4)}`;
}

// ---------- 快问 ----------

export interface Question {
  /** 属于哪一段 */
  tier: number;
  text: string;
  options: string[];
  /** 正确选项的序号 */
  answer: number;
  /** 答完后的解释 */
  explain: string;
}

type Rand = () => number;
const pick = <T>(xs: T[], rand: Rand): T => xs[Math.floor(rand() * xs.length) % xs.length];

/** 数量题的选项：包含答案的 4 个相邻的数，限制在 0..max 之间 */
function numberOptions(ans: number, max: number, rand: Rand): { options: string[]; answer: number } {
  if (max + 1 <= 4) return { options: Array.from({ length: max + 1 }, (_, i) => String(i)), answer: ans };
  const lo = Math.max(0, ans - 3), hi = Math.min(ans, max - 3);
  const start = lo + Math.floor(rand() * (hi - lo + 1));
  return { options: [0, 1, 2, 3].map((i) => String(start + i)), answer: ans - start };
}

function shuffled<T>(xs: T[], rand: Rand): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 问题里对这类牌的称呼 */
function askName(it: CountItem, level: number): string {
  if (it.target.kind === 'wild') return `逢人配（红桃${rankName(level)}）`;
  if (it.tier === 2) return `级牌 ${rankName(level)}（含逢人配）`;
  return it.label;
}

function countQuestion(it: CountItem, inp: TrainInput, rand: Rand): Question {
  const { outside, mine, played } = countOf(it.target, inp);
  const { options, answer } = numberOptions(outside, it.total, rand);
  return {
    tier: it.tier,
    text: `外面还有几张${askName(it, inp.level)}？`,
    options, answer,
    explain: `共 ${it.total} − 手里 ${mine} − 已出 ${played} = 外面 ${outside} 张`,
  };
}

function bombQuestion(inp: TrainInput, me: number, rand: Rand): Question {
  const { total } = bombsPlayed(inp.tracker);
  const { options, answer } = numberOptions(total, 99, rand);
  return {
    tier: 4,
    text: '全场一共出过几个炸弹？',
    options, answer,
    explain: `全场${bombsLine(inp.tracker, me)}，同花顺、天王炸也算炸弹。`,
  };
}

function voidQuestion(inp: TrainInput, me: number, rand: Rand): Question | null {
  const seats = [(me + 3) % 4, (me + 1) % 4].filter((s) => lastVoid(inp.tracker, s));
  if (!seats.length) return null;
  const s = pick(seats, rand);
  const v = lastVoid(inp.tracker, s)!;
  const others = shuffled(VOID_TYPES.filter((t) => t !== v.type), rand).slice(0, 3);
  const types = shuffled([v.type, ...others], rand);
  return {
    tier: 6,
    text: `${relName(s, me)}最近一次没要什么牌型？`,
    options: types.map((t) => TYPE_NAMES[t]),
    answer: types.indexOf(v.type),
    explain: `${relName(s, me)}最近一次面对对手不出，是${relName(v.from, me)}出的${TYPE_NAMES[v.type]}。不要不一定是没有，也可能在留牌。`,
  };
}

/** 某一段的题：先选出要问哪一类，再生成选项（空门题没有可问的时返回 null） */
function questionOf(tier: number, inp: TrainInput, me: number, rand: Rand): Question | null {
  if (tier === 4) return bombQuestion(inp, me, rand);
  if (tier === 6) return voidQuestion(inp, me, rand);
  const items = countItems(inp.level).filter((it) => it.tier === tier);
  return items.length ? countQuestion(pick(items, rand), inp, rand) : null;
}

/**
 * 出一道题：七成出当前段位，三成复习更低的段位；这一段没有可出的题时换别的段，都没有返回 null。
 */
export function makeQuestion(inp: TrainInput, me: number, tier: number, rand: Rand = Math.random): Question | null {
  const first = tier > 1 && rand() < 0.3 ? 1 + Math.floor(rand() * (tier - 1)) : tier;
  const order = [first, ...Array.from({ length: tier }, (_, i) => tier - i).filter((t) => t !== first)];
  for (const t of order) {
    const q = questionOf(t, inp, me, rand);
    if (q) return q;
  }
  return null;
}

/** 这一轮结束时要不要出题（托管、出完、下一轮自己领牌等情况由界面另外判断） */
export function quizDue(s: { tricksSinceAsk: number; played: number; askedThisRound: number }): boolean {
  return s.tricksSinceAsk >= QUIZ_GAP_TRICKS && s.played >= QUIZ_MIN_PLAYED && s.askedThisRound < QUIZ_MAX_PER_ROUND;
}

// ---------- 段位 ----------

export interface TrainProgress {
  /** 当前段位 1..MAX_TIER */
  tier: number;
  /** 每段最近 PROMOTE_WINDOW 题的对错（1 对 0 错） */
  recent: Record<number, number[]>;
  /** 累计 */
  asked: number;
  correct: number;
}

export const newProgress = (): TrainProgress => ({ tier: 1, recent: {}, asked: 0, correct: 0 });

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** 记录一题的对错；答对当前段位的题、达到升段条件时升一段 */
export function record(p: TrainProgress, q: Pick<Question, 'tier'>, ok: boolean): { promoted: boolean } {
  const list = (p.recent[q.tier] ??= []);
  list.push(ok ? 1 : 0);
  if (list.length > PROMOTE_WINDOW) list.splice(0, list.length - PROMOTE_WINDOW);
  p.asked++;
  if (ok) p.correct++;
  if (ok && q.tier === p.tier && p.tier < MAX_TIER && sum(list) >= PROMOTE_NEED) {
    p.tier++;
    return { promoted: true };
  }
  return { promoted: false };
}

/** 升段进度的说明 */
export function progressText(p: TrainProgress): string {
  const list = p.recent[p.tier] ?? [];
  const c = sum(list);
  const head = list.length ? `最近 ${list.length} 题答对 ${c} 题` : '还没有答过这一段的题';
  if (p.tier >= MAX_TIER) return `${head}，已经是最高段位`;
  return `${head}，再答对 ${Math.max(1, PROMOTE_NEED - c)} 题升到“${TIER_NAMES[p.tier + 1]}”`;
}
