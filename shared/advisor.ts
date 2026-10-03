// 出牌顾问：结合记牌器，为“提示”列出候选出法、计算特征、给出本地排序和理由，并生成交给 Jev 的信息。
import { card, cardValue, isWild, rankName, value, BIG_JOKER, SMALL_JOKER, type Suit } from './cards';
import { bombLevel, comboName, isBomb, type Combo } from './combo';
import { findAllPlays } from './finder';
import { bestSplit, aiPlay, preferLooseCards } from './ai';
import { CardTracker, unseenStat, type UnseenStat } from './tracker';

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
}

export interface Inference { who: 'partner' | 'left' | 'right'; text: string; confidence: number }

export interface Advice {
  options: AdviceOption[];
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

/** 外面是否可能凑出炸弹（不含天王炸） */
function bombPossible(st: UnseenStat): boolean {
  for (let r = 2; r <= 14; r++) if ((st.byRank.get(r) ?? 0) + st.wilds >= 4 && (st.byRank.get(r) ?? 0) > 0) return true;
  return false;
}

function jokerBombPossible(st: UnseenStat): boolean {
  return (st.byRank.get(SMALL_JOKER) ?? 0) === 2 && (st.byRank.get(BIG_JOKER) ?? 0) === 2;
}

/** 外面能否用同类型的牌压过 */
function sameTypeBeatable(c: Combo, st: UnseenStat, level: number): boolean {
  const nat = (r: number) => st.byRank.get(r) ?? 0;
  const v = (r: number) => value(r, level);
  switch (c.type) {
    case 'single':
      return st.topValue > c.value;
    case 'pair':
      if (st.wilds >= 2 && 15 > c.value) return true;
      for (const r of [SMALL_JOKER, BIG_JOKER]) if (nat(r) >= 2 && r > c.value) return true;
      for (let r = 2; r <= 14; r++) if (v(r) > c.value && nat(r) >= 1 && nat(r) + st.wilds >= 2) return true;
      return false;
    case 'triple': case 'fullhouse':
      for (let r = 2; r <= 14; r++) if (v(r) > c.value && nat(r) >= 1 && nat(r) + st.wilds >= 3) return true;
      return false;
    case 'straight': case 'tube': case 'plate': {
      const [len, mult] = c.type === 'straight' ? [5, 1] : c.type === 'tube' ? [3, 2] : [2, 3];
      for (let start = c.value + 1; start + len - 1 <= 14; start++) {
        let need = 0;
        for (let p = 0; p < len; p++) need += Math.max(0, mult - nat(start + p));
        if (need <= st.wilds) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

export function controlOf(c: Combo, st: UnseenStat, level: number): Control {
  if (c.type === 'jokerbomb') return 'unbeatable';
  if (isBomb(c)) {
    if (jokerBombPossible(st)) return 'beatable';
    // 外面能凑出的最大炸弹张数
    let maxSize = 0;
    for (let r = 2; r <= 14; r++) {
      const n = st.byRank.get(r) ?? 0;
      if (n > 0) maxSize = Math.max(maxSize, n + st.wilds);
    }
    const lvl = bombLevel(c);
    return maxSize >= 6 || (maxSize >= 4 && lvl <= 2) ? 'beatable' : 'unbeatable';
  }
  if (sameTypeBeatable(c, st, level)) return 'beatable';
  return bombPossible(st) || jokerBombPossible(st) ? 'bombOnly' : 'unbeatable';
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
  if (!bombPossible(st) && !jokerBombPossible(st)) facts.push('外面已经凑不出任何炸弹');
  else if (jokerBombPossible(st)) facts.push('外面可能还有天王炸');
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const known = [...tracker.seats[s].known];
    if (known.length) facts.push(`${WHO_CN[WHO[rel(seat, s)]]}手里确定有：${known.map((id) => cardLabel(id, level)).join('、')}（进贡/还贡时可知）`);
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
    if (rec.count > 0 && rec.count <= 3) {
      const guess = rec.count === 1 ? '单张' : rec.count === 2 ? '一对或两张单张' : '三张或对子加单张';
      inferred.push({ who, text: `只剩 ${rec.count} 张，可能是${guess}`, confidence: 0.6 });
    }
  }
  return { facts, inferred };
}

function typeName(t: string): string {
  return ({ single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二', straight: '顺子', tube: '三连对', plate: '钢板' } as Record<string, string>)[t] ?? t;
}

// ---------- 候选与评分 ----------

export function advise(inp: AdviceInput): Advice {
  const { seat, hand, level, target, targetSeat, counts, tracker } = inp;
  const partner = (seat + 2) % 4, next = (seat + 1) % 4, prev = (seat + 3) % 4;
  const st = unseenStat(tracker.unseen(hand, inp.partnerHand ?? null), level);
  const { facts, inferred } = collectFacts(inp, st);
  const base = bestSplit(hand, level);
  const baseHands = base.combos.filter((x) => !isBomb(x)).length;
  const leading = !target;
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
  const cands = findAllPlays(hand, level, target);
  cands.forEach((c0, i) => {
    const c = preferLooseCards(c0, hand, level, base.combos.map((x) => x.cards));
    const used = new Set(c.cards);
    const rest = hand.filter((id) => !used.has(id));
    const split = rest.length ? bestSplit(rest, level) : { score: -10, combos: [] as Combo[] };
    const take = new Map<number, number>();
    for (const id of c.cards) if (!isWild(id, level)) take.set(card(id).rank, (take.get(card(id).rank) ?? 0) + 1);
    const breaksBomb = [...take].some(([r, n]) => (have.get(r) ?? 0) >= 4 && (have.get(r) ?? 0) - n < 4) && !isBomb(c);
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
      if (active(partner) && counts[partner] === 1 && c.type === 'single' && small) { score -= 4; reasons.push('对家只剩 1 张，出小单张让他走'); }
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
      if (counts[s] === 1 && c.type === 'single') { score += s === next ? 4 : 2; reasons.push(`${name}只剩 1 张，避免出单张`); }
      if (counts[s] === 2 && c.type === 'pair') { score += s === next ? 3 : 1.5; reasons.push(`${name}只剩 2 张，避免出对子`); }
    }
    if (c.type === 'single' && cardValue(c.cards[0], level) === 15 && !(st.byRank.get(SMALL_JOKER) ?? 0) && !(st.byRank.get(BIG_JOKER) ?? 0)) {
      reasons.push('大小王已出完，级牌是最大的单张');
    }
    if (f.breaksBomb) { score += 0.8; reasons.push('会拆掉炸弹'); }
    else if (!urgent && !f.finishes && !f.isBomb && f.handsLeft >= baseHands) { score += 1.0; reasons.push('会拆散已有的牌型'); }
    if (!reasons.length) reasons.push(f.handsLeft <= 1 ? '出完后很快就能走完' : `出完后还剩 ${f.handsLeft} 手牌`);
    options.push({ id: `p${i}`, combo: c, label: comboLabel(c, level), features: f, score, reasons });
  });

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
    options.push({ id: 'pass', combo: null, label: '不出', features: null, score, reasons });
  }

  // 以电脑的决策为基础：电脑会出的那手优先，只有强规则（对家/对手快出完、一手出完）才会推翻
  const ai = aiPlay({ seat, hand, level, target, targetSeat, handCounts: counts });
  const aiKey = ai ? [...ai.cards].sort().join(',') : 'pass';
  for (const o of options) {
    const k = o.combo ? [...o.combo.cards].sort().join(',') : 'pass';
    if (k === aiKey && !o.features?.finishes) o.score -= 3;
  }
  options.sort((a, b) => a.score - b.score);
  return { options, facts, inferred };
}

// ---------- 交给 Jev 的信息 ----------

export function buildJevContext(inp: AdviceInput, adv: Advice) {
  const { seat, hand, level, target, targetSeat, counts, tracker } = inp;
  const name = (s: number) => (s === seat ? '我' : WHO_CN[WHO[rel(seat, s)]]);
  const st = unseenStat(tracker.unseen(hand, inp.partnerHand ?? null), level);
  const unseen: Record<string, number> = {};
  for (const [r, n] of [...st.byRank].sort((a, b) => value(b[0], level) - value(a[0], level))) unseen[rankName(r)] = n;
  if (st.wilds) unseen['逢人配'] = st.wilds;
  return {
    game: '掼蛋（两副牌，四人，对家为队友）',
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
    })),
  };
}
