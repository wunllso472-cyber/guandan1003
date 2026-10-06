// 教材策略规则库（shared/guandan-ai，56 条，出自《江苏省掼蛋项目一线社会体育指导员再培训教材》）的接入层。
// 从自己的手牌、记牌器（各家已出的牌、不出、余牌数）和当前桌面计算规则库的特征，
// 按实际局面判断开局 / 中局 / 残局，用规则库的匹配器找出对每个候选出法适用的规则。
// 规则库的 priority 只是检查顺序，不是分数；这里为可落到候选出法上的规则给出方向和分量，
// 与 shared/strategy.ts 已有规则重复的条目（如 T04≈DONT_OVERTAKE、M06≈BOMB_PURPOSE）只作依据、不重复计分。
import { card, cardValue, isWild, value } from './cards';
import { bombLevel, isBomb, type Combo, type ComboType } from './combo';
import { ruleLibrary } from './guandan-ai/data';
import { matchRules, type RuleLibrary, type StrategyRule } from './guandan-ai/rules';
import type { FeatureContext } from './guandan-ai/features';
import type { Stage } from './guandan-ai/protocol';
import type { CardTracker } from './tracker';
import { profileSeats, type SeatProfile } from './inference';
import type { Control, OptionFeatures } from './advisor';
import { disabledRules, type RuleHit } from './strategy';

const library = ruleLibrary as unknown as RuleLibrary;
export const BOOK_RULES: Record<string, StrategyRule> = Object.fromEntries(library.rules.map((r) => [r.id, r]));

/** 评估用：临时停用全部教材规则（只在离线对打测试中设置；单条规则用 strategy.ts 的 disabledRules） */
export const bookSwitch = { enabled: true };

export interface BookInput {
  seat: number;
  hand: number[];
  level: number;
  target: Combo | null;
  targetSeat: number | null;
  counts: number[];
  tracker: CardTracker;
  /** 当前手牌的最佳拆分（不含炸弹的组合与炸弹） */
  baseCombos: Combo[];
  controlOf: (c: Combo) => Control;
}

/** 自己的牌力评估和由此决定的打法（主攻抢头游 / 助攻送对家） */
export interface Power {
  /** 教材经验分：炸弹 +4、外面压不住的一手 +1、要先拿到出牌权才能出的小牌 -1 */
  points: number;
  strength: 'strong' | 'medium' | 'weak';
  bombs: number;
  /** 外面压不住的手数 */
  controls: number;
  /** 难出的小牌手数 */
  lows: number;
  /** 不含炸弹的手数 */
  hands: number;
  role: 'attack' | 'support' | 'undecided';
  /** 定这个打法的原因 */
  why: string;
}

export interface BookState {
  stage: Stage;
  power: Power;
  features: FeatureContext;
  /** 对手在本方领出的这些牌型上反复顺牌 */
  shedTypes: Set<ComboType>;
  /** 三家画像（I01–I08），自己的位置为 null */
  profiles: (SeatProfile | null)[];
}

const SPECIAL: ComboType[] = ['tube', 'plate'];
const low = (c: Combo) => c.value <= 10 && !isBomb(c);

/** 局面特征（与候选无关的部分） */
export function bookState(inp: BookInput): BookState {
  const { seat, hand, counts, tracker, target, targetSeat, baseCombos, controlOf } = inp;
  const partner = (seat + 2) % 4, next = (seat + 1) % 4, prev = (seat + 3) % 4;
  const active = (s: number) => counts[s] > 0;
  const opps = [next, prev].filter(active);
  const minOpp = opps.length ? Math.min(...opps.map((s) => counts[s])) : null;
  const finished = [0, 1, 2, 3].some((s) => tracker.seats[s].place > 0);
  const played = 108 - counts.reduce((a, x) => a + x, 0);

  // 阶段按实际局面判断：有人出完或任一家余牌不超过 10 张进入残局（提示词步骤 3 的实现建议）
  const stage: Stage = finished || [0, 1, 2, 3].some((s) => active(s) && counts[s] <= 10) ? 'endgame' : played <= 24 ? 'opening' : 'middle';

  // 教材经验计分：每把炸弹 +4、每手外面压不住的牌 +1、每手要先拿到出牌权才能出的小牌 -1
  let bombs = 0, controls = 0, lows = 0;
  for (const c of baseCombos) {
    if (isBomb(c)) bombs++;
    else if (controlOf(c) !== 'beatable') controls++;
    else if (low(c)) lows++;
  }
  const points = bombs * 4 + controls - lows;
  const strength = points >= 12 ? 'strong' : points >= 6 ? 'medium' : 'weak';
  // 三家画像：对家像在主攻时，自己（不是强牌）转为助攻；对手像在主攻时，提前当作冲刺威胁
  const profiles = profileSeats(tracker, seat);
  const partnerAttacks = active(partner) && profiles[partner]?.role === 'attack';
  const strengthCn = { strong: '强', medium: '中等', weak: '弱' }[strength];
  let role: Power['role'] = strength === 'strong' ? 'attack' : strength === 'weak' ? 'support' : 'undecided';
  let why = strength === 'strong' ? '12 分以上，自己主攻抢头游'
    : strength === 'weak' ? '不到 6 分，打助攻给对家送牌'
    : '6–11 分，先看对家的牌路再定主攻还是助攻';
  if (!active(partner)) { role = 'attack'; why = '对家已出完，只能自己冲'; }
  else if (counts[partner] + 5 <= hand.length && counts[partner] <= 12) { role = 'support'; why = `对家只剩 ${counts[partner]} 张，比我少 ${hand.length - counts[partner]} 张，送对家先走`; }
  else if (partnerAttacks && strength !== 'strong') { role = 'support'; why = `对家像在主攻，我牌力${strengthCn}，转为助攻`; }
  const hands = baseCombos.filter((c) => !isBomb(c)).length;
  const power: Power = { points, strength, bombs, controls, lows, hands, role, why };

  // 本方领出的牌型，对手跟着顺牌的次数
  const shed = new Map<ComboType, number>();
  let leadType: ComboType | null = null, leadTeam = -1;
  for (const h of tracker.history) {
    if (!h.combo) continue;
    if (h.lead) { leadType = h.combo.type; leadTeam = h.seat % 2; continue; }
    if (leadTeam === seat % 2 && h.seat % 2 !== seat % 2 && h.combo.type === leadType) shed.set(leadType, (shed.get(leadType) ?? 0) + 1);
  }
  const shedTypes = new Set([...shed].filter(([, n]) => n >= 2).map(([t]) => t));

  const fromOpp = target !== null && targetSeat !== null && targetSeat % 2 !== seat % 2;
  const singlesLow = baseCombos.filter((c) => c.type === 'single' && low(c) && controlOf(c) === 'beatable').length;
  const features: FeatureContext = {
    'state.rules_verified': true,
    'state.inconsistent': false,
    'state.strength_band': strength,
    'state.role': role,
    'state.current_winner_relation': target ? (targetSeat === partner ? 'partner' : 'opponent') : 'none',
    'state.immediate_danger': minOpp !== null && minOpp <= 3,
    'state.opponent_sprint_threat': fromOpp && (counts[targetSeat!] <= 8 || (profiles[targetSeat!]?.role === 'attack' && counts[targetSeat!] <= 12)),
    'state.opponent_near_listen': minOpp !== null && minOpp <= 5,
    'state.verified_opponent_immediate_win': minOpp !== null && minOpp <= 2,
    'state.threat_seat_remaining': minOpp,
    'state.partner_cannot_bridge': !active(partner),
    'state.partner_has_attack_opportunity': active(partner) && (counts[partner] + 5 <= hand.length || partnerAttacks),
    // 对手出小牌，而他的搭档快出完：可能在送牌
    'state.opponent_feed_threat': fromOpp && target!.value <= 10 && !isBomb(target!) && active((targetSeat! + 2) % 4) && counts[(targetSeat! + 2) % 4] <= 4,
    'state.opponent_repeatedly_sheds_on_route': shedTypes.size > 0,
    'state.self_has_strong_bomb': baseCombos.some((c) => isBomb(c) && bombLevel(c) >= 3),
    'state.single_route_weak': singlesLow >= 3,
    // T03：自己按牌力偏主攻，但对家已经比自己少很多张，主攻应转给对家
    'state.attack_role_needs_review': strength !== 'weak' && active(partner) && counts[partner] + 6 <= hand.length,
    // M07：上家（对手）出的牌，他剩得不多，放行可能让他先走
    'state.upstream_can_feed_self': target !== null && targetSeat === prev && active(prev) && counts[prev] <= 8,
  };
  return { stage, power, features, shedTypes, profiles };
}

export interface BookCandidate {
  combo: Combo;
  features: OptionFeatures;
  /** 出完这手后剩下的组合 */
  rest: Combo[];
  baseHands: number;
  canRecapture: boolean;
}

/** 候选出法的特征 */
function candidateFeatures(inp: BookInput, bs: BookState, cand: BookCandidate): FeatureContext {
  const { seat, counts, target, targetSeat, level, controlOf } = inp;
  const { combo: c, features: f, rest } = cand;
  const partner = (seat + 2) % 4;
  const leading = !target;
  const restHands = rest.filter((x) => !isBomb(x));
  const weakRest = restHands.filter((x) => controlOf(x) === 'beatable');
  const lowSingles = restHands.filter((x) => x.type === 'single' && low(x) && controlOf(x) === 'beatable').length;
  // 弱路不能回收：剩下某种牌型有压得住的小牌，却没有同类外面压不住的大牌
  const unrecoverable = weakRest.some((w) => !restHands.some((x) => x.type === w.type && controlOf(x) !== 'beatable'));
  const minOpp = bs.features['state.threat_seat_remaining'];
  const vulnerable = minOpp === 1 ? restHands.some((x) => x.type === 'single' && controlOf(x) === 'beatable')
    : minOpp === 2 ? restHands.some((x) => x.type === 'pair' && controlOf(x) === 'beatable') : false;
  const secures = f.finishes || (f.control === 'unbeatable' && !f.isBomb && weakRest.length <= 1 && restHands.length <= 1);
  // 只剩一手、外面压得住、自己拿不回出牌权：要靠对家送牌（E04）
  const needsBridge = !f.finishes && restHands.length === 1 && weakRest.length === 1 && counts[partner] > 0;
  // 三带二：同一个三张还能带别的对子时，算出这次带的对子和最小可带对子（H03）
  const pairChoice = c.type === 'fullhouse' ? fullhousePairs(inp.hand, c, level) : null;
  return {
    'action.legal_validated': true,
    'action.leads_pair': leading && c.type === 'pair',
    'action.leads_special_group': leading && SPECIAL.includes(c.type),
    'action.uses_bomb': f.isBomb,
    'action.uses_small_bomb': f.isBomb && bombLevel(c) <= 2,
    'action.breaks_existing_group': !f.finishes && !f.isBomb && f.handsLeft >= cand.baseHands,
    'action.intercepts_straight': !!target && target.type === 'straight' && targetSeat !== partner && c.type === 'straight',
    'action.intends_feed_partner': leading && counts[partner] > 0 && counts[partner] <= 5 && low(c) && (c.type === 'single' || c.type === 'pair'),
    'action.has_recovery_plan': leading && cand.canRecapture,
    'action.secures_team_first': secures,
    'plan.has_small_straight': c.type === 'straight' && c.value <= 6,
    'plan.new_low_single_count': lowSingles,
    'plan.has_bombs': rest.some(isBomb),
    'plan.has_small_special_group': rest.some((x) => SPECIAL.includes(x.type) && x.value <= 8),
    'plan.no_smooth_followup': restHands.length >= 3 && weakRest.length >= 2,
    // 清牌链：还有外面压不住的牌能拿回出牌权，弱牌不超过一手（只剩一手弱牌时归 E04）
    'plan.has_verified_clear_chain': restHands.length >= 2 && weakRest.length <= 1,
    'plan.needs_partner_bridge': needsBridge,
    'plan.considers_initiative_transfer': !f.finishes && restHands.length <= 1 && counts[partner] > 0,
    'plan.has_full_house_attachment_choice': !!pairChoice && pairChoice.options > 1,
    'plan.can_keep_low_tail': weakRest.length === 1 && restHands.length >= 2,
    'plan.low_route_unrecoverable': unrecoverable,
    'plan.shares_vulnerable_listen_route': vulnerable,
    // H04：首出对子且手里还剩两对以上
    'plan.can_keep_pair_gradient': leading && c.type === 'pair' && restHands.filter((x) => x.type === 'pair').length >= 2,
    // O02：首出外面压得住的小牌，同时还留着外面压不住的牌（藏优）
    'action.hides_strength': leading && !f.isBomb && f.control === 'beatable' && c.value <= 10 && restHands.some((x) => controlOf(x) !== 'beatable'),
    // E08：对手快听牌，拆炸弹组出的牌外面压不住
    'plan.can_split_bomb_for_safe_group': f.breaksBomb && !f.isBomb && f.control !== 'beatable' && typeof minOpp === 'number' && minOpp <= 5,
    // E11：对手只剩 1 张时，这手用掉了自己最大的单张（拦截送牌的干扰牌）
    'plan.can_interfere_enemy_bridge': minOpp === 1 && !f.finishes && c.type === 'single' && cardValue(c.cards[0], level) >= 14
      && !restHands.some((x) => x.type === 'single' && x.value >= 14),
    // 级牌单张：用于“同类最大”的判断说明
    'belief.claims_top_route': c.type === 'single' && cardValue(c.cards[0], level) === 15 ? true : undefined,
  };
}

/** 三带二的附带对子：这次带的对子点值、手里能带的最小对子点值、可选对子数 */
function fullhousePairs(hand: number[], c: Combo, level: number): { mine: number; min: number; options: number } | null {
  const naturals = c.cards.filter((id) => !isWild(id, level));
  const byRank = new Map<number, number>();
  for (const id of naturals) byRank.set(card(id).rank, (byRank.get(card(id).rank) ?? 0) + 1);
  const triple = [...byRank].sort((a, b) => b[1] - a[1])[0]?.[0];
  const pairRank = [...byRank.keys()].find((r) => r !== triple);
  if (triple === undefined || pairRank === undefined) return null;
  const held = new Map<number, number>();
  for (const id of hand) if (!isWild(id, level)) held.set(card(id).rank, (held.get(card(id).rank) ?? 0) + 1);
  // 只看自然对子（不用配牌）、不拆炸弹的可带对子
  const pairs = [...held].filter(([r, n]) => r !== triple && n >= 2 && n < 4 && r < 16).map(([r]) => cardValue(hand.find((id) => card(id).rank === r && !isWild(id, level))!, level));
  if (!pairs.length) return null;
  return { mine: value(pairRank, level), min: Math.min(...pairs), options: pairs.length };
}

type Weigh = (x: { inp: BookInput; bs: BookState; cand: BookCandidate | null; fc: FeatureContext }) => { w: number; note: string } | null;

/**
 * 能落到具体出法上的规则：返回分量（负数更推荐）和给玩家看的说明。
 * 分量都不大（±1 以内），只调整候选先后，不推翻一手出完、送对家等强规则。
 */
const WEIGHTS: Record<string, Weigh> = {
  // 慎接对家领出：原有 DONT_OVERTAKE 已计分；画像显示对家在主攻（I05–I07）时再加重
  T04: ({ inp, bs, cand }) => cand && !cand.features.finishes && inp.targetSeat !== null && bs.profiles[inp.targetSeat]?.role === 'attack'
    ? { w: 0.4, note: '对家像在主攻，别打断他的牌路' } : null,
  T02: ({ fc }) => fc['action.intends_feed_partner'] ? { w: -0.3, note: '牌力偏弱，打助攻给对家送牌' } : null,
  H02: ({ fc }) => fc['state.role'] !== 'support' ? { w: 0.4, note: '组小顺子会留下多张难出的小单张' } : null,
  H05: ({ fc }) => fc['action.leads_special_group'] ? { w: 0.4, note: '打助攻时小三连对、钢板留着拆成对子三张送牌' } : null,
  O03: () => ({ w: -0.2, note: '单张路弱，先出对子试探' }),
  O04: () => ({ w: 0.4, note: '打助攻先出特殊牌型，对家难接' }),
  M01: ({ bs, cand, inp }) => !inp.target && cand && bs.shedTypes.has(cand.combo.type) ? { w: 0.5, note: '对手在这种牌型上一直顺牌，换一条路' } : null,
  M02: ({ inp, cand }) => {
    // 牌弱、对家有机会时，加强卡位：上家出的牌尽量压住，别让他顺利传牌
    if (!inp.target || inp.targetSeat !== (inp.seat + 3) % 4) return null;
    if (!cand) return { w: 0.3, note: '对家有机会，放过上家等于帮对手' };
    return cand.features.isBomb ? null : { w: -0.2, note: '打助攻，压住上家帮对家卡位' };
  },
  M03: ({ cand }) => {
    if (!cand) return { w: 1.0, note: '对手可能在给快出完的搭档送牌，不能放过' };
    return { w: cand.features.control === 'beatable' ? -0.2 : -0.5, note: '切断对手传牌' };
  },
  M04: ({ cand }) => {
    if (!cand || cand.features.isBomb) return null;
    return cand.features.control === 'beatable'
      ? { w: 0.2, note: '对手在冲刺，小跟一手可能拦不住' }
      : { w: -0.3, note: '对手在冲刺，用外面压不住的牌卡住他' };
  },
  M05: ({ cand }) => cand && cand.features.control !== 'beatable'
    ? { w: -0.3, note: '用最大的顺子封顶，逼对方用炸弹' }
    : { w: 0.2, note: '顺子没封顶，可能被同类压回' },
  E01: ({ cand }) => cand && !cand.features.finishes ? { w: -1.5, note: '这样出本方能先走完' } : null,
  E03: ({ inp, cand }) => {
    if (inp.target || !cand || cand.features.control !== 'beatable') return null;
    const tail = cand.rest.filter((x) => !isBomb(x) && inp.controlOf(x) === 'beatable');
    return tail.length === 1 && tail[0].value < cand.combo.value ? { w: -0.3, note: '先出稍大的牌，最小的留作最后一手' } : null;
  },
  E05: ({ inp, cand }) => !inp.target && cand && !cand.features.isBomb && cand.features.control !== 'beatable'
    ? { w: -0.3, note: '对手快听牌，先出同类最大的牌逼他用炸弹' } : null,
  E06: () => ({ w: -0.4, note: '对手快出完，小炸弹及时用掉争出牌权' }),
  E07: () => ({ w: 0.5, note: '有大炸弹但炸完后走不顺，对手也不急，先留着' }),
  T03: ({ cand, fc, inp }) => {
    if (!cand) return null;
    if (fc['action.intends_feed_partner']) return { w: -0.3, note: '对家牌比我少得多，主攻交给对家，给他送牌' };
    if (inp.targetSeat === (inp.seat + 2) % 4 && !cand.features.finishes) return { w: 0.3, note: '对家牌比我少得多，别抢他的牌' };
    return null;
  },
  H04: ({ cand }) => {
    if (!cand) return null;
    const pairs = [...cand.rest.filter((x) => x.type === 'pair').map((x) => x.value), cand.combo.value];
    return cand.combo.value <= Math.min(...pairs)
      ? { w: -0.15, note: '先走小对子，留下大小有梯度的对子方便回收' }
      : { w: 0.15, note: '先走了大对子，剩下的对子回收能力变弱' };
  },
  O02: ({ cand, inp }) => {
    if (!cand) return null;
    const weak = cand.rest.filter((x) => !isBomb(x) && inp.controlOf(x) === 'beatable').length;
    return weak >= 3
      ? { w: 0.3, note: '藏优要有前提：重新上手后还有多手弱牌，不宜先走弱牌' }
      : { w: -0.2, note: '上手资源够，先走弱牌、藏住优势牌' };
  },
  M07: ({ cand, inp }) => (!cand ? { w: 0.3, note: `上家只剩 ${inp.counts[inp.targetSeat!]} 张，一直放行可能让他先走` } : null),
  E08: () => ({ w: -0.5, note: '对手快听牌，拆炸组出外面压不住的牌来阻截' }),
  E11: () => ({ w: 0.3, note: '对手只剩 1 张，最大的单张留着拦截他搭档的送牌' }),
  E04: ({ cand }) => {
    if (!cand) return null;
    const tail = cand.rest.find((x) => !isBomb(x));
    if (!tail) return null;
    return tail.value >= 10
      ? { w: -0.3, note: '最后留一手较大的牌，对家送牌时接得住、对手不容易截' }
      : { w: 0.2, note: '最后留的牌太小，对家送牌时也容易被对手截走' };
  },
  H03: ({ inp, cand }) => {
    if (!cand) return null;
    const pc = fullhousePairs(inp.hand, cand.combo, inp.level);
    if (!pc || pc.options < 2) return null;
    // 出牌生成器默认带最小的对子，已符合 H03，只作依据不计分（否则等于额外鼓励出三带二）
    return pc.mine <= pc.min ? null : { w: 0.2, note: '三带二带了大对子，小对子还留在手里' };
  },
};

/** 对一个候选（null 表示不出）找出适用的教材规则，并给出分量 */
export function bookHits(inp: BookInput, bs: BookState, cand: BookCandidate | null): { hits: RuleHit[]; matched: StrategyRule[] } {
  if (!bookSwitch.enabled) return { hits: [], matched: [] };
  const fc: FeatureContext = { ...bs.features, ...(cand ? candidateFeatures(inp, bs, cand) : { 'action.legal_validated': true }) };
  // 余牌不超过 10 张是“提前开启残局风险检查”，中局的阻击、堵传牌规则仍然适用
  const matched = bs.stage === 'endgame'
    ? [...new Map([...matchRules(library, fc, 'middle').matched, ...matchRules(library, fc, 'endgame').matched].map((r) => [r.id, r])).values()]
    : matchRules(library, fc, bs.stage).matched;
  const hits: RuleHit[] = [];
  for (const r of matched) {
    if (disabledRules.has(r.id)) continue;
    const res = WEIGHTS[r.id]?.({ inp, bs, cand, fc });
    if (!res) continue;
    hits.push({ id: r.id, effect: res.w < 0 ? 'support' : 'oppose', weight: res.w, note: res.note, en: `${r.title}：${res.w < 0 ? r.guidance.prefer : r.guidance.avoid}` });
  }
  return { hits, matched: matched.filter((r) => r.kind === 'soft_preference' || r.kind === 'plan_review') };
}

/** 交给 Jev 的规则说明：本局面适用的教材规则（宜 / 忌 / 例外） */
export function bookGuidance(ids: Iterable<string>): string[] {
  return [...new Set(ids)].filter((id) => BOOK_RULES[id]).map((id) => {
    const r = BOOK_RULES[id];
    return `${id} ${r.title}｜宜：${r.guidance.prefer}｜忌：${r.guidance.avoid}${r.exceptions.length ? `｜例外：${r.exceptions.join('；')}` : ''}`;
  });
}
