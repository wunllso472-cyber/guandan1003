// 出牌顾问：结合记牌器，为“提示”列出候选出法、计算特征、给出本地排序和理由，并生成交给 Jev 的信息。
import { card, cardValue, isWild, rankName, value, BIG_JOKER, SMALL_JOKER, type Suit } from './cards';
import { bombLevel, canBeat, comboName, isBomb, type Combo } from './combo';
import { findAllPlays } from './finder';
import { bestSplit, aiPlay, preferLooseCards, bombGuard } from './ai';
import { CardTracker, sameTypeBeatable, unseenStat, type UnseenStat } from './tracker';
import { COURSE_RULE_IDS, evaluateRules, goalOf, RULES, type RuleHit } from './strategy';
import { BOOK_RULES, TIER_CN, bookGuidance, bookHits, bookState, coursePower, type BookInput, type Power } from './rulebook';
import { profileConfidence, profileSeats } from './inference';

export type Control = 'unbeatable' | 'bombOnly' | 'beatable';

export interface OptionFeatures {
  /** 出完这手后，剩下的牌还要几手（不含炸弹） */
  handsLeft: number;
  /** 出完后还剩几个炸弹 */
  bombsLeft: number;
  /** 是否拆了炸弹 */
  breaksBomb: boolean;
  /** 用了几张逢人配 */
  wilds: number;
  /** 外面能不能压住这手牌 */
  control: Control;
  isBomb: boolean;
  /** 一手出完 */
  finishes: boolean;
}

export interface AdviceOption {
  /** 'pass' 或 'p<序号>' */
  id: string;
  /** null 表示不出 */
  combo: Combo | null;
  /** 给人看的描述，比如“对9” */
  label: string;
  features: OptionFeatures | null;
  /** 本地评分，越小越推荐 */
  score: number;
  reasons: string[];
  /** 规则库的判断（见 shared/strategy.ts 与 shared/rulebook.ts） */
  rules: RuleHit[];
  /** 适用于这个出法的教材规则编号（含只作参考、不计分的） */
  book?: string[];
}

export interface Inference { who: 'partner' | 'left' | 'right'; text: string; confidence: number; /** 依据的教材规则编号 */ rule?: string }

export interface Advice {
  options: AdviceOption[];
  /** 按实际局面判断的阶段 */
  stage?: string;
  /** 自己的牌力评估和打法 */
  power?: Power;
  facts: string[];
  inferred: Inference[];
}

export interface AdviceInput {
  seat: number;
  hand: number[];
  level: number;
  target: Combo | null;
  targetSeat: number | null;
  /** 每个座位剩余张数 */
  counts: number[];
  tracker: CardTracker;
  /** 自己出完后能看到的对家手牌 */
  partnerHand?: number[] | null;
}

const SUIT_SYM: Record<Suit, string> = { S: '♠', H: '♥', C: '♣', D: '♦', J: '' };

/** 牌的显示名：小王、大王、♠9；逢人配标注“(配)” */
export function cardLabel(id: number, level: number): string {
  const c = card(id);
  if (c.rank >= SMALL_JOKER) return rankName(c.rank);
  return SUIT_SYM[c.suit] + rankName(c.rank) + (isWild(id, level) ? '(配)' : '');
}

/** 牌组的显示名，比如“对9”“顺子 3-7”“三带二(K带5)” */
export function comboLabel(c: Combo, level: number): string {
  const nat = c.cards.filter((id) => !isWild(id, level)).map((id) => card(id).rank);
  const top = nat.length ? nat.sort((a, b) => value(b, level) - value(a, level))[0] : level;
  switch (c.type) {
    case 'single': return '单张' + (isWild(c.cards[0], level) ? `${rankName(level)}(配)` : rankName(card(c.cards[0]).rank));
    case 'pair': return '对' + rankName(top);
    case 'triple': return '三个' + rankName(top);
    case 'straight': case 'straightflush': return `${comboName(c)} ${rankName(c.value === 1 ? 14 : c.value)}-${rankName(c.value + 4)}`;
    case 'tube': return `三连对 ${rankName(c.value === 1 ? 14 : c.value)}-${rankName(c.value + 2)}`;
    case 'plate': return `钢板 ${rankName(c.value === 1 ? 14 : c.value)}-${rankName(c.value + 1)}`;
    case 'bomb': return `${c.cards.length}炸(${rankName(top)})`;
    case 'jokerbomb': return '天王炸';
    case 'fullhouse': return `三带二(三个${rankName(rankOfValue(c.value, level))})`;
  }
}

function rankOfValue(v: number, level: number): number {
  return v === 15 ? level : v;
}

// ---------- 控制力：外面能不能压住 ----------

/** 外面可能凑出的炸弹（同点数炸弹每个点数取最大张数、同花顺取最大起点、天王炸），用于和我的牌比大小 */
function outsideBombs(st: UnseenStat, level: number): Combo[] {
  const out: Combo[] = [];
  const fake = (type: Combo['type'], size: number, v: number): Combo => ({ type, cards: new Array(size).fill(-1), value: v });
  for (let r = 2; r <= 14; r++) {
    const n = st.byRank.get(r) ?? 0;
    // 逢人配最多两张，凑成炸弹至少要两张同点数的自然牌
    if (n >= 2 && n + st.wilds >= 4) out.push(fake('bomb', n + st.wilds, value(r, level)));
  }
  if (st.maxSfStart > 0) out.push(fake('straightflush', 5, st.maxSfStart));
  if (jokerBombPossible(st)) out.push(fake('jokerbomb', 4, 0));
  return out;
}

/** 外面是否可能凑出任何炸弹（含同花顺、天王炸） */
function bombPossible(st: UnseenStat, level: number): boolean {
  return outsideBombs(st, level).length > 0;
}

function jokerBombPossible(st: UnseenStat): boolean {
  return (st.byRank.get(SMALL_JOKER) ?? 0) === 2 && (st.byRank.get(BIG_JOKER) ?? 0) === 2;
}

export function controlOf(c: Combo, st: UnseenStat, level: number): Control {
  if (c.type === 'jokerbomb') return 'unbeatable';
  // 炸弹：外面能凑出更大的炸弹（张数更多，或同级点数更大，或同花顺/天王炸）才可能被压
  if (isBomb(c)) return outsideBombs(st, level).some((b) => canBeat(b, c)) ? 'beatable' : 'unbeatable';
  if (sameTypeBeatable(c, st, level)) return 'beatable';
  return bombPossible(st, level) ? 'bombOnly' : 'unbeatable';
}

// ---------- 事实与推断 ----------

const rel = (me: number, s: number) => ((s - me + 4) % 4) as 0 | 1 | 2 | 3;
const WHO: Record<number, Inference['who']> = { 1: 'right', 2: 'partner', 3: 'left' };
const WHO_CN: Record<string, string> = { partner: '对家', left: '上家', right: '下家' };

export function collectFacts(inp: AdviceInput, st: UnseenStat): { facts: string[]; inferred: Inference[] } {
  const { seat, level, tracker, hand } = inp;
  const facts: string[] = [];
  const jokersOut = (st.byRank.get(SMALL_JOKER) ?? 0) + (st.byRank.get(BIG_JOKER) ?? 0);
  if (jokersOut === 0) facts.push(`外面已经没有大小王了，级牌${rankName(level)}就是最大的单张`);
  else facts.push(`外面还有 ${st.byRank.get(BIG_JOKER) ?? 0} 张大王、${st.byRank.get(SMALL_JOKER) ?? 0} 张小王`);
  const myTop = Math.max(0, ...hand.map((id) => cardValue(id, level)));
  if (myTop > st.topValue && st.topValue > 0) facts.push('我手里最大的单张比外面所有的牌都大');
  if (st.wilds > 0) facts.push(`外面还有 ${st.wilds} 张逢人配（红桃${rankName(level)}）`);
  if (!bombPossible(st, level)) facts.push('外面已经凑不出任何炸弹');
  else if (jokerBombPossible(st)) facts.push('外面可能还有天王炸');
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const known = [...tracker.seats[s].known];
    if (known.length) facts.push(`${WHO_CN[WHO[rel(seat, s)]]}手里确定有：${known.map((id) => cardLabel(id, level)).join('、')}（进贡/还贡/抗贡时可知）`);
    const tributed = tracker.seats[s].tributed;
    if (tributed !== null && !tracker.seats[s].place) {
      facts.push(`${WHO_CN[WHO[rel(seat, s)]]}进贡了${cardLabel(tributed, level)}，手里没有比它大的牌（逢人配和还贡得到的牌除外）`);
    }
  }

  const inferred: Inference[] = [];
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const who = WHO[rel(seat, s)];
    const rec = tracker.seats[s];
    if (rec.place) continue;
    // 面对某种牌型不出：可能没有更大的同类牌（也可能是在留炸弹或让对家）
    const seen = new Set<string>();
    for (const p of rec.passes.slice(-4)) {
      if (p.type === 'bomb' || p.type === 'straightflush' || p.type === 'jokerbomb') continue;
      if (p.seat % 2 === s % 2) continue; // 面对搭档的牌不出是让牌，不说明缺牌
      const k = p.type;
      if (seen.has(k)) continue;
      seen.add(k);
      inferred.push({ who, text: `面对${typeName(p.type)}曾选择不出，可能没有更大的${typeName(p.type)}`, confidence: who === 'partner' ? 0.4 : 0.55 });
    }
    // 对家多次先出同一种牌型：可能擅长这种牌
    if (who === 'partner') {
      const cnt = new Map<string, number>();
      for (const t of rec.leads) cnt.set(t, (cnt.get(t) ?? 0) + 1);
      for (const [t, n] of cnt) if (n >= 2) inferred.push({ who, text: `多次先出${typeName(t)}，可能还有${typeName(t)}`, confidence: 0.5 });
    }
    const guess = COUNT_SHAPES[rec.count];
    if (guess) {
      // 张数只能列出候选结构；外面凑不出炸弹时去掉带炸弹的候选
      const shapes = bombPossible(st, level) ? guess : guess.filter((x) => !x.includes('炸'));
      if (shapes.length) inferred.push({ who, text: `只剩 ${rec.count} 张，可能是${shapes.join('、')}`, confidence: rec.count <= 3 ? 0.6 : 0.4 });
    }
  }
  // 教材 I01–I08：从公开出牌推断主攻/助攻倾向和牌路（只是倾向，附依据）
  for (const p of profileSeats(tracker, seat)) {
    if (!p || tracker.seats[p.seat].place) continue;
    const who = WHO[rel(seat, p.seat)];
    if (p.role !== 'unknown') {
      inferred.push({ who, text: `${p.role === 'attack' ? '像在主攻' : '像在助攻'}（${p.evidence.filter((e) => ['I05', 'I06', 'I07'].includes(e.rule)).map((e) => e.text).join('；')}）`, confidence: profileConfidence(p), rule: p.role === 'attack' ? 'I05' : 'I06' });
    }
    for (const e of p.evidence) if (['I01', 'I03', 'I04', 'I08'].includes(e.rule)) inferred.push({ who, text: e.text, confidence: 0.4, rule: e.rule });
  }
  return { facts, inferred };
}

/** 报牌张数对应的常见结构（《掼蛋规则与实战技巧》第八章；只是待验证的候选，不能确定是哪一种） */
const COUNT_SHAPES: Record<number, string[]> = {
  1: ['单张'],
  2: ['一对', '两张单牌'],
  3: ['三张', '对子加单张'],
  4: ['空炸（只剩一个炸弹）', '两对', '三张加一单'],
  5: ['顺子', '三带二', '空炸', '一单加四头炸'],
  6: ['钢板', '三连对', '两单加四头炸', '一对加四头炸', '一单加五张炸弹'],
  7: ['一单一对加四头炸', '一对加五张炸弹', '一单加六张炸弹'],
  8: ['一单一对加五张炸弹', '两个四头炸', '其他普通牌组合'],
  9: ['五张普通牌加四头炸', '四头炸加五张炸弹', '一单加两个四头炸'],
  10: ['两手五张牌', '五张普通牌加五张炸弹', '多手散牌'],
};

function typeName(t: string): string {
  return ({ single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二', straight: '顺子', tube: '三连对', plate: '钢板', bomb: '炸弹', straightflush: '同花顺', jokerbomb: '天王炸' } as Record<string, string>)[t] ?? t;
}

// ---------- 候选与评分 ----------

export function advise(inp: AdviceInput): Advice {
  const { seat, hand, level, target, targetSeat, counts, tracker } = inp;
  const partner = (seat + 2) % 4, next = (seat + 1) % 4, prev = (seat + 3) % 4;
  const st = unseenStat(tracker.unseen(hand, inp.partnerHand ?? null), level);
  const { facts, inferred } = collectFacts(inp, st);
  const base = bestSplit(hand, level, st);
  const baseHands = base.combos.filter((x) => !isBomb(x)).length;
  const leading = !target;
  const gateCase = leading && counts[partner] === 1 && counts[next] === 1;
  // 对手快出完时才值得拆牌去压
  const urgent = [next, prev].some((s) => counts[s] > 0 && counts[s] <= 6);
  const active = (s: number) => counts[s] > 0;
  const partnerKnownTop = [...tracker.seats[partner].known].some((id) => cardValue(id, level) >= st.topValue && st.topValue > 0);
  const oppKnownTop = [next, prev].some((s) => [...tracker.seats[s].known].some((id) => cardValue(id, level) >= st.topValue && st.topValue > 0));
  const partnerLeads = new Map<string, number>();
  for (const t of tracker.seats[partner].leads) partnerLeads.set(t, (partnerLeads.get(t) ?? 0) + 1);

  // 手里每个点数的张数，用于判断是否拆炸弹
  const have = new Map<number, number>();
  for (const id of hand) if (!isWild(id, level)) have.set(card(id).rank, (have.get(card(id).rank) ?? 0) + 1);

  const options: AdviceOption[] = [];
  /** 每个候选出完后剩下的组合，规则判断用 */
  const restOf = new Map<AdviceOption, Combo[]>();
  const cands = findAllPlays(hand, level, target);
  cands.forEach((c0, i) => {
    const c = preferLooseCards(c0, hand, level, base.combos.map((x) => x.cards));
    const used = new Set(c.cards);
    const rest = hand.filter((id) => !used.has(id));
    const split = rest.length ? bestSplit(rest, level, st) : { score: -10, combos: [] as Combo[] };
    const take = new Map<number, number>();
    for (const id of c.cards) if (!isWild(id, level)) take.set(card(id).rank, (take.get(card(id).rank) ?? 0) + 1);
    // 同花顺借用了另一组炸弹里的牌也算拆炸（普通炸弹本身就是那一组，不算）
    const breaksBomb = [...take].some(([r, n]) => (have.get(r) ?? 0) >= 4 && (have.get(r) ?? 0) - n < 4) && c.type !== 'bomb' && c.type !== 'jokerbomb';
    const f: OptionFeatures = {
      handsLeft: split.combos.filter((x) => !isBomb(x)).length,
      bombsLeft: split.combos.filter(isBomb).length,
      breaksBomb,
      wilds: c.cards.filter((id) => isWild(id, level)).length,
      control: controlOf(c, st, level),
      isBomb: isBomb(c),
      finishes: rest.length === 0,
    };
    // 与电脑出牌相同的基础评分：出牌后剩余牌的“难出程度”变化 + 炸弹代价
    let score = split.score - base.score + (f.isBomb ? 1.2 + bombLevel(c) * 0.05 : 0) + c.value * 0.01;
    const reasons: string[] = [];
    const small = c.value <= 10;

    if (f.finishes) { score -= 20; reasons.push('一手出完'); }
    // 强规则（±4）可以推翻电脑的决策；弱规则（±1 以内）只影响其余候选的先后
    if (leading) {
      // 对家和下家都只剩 1 张时，由规则库的“传牌门槛”统一处理（手册牌例04）
      if (active(partner) && counts[partner] === 1 && c.type === 'single' && small && !gateCase) { score -= 4; reasons.push('对家只剩 1 张，出小单张让他走'); }
      if (active(partner) && counts[partner] === 2 && c.type === 'pair' && small) { score -= 4; reasons.push('对家只剩 2 张，可能是一对，送一对小牌给他'); }
      if (active(partner) && (partnerLeads.get(c.type) ?? 0) >= 2 && small && !f.isBomb) { score -= 0.6; reasons.push(`对家多次先出${typeName(c.type)}，送一手小${typeName(c.type)}给他`); }
      if (active(partner) && partnerKnownTop && c.type === 'single' && small) { score -= 0.8; reasons.push('对家手里有外面最大的牌，出小单张让他收回出牌权'); }
      if (oppKnownTop && c.type === 'single' && f.control === 'beatable') { score += 0.4; reasons.push('对手手里有最大的单张，单张容易被收走'); }
      if (f.control === 'unbeatable' && !f.isBomb && f.handsLeft <= 2) { score -= 0.6; reasons.push('这手牌外面没人压得住'); }
    } else {
      if (f.control !== 'beatable' && !f.isBomb && targetSeat !== partner) { score -= 0.3; reasons.push('出了外面没人压得住，可以拿回出牌权'); }
    }
    // 对手快出完时避开对应牌型
    for (const [s, name] of [[next, '下家'], [prev, '上家']] as [number, string][]) {
      if (!active(s) || f.control === 'unbeatable' || f.finishes) continue;
      if (gateCase && s === next && c.type === 'single') continue;
      if (counts[s] === 1 && c.type === 'single') { score += s === next ? 4 : 2; reasons.push(`${name}只剩 1 张，避免出单张`); }
      if (counts[s] === 2 && c.type === 'pair') { score += s === next ? 3 : 1.5; reasons.push(`${name}只剩 2 张，避免出对子`); }
    }
    if (c.type === 'single' && cardValue(c.cards[0], level) === 15 && !(st.byRank.get(SMALL_JOKER) ?? 0) && !(st.byRank.get(BIG_JOKER) ?? 0)) {
      reasons.push('大小王已出完，级牌是最大的单张');
    }
    const opt: AdviceOption = { id: `p${i}`, combo: c, label: comboLabel(c, level), features: f, score, reasons, rules: [] };
    restOf.set(opt, split.combos);
    options.push(opt);
  });

  // 规则库：逐条判断每个出法（需要先知道“是否存在更安全的最后一手”等全局信息）
  const lastControl = (rest: Combo[]) => (rest.length === 1 ? controlOf(rest[0], st, level) : null);
  const maxGateSingle = Math.max(0, ...options.filter((o) => o.combo!.type === 'single').map((o) => Math.min(14, cardValue(o.combo!.cards[0], level))));
  const safeLastExists = options.some((o) => !o.features!.finishes && lastControl(restOf.get(o)!) !== null && lastControl(restOf.get(o)!) !== 'beatable');
  // 教材规则库：先算与候选无关的局面特征
  const bookIn: BookInput = { seat, hand, level, target, targetSeat, counts, tracker, baseCombos: base.combos, controlOf: (x) => controlOf(x, st, level) };
  const bs = bookState(bookIn);
  // 对手剩的牌都不到 4 张时不可能有炸弹（炸弹至少 4 张）
  const oppNoBomb = [next, prev].every((s) => !active(s) || counts[s] < 4);
  const outsideBomb = bombPossible(st, level);
  for (const o of options) {
    const f = o.features!;
    const rest = restOf.get(o)!;
    const c = o.combo!;
    // 安全拆炸：这手和剩下含被拆点数的组合，外面都压不住
    let bombSplitSafe = false;
    if (f.breaksBomb && oppNoBomb && f.control !== 'beatable') {
      const broken = new Set(c.cards.filter((id) => !isWild(id, level) && (have.get(card(id).rank) ?? 0) >= 4).map((id) => card(id).rank));
      bombSplitSafe = rest.filter((x) => x.cards.some((id) => broken.has(card(id).rank))).every((x) => controlOf(x, st, level) !== 'beatable');
    }
    const canRecapture = rest.some((x) => x.type === c.type && x.cards.length === c.cards.length && x.value > c.value && controlOf(x, st, level) !== 'beatable');
    const book = bookHits(bookIn, bs, { combo: c, features: f, rest, baseHands, canRecapture });
    const hits = [...evaluateRules({
      seat, hand, level, combo: c, target, targetSeat, counts, tracker, features: f,
      restCombos: rest,
      lastHandControl: lastControl(rest),
      canRecapture,
      safeLastExists,
      breaksLinks: !urgent && !f.finishes && !f.isBomb && f.handsLeft >= baseHands,
      maxGateSingle,
      bombSplitSafe,
      role: bs.power.role,
      outsideBomb,
      shedsWeak: f.handsLeft < baseHands,
    }), ...book.hits];
    o.rules = hits;
    o.book = book.matched.map((r) => r.id);
    o.score += hits.reduce((a, h) => a + h.weight, 0);
    // 理由：分量大的规则说明排在前面
    // 教材规则支持这个出法时，即使分量小也作为理由（反对的只在分量大时说明）
    const ruleNotes = hits.filter((h) => Math.abs(h.weight) >= 0.5 || (h.id in BOOK_RULES && h.weight < 0) || (COURSE_RULE_IDS.has(h.id) && h.effect === 'support'))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).map((h) => (COURSE_RULE_IDS.has(h.id) && h.effect === 'oppose' ? `注意：${h.note}` : h.note));
    o.reasons = [...new Set([...(f.finishes ? ['一手出完'] : []), ...ruleNotes, ...o.reasons])];
    if (!o.reasons.length) o.reasons.push(f.handsLeft <= 1 ? '出完后很快就能走完' : `出完后还剩 ${f.handsLeft} 手牌`);
  }
  noteSmallestPeer(options, !!target);

  if (target) {
    // “不出”的评分：参照电脑的跟牌规则
    const reasons: string[] = [];
    let score: number;
    const oppLeft = targetSeat !== null ? counts[targetSeat] : 27;
    if (targetSeat === partner) {
      score = -5;
      const ctl = controlOf(target, st, level);
      reasons.push(ctl === 'beatable' ? '不和对家抢牌' : '对家这手牌外面没人压得住，不用管');
    } else if (oppLeft <= 6) {
      score = 2;
      reasons.push(`对手只剩 ${oppLeft} 张，不出很危险`);
    } else {
      score = -0.35;
      reasons.push('留着好牌，后面再出');
    }
    const book = bookHits(bookIn, bs, null);
    const hits = [...evaluateRules({
      seat, hand, level, combo: null, target, targetSeat, counts, tracker, features: null,
      restCombos: base.combos, lastHandControl: null, canRecapture: false, safeLastExists, breaksLinks: false, maxGateSingle,
      role: bs.power.role, outsideBomb,
    }), ...book.hits];
    score += hits.reduce((a, h) => a + h.weight, 0);
    const notes = hits.filter((h) => Math.abs(h.weight) >= 0.5 || (COURSE_RULE_IDS.has(h.id) && h.effect === 'support')).map((h) => h.note);
    options.push({ id: 'pass', combo: null, label: '不出', features: null, score, reasons: [...new Set([...notes, ...reasons])], rules: hits, book: book.matched.map((r) => r.id) });
  }

  // 以电脑的决策为基础：电脑会出的那手优先，只有强规则（对家/对手快出完、一手出完）才会推翻
  const ai = aiPlay({ seat, hand, level, target, targetSeat, handCounts: counts, unseen: st });
  const aiKey = ai ? [...ai.cards].sort().join(',') : 'pass';
  for (const o of options) {
    const k = o.combo ? [...o.combo.cards].sort().join(',') : 'pass';
    // 拆炸弹的出法不加这份优先：否则“会拆掉炸弹”的扣分被完全盖过（安全拆炸除外，见 CHECK_REST 的支持）
    const safeSplit = o.rules.some((h) => h.id === 'CHECK_REST' && h.weight < 0);
    if (k === aiKey && !o.features?.finishes && !(bombGuard.enabled && o.features?.breaksBomb && !safeSplit)) o.score -= 3;
  }
  options.sort((a, b) => a.score - b.score);
  return { options, facts, inferred, stage: bs.stage, power: bs.power };
}

/**
 * 同一牌型、出完剩下手数一样的几种出法：最小的那手说明“留着大的收回出牌权”，大的说明“没必要花掉”。
 * 只补充理由，不改评分（剩下的拆法评分相同，原本只靠点数的微小差别区分，理由里看不出来）。
 */
function noteSmallestPeer(options: AdviceOption[], following: boolean) {
  const plain = options.filter((o) => o.combo && !o.features!.isBomb && !o.features!.finishes);
  const generic = (r: string) => r.startsWith('出完后还剩') || r === '出完后很快就能走完';
  for (const o of plain) {
    const c = o.combo!, f = o.features!;
    const peers = plain.filter((x) => x !== o && x.combo!.type === c.type && x.combo!.cards.length === c.cards.length
      && x.features!.handsLeft === f.handsLeft && x.features!.bombsLeft === f.bombsLeft);
    const bigger = peers.filter((x) => x.combo!.value > c.value).sort((a, b) => a.combo!.value - b.combo!.value);
    const smaller = peers.filter((x) => x.combo!.value < c.value).sort((a, b) => a.combo!.value - b.combo!.value);
    const rest = o.reasons.filter((r) => !generic(r));
    // 最小的那手：这就是主要理由，放最前；大的：放在规则理由（如拆牌型）后面
    if (smaller.length) o.reasons = [...rest, `出${smaller[0].label}同样剩 ${f.handsLeft} 手，没必要花掉${o.label}`];
    else if (bigger.length) o.reasons = [`${following ? '能压住的' : ''}${typeName(c.type)}里最小的一手（出完都剩 ${f.handsLeft} 手），留着${bigger.slice(-3).map((x) => x.label).join('、')}以后收回出牌权`, ...rest];
  }
}

// ---------- 交给 Jev 的信息 ----------

export function buildJevContext(inp: AdviceInput, adv: Advice) {
  const { seat, hand, level, target, targetSeat, counts, tracker } = inp;
  const name = (s: number) => (s === seat ? '我' : WHO_CN[WHO[rel(seat, s)]]);
  const st = unseenStat(tracker.unseen(hand, inp.partnerHand ?? null), level);
  const unseen: Record<string, number> = {};
  for (const [r, n] of [...st.byRank].sort((a, b) => value(b[0], level) - value(a[0], level))) unseen[rankName(r)] = n;
  if (st.wilds) unseen['逢人配'] = st.wilds;
  const goal = goalOf(seat, tracker);
  // 只列出这个局面里实际触发的规则原则，避免无关内容干扰
  const fired = new Set(adv.options.flatMap((o) => o.rules.map((h) => h.id)));
  fired.add('GOAL');
  return {
    game: '掼蛋（两副牌，四人，对家为队友）',
    goal: { first: 'Compete to go out first', second: 'Partner already went out first: go out next', protect: 'An opponent already went out first: keep the partner from finishing last and stop the opponents passing A' }[goal],
    rulebook: [...fired].filter((id) => RULES[id]).map((id) => `${id}: ${RULES[id].principle}`),
    stage: { opening: '开局', middle: '中局', endgame: '残局' }[adv.stage ?? ''] ?? adv.stage,
    // 教材规则库（江苏省掼蛋教材）：只列出与本局面候选相关的条目
    textbookRules: bookGuidance(adv.options.slice(0, 6).flatMap((o) => [...o.rules.map((h) => h.id), ...(o.book ?? [])])),
    level: rankName(level),
    rankOrder: `2<3<…<K<A<${rankName(level)}(级牌)<小王<大王`,
    wildcard: `红桃${rankName(level)}（逢人配，可当任意非王牌）`,
    me: { hand: hand.map((id) => cardLabel(id, level)), cardsLeft: hand.length },
    players: [0, 1, 2, 3].filter((s) => s !== seat).map((s) => ({ who: name(s), cardsLeft: counts[s], finished: tracker.seats[s].place > 0 })),
    trick: target ? { lastPlay: { by: name(targetSeat!), play: comboLabel(target, level) } } : { lead: true },
    unseenCards: unseen,
    facts: adv.facts,
    inferred: adv.inferred.map((x) => ({ who: WHO_CN[x.who], text: x.text, confidence: x.confidence })),
    history: tracker.history.slice(-16).map((h) => `${name(h.seat)}：${h.combo ? comboLabel(h.combo, level) : '不出'}`),
    options: adv.options.map((o) => ({
      id: o.id,
      play: o.label,
      ...(o.features ? {
        handsLeftAfter: o.features.handsLeft, bombsLeftAfter: o.features.bombsLeft, breaksBomb: o.features.breaksBomb,
        usesWildcard: o.features.wilds > 0, control: { unbeatable: '外面没人压得住', bombOnly: '只可能被炸弹压', beatable: '可能被压' }[o.features.control],
        isBomb: o.features.isBomb, finishesHand: o.features.finishes,
      } : {}),
      notes: o.reasons,
      rule_hits: o.rules.map((h) => `${h.id} ${h.effect}s: ${h.en}`),
    })),
  };
}

// ---------- 托管决策依据（给玩家看） ----------

/** 各阶段的出牌要点（阶段按 rulebook.bookState 的判断：有人剩 10 张以内为残局，场上出牌 24 张以内为开局） */
export const STAGE_FOCUS: Record<string, { name: string; focus: string[] }> = {
  opening: { name: '开局', focus: ['理顺牌型、减少手数，先出小牌和难出的散牌', '保留炸弹和大牌，不轻易动炸', '用出牌试探对手牌路，给对家传递自己的牌型'] },
  middle: { name: '中局', focus: ['争夺并保持出牌权，用外面压不住的牌接回牌权', '配合对家：对家的牌一般不压，顺着他擅长的牌型送牌', '盯住对手常出的牌型，不给他们顺牌'] },
  endgame: { name: '残局', focus: ['算清各家剩余张数，确保自己或对家能先走', '对手快走时不出他能接的牌型，必要时用炸弹拦截', '对家快走时送小牌让他走，自己留好最后一手'] },
};

/** 按打法补充的要点（《掼蛋规则与实战技巧》第三、五、九章） */
const ROLE_FOCUS: Record<Power['role'], Record<string, string[]>> = {
  attack: {
    opening: ['主攻前期“打下放上”：借上家的牌顺掉弱牌，适度限制下家拿牌权', '先处理有回收的弱路和以后难顺的牌，保留能调整的组合'],
    middle: ['到位就启动；留好冲刺的炸弹，不做无效的跟炸'],
    endgame: ['主攻留实力：先用登基牌逼炸，再冲刺；防对手再顺一手就用大炸到位'],
  },
  support: {
    opening: ['助攻前期“打上放下”：限制上家拿牌权，下家领牌时让对家顺牌（危险的下家必须拦）', '情况不明用中小对子试探，别贸然让对手顺走五张牌'],
    middle: ['主动送牌、消耗对手火力；卡住下家想顺的牌，也别把对家要的小牌挡死'],
    endgame: ['助攻打消耗：牌散的一方先出炸拦截，把对家的炸弹留给冲刺'],
  },
  undecided: {
    opening: ['牌力在交界：先看对家强弱和自己的结构，不急着定主攻还是助攻'],
    middle: ['谁更接近走完，谁转主攻'],
    endgame: ['每次对手报牌重新判断：角色变没变、大牌在哪、还有几手炸弹、普通牌还要几手'],
  },
};

const GOAL_CN = { first: '争上游（还没有人出完）', second: '对家已头游，争取二游打成双上', protect: '对手已头游，保对家不当末游、阻止对方双上' } as const;

/** 托管一手牌的决策依据：局面、自己的手牌、三家的出牌情况和本阶段适用的规则 */
export interface DecisionContext {
  /** 牌力评估和打法（面板最上面） */
  power?: { level: string; points: number; detail: string; role: string; why: string };
  /** 外面（其他三家手里还有的：总数减去自己手里的和已经打出去的）大王、小王、级牌（含逢人配）、A、K 各几张；total 是两副牌的总数 */
  outside?: { name: string; left: number; total: number; note?: string }[];
  stage: string;
  focus: string[];
  goal: string;
  /** 本手是首出还是压牌 */
  trick: string;
  hand: { cards: string; plan: string[]; hands: number; bombs: number };
  seats: { who: string; left: number; place: number; plays: number; recent: string[]; passes: string[]; known: string[] }[];
  facts: string[];
  /** 选中出法命中的教材规则（按阶段匹配） */
  book: string[];
  /** 每手牌的五问（《掼蛋规则与实战技巧》第十二章）：对选中的出法逐条回答 */
  five?: { q: string; a: string }[];
}

export function decisionContext(inp: AdviceInput, adv: Advice, chosen: AdviceOption | undefined): DecisionContext {
  const { seat, hand, level, target, targetSeat, counts, tracker } = inp;
  const name = (s: number) => (s === seat ? '我' : WHO_CN[WHO[rel(seat, s)]]);
  const st = unseenStat(tracker.unseen(hand, inp.partnerHand ?? null), level);
  const split = bestSplit(hand, level, st);
  const sorted = [...hand].sort((a, b) => cardValue(b, level) - cardValue(a, level));
  const stage = STAGE_FOCUS[adv.stage ?? ''] ?? { name: adv.stage ?? '未知', focus: [] };
  const pw = adv.power;
  // 外面 = 其他三家手里还有的：总数 − 自己手里的 − 已经打出去的（自己出完后看得到的对家手牌也还在外面）
  const out = unseenStat(tracker.unseen(hand), level);
  const cnt = (r: number) => out.byRank.get(r) ?? 0;
  const outside: NonNullable<DecisionContext['outside']> = [
    { name: '大王', left: cnt(BIG_JOKER), total: 2 },
    { name: '小王', left: cnt(SMALL_JOKER), total: 2 },
    { name: `级牌${rankName(level)}`, left: cnt(level) + out.wilds, total: 8, ...(out.wilds ? { note: `含逢人配 ${out.wilds}` } : {}) },
    // 打 A 或打 K 时它们就是级牌，不重复列
    ...[14, 13].filter((r) => r !== level).map((r) => ({ name: rankName(r), left: cnt(r), total: 8 })),
  ];
  return {
    outside,
    power: pw && {
      level: coursePower.enabled ? TIER_CN[pw.tier] : { strong: '强', medium: '中等', weak: '弱' }[pw.strength],
      points: pw.points,
      detail: [`拆成 ${pw.hands} 手`, `炸弹 ${pw.bombs} 个（+${pw.bombPoints}）`, `登基牌（外面压不住）${pw.controls} 手（+${pw.controls}）`,
        `坠牌（要先拿到出牌权才能出的小牌）${pw.lows} 手（-${pw.lows}）`, ...(pw.doubleDown ? ['被打双下（-2）'] : [])].join('，'),
      role: { attack: '抢头游（主攻）', support: '送对家（助攻）', undecided: '先看对家牌路（还没定）' }[pw.role],
      why: pw.why,
    },
    stage: stage.name,
    focus: [...(pw ? ROLE_FOCUS[pw.role][adv.stage ?? ''] ?? [] : []), ...stage.focus],
    goal: GOAL_CN[goalOf(seat, tracker)],
    trick: target && targetSeat !== null ? `压${name(targetSeat)}的${comboLabel(target, level)}` : '我先出（首出）',
    hand: {
      cards: sorted.map((id) => cardLabel(id, level)).join(' '),
      plan: split.combos.map((c) => comboLabel(c, level)),
      hands: split.combos.filter((c) => !isBomb(c)).length,
      bombs: split.combos.filter(isBomb).length,
    },
    // 顺序：下家、对家、上家
    seats: [1, 2, 3].map((d) => (seat + d) % 4).map((s) => {
      const r = tracker.seats[s];
      return {
        who: name(s), left: counts[s], place: r.place, plays: r.plays.length,
        recent: r.plays.slice(-5).map((c) => comboLabel(c, level)),
        passes: [...new Set(r.passes.filter((p) => p.seat % 2 !== s % 2).slice(-4).map((p) => typeName(p.type)))],
        known: [...r.known].map((id) => cardLabel(id, level)),
      };
    }),
    facts: adv.facts,
    book: [
      ...(chosen?.rules ?? []).filter((h) => COURSE_RULE_IDS.has(h.id)).map((h) => `${RULES[h.id].name}（${RULES[h.id].source}）`),
      ...(chosen?.book ?? []).filter((id) => BOOK_RULES[id]).map((id) => `${id} ${BOOK_RULES[id].title}`),
    ],
    five: chosen && fiveQuestions(inp, adv, chosen, st),
  };
}

/** 每手牌的五问：谁更有机会先走、这一手在做什么、谁会因此拿牌权、拿到牌权出什么、还留几次控制 */
function fiveQuestions(inp: AdviceInput, adv: Advice, o: AdviceOption, st: UnseenStat): { q: string; a: string }[] {
  const { seat, hand, level, target, targetSeat, counts } = inp;
  const partner = (seat + 2) % 4, next = (seat + 1) % 4, prev = (seat + 3) % 4;
  const name = (s: number) => (s === seat ? '我' : WHO_CN[WHO[rel(seat, s)]]);
  const c = o.combo, f = o.features;
  const rest = c ? hand.filter((id) => !c.cards.includes(id)) : hand;
  const restCombos = rest.length ? bestSplit(rest, level, st).combos : [];
  const plain = restCombos.filter((x) => !isBomb(x));
  const ctl = plain.filter((x) => controlOf(x, st, level) !== 'beatable');
  const weak = plain.filter((x) => controlOf(x, st, level) === 'beatable').sort((a, b) => a.value - b.value);
  const bombs = restCombos.filter(isBomb);

  // 1 谁更有机会先走：比较各家剩余张数，自己按牌力打法
  const alive = [seat, next, partner, prev].filter((s) => counts[s] > 0);
  const lead = [...alive].sort((a, b) => counts[a] - counts[b])[0];
  const role = adv.power ? { attack: '主攻', support: '助攻', undecided: '还没定' }[adv.power.role] : '';
  const a1 = `${alive.map((s) => `${name(s)} ${counts[s]} 张`).join('、')}；${name(lead)}最接近走完${role ? `，我这手按${role}打` : ''}`;

  // 2 这一手在做什么
  let a2: string;
  if (!c || !f) a2 = targetSeat === partner ? '让对家：不抢他的牌权' : '放行：留着控制牌和炸弹，等更合适的时机';
  else if (f.finishes) a2 = '走完最后一手';
  else if (f.isBomb) a2 = target ? (counts[targetSeat!] <= 10 ? '拦截：用炸弹截断快到位的对手' : '消耗火力：用炸弹抢回牌权') : '冲刺：主动出炸弹';
  else if (!target) {
    if (counts[partner] > 0 && counts[partner] <= 5 && c.value <= 10 && (c.type === 'single' || c.type === 'pair')) a2 = '送队友：出对家可能接得住的小牌';
    else if (f.control !== 'beatable') a2 = '逼炸 / 拿牌权：出外面同类压不住的牌';
    else a2 = `顺自己的弱牌${ctl.some((x) => x.type === c.type) ? '（有打有收：手里还有同类的登基牌能收回牌权）' : ''}`;
  } else if (targetSeat === partner) a2 = '接对家的牌';
  else if (f.control !== 'beatable') a2 = `卡对手：用外面同类压不住的牌拿下${name(targetSeat!)}的牌权`;
  else a2 = `顺牌：借${name(targetSeat!)}的牌处理自己的${typeName(c.type)}`;

  // 3 谁会因此拿牌权
  let a3: string;
  if (!c || !f) a3 = target && targetSeat !== null ? `大概率是${name(targetSeat)}（他这手牌还压在桌上）` : '—';
  else if (f.finishes) a3 = counts[partner] > 0 ? '没人压得住的话由对家接风' : '我已出完';
  else a3 = { unbeatable: '我：外面没人压得住', bombOnly: '我，除非有人用炸弹', beatable: '不一定：外面还有同类更大的牌' }[f.control];

  // 4 拿到牌权出什么
  const a4 = !rest.length ? '已经出完'
    : weak.length ? `接着处理${weak.slice(0, 2).map((x) => comboLabel(x, level)).join('、')}${weak.length > 2 ? ` 等 ${weak.length} 手弱牌` : ''}`
    : '剩下的都是登基牌和炸弹，可以直接冲刺';

  // 5 还留几次控制
  const a5 = `${ctl.length} 手登基牌${ctl.length ? `（${ctl.slice(0, 3).map((x) => comboLabel(x, level)).join('、')}）` : ''}、${bombs.length} 个炸弹；还有 ${weak.length} 手弱牌要处理`;

  return [
    { q: '谁更有机会先走', a: a1 },
    { q: '这一手在做什么', a: a2 },
    { q: '谁会因此拿牌权', a: a3 },
    { q: '拿到牌权出什么', a: a4 },
    { q: '还留几次控制', a: a5 },
  ];
}
