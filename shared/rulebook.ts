// 教材策略规则库（shared/guandan-ai，56 条，出自《江苏省掼蛋项目一线社会体育指导员再培训教材》）的接入层。
// 从自己的手牌、记牌器（各家已出的牌、不出、余牌数）和当前桌面计算规则库的特征，
// 按实际局面判断开局 / 中局 / 残局，用规则库的匹配器找出对每个候选出法适用的规则。
// 规则库的 priority 只是检查顺序，不是分数；这里为可落到候选出法上的规则给出方向和分量，
// 与 shared/strategy.ts 已有规则重复的条目（如 T04≈DONT_OVERTAKE、M06≈BOMB_PURPOSE）只作依据、不重复计分。
import { cardValue } from './cards';
import { bombLevel, isBomb, type Combo, type ComboType } from './combo';
import { ruleLibrary } from './guandan-ai/data';
import { matchRules, type RuleLibrary, type StrategyRule } from './guandan-ai/rules';
import type { FeatureContext } from './guandan-ai/features';
import type { Stage } from './guandan-ai/protocol';
import type { CardTracker } from './tracker';
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

export interface BookState {
  stage: Stage;
  features: FeatureContext;
  /** 对手在本方领出的这些牌型上反复顺牌 */
  shedTypes: Set<ComboType>;
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
  let points = 0;
  for (const c of baseCombos) {
    if (isBomb(c)) points += 4;
    else if (controlOf(c) !== 'beatable') points += 1;
    else if (low(c)) points -= 1;
  }
  const strength = points >= 12 ? 'strong' : points >= 6 ? 'medium' : 'weak';
  let role: string = strength === 'strong' ? 'attack' : strength === 'weak' ? 'support' : 'undecided';
  if (!active(partner)) role = 'attack';
  else if (counts[partner] + 5 <= hand.length && counts[partner] <= 12) role = 'support';

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
    'state.opponent_sprint_threat': fromOpp && counts[targetSeat!] <= 8,
    'state.opponent_near_listen': minOpp !== null && minOpp <= 5,
    'state.verified_opponent_immediate_win': minOpp !== null && minOpp <= 2,
    'state.threat_seat_remaining': minOpp,
    'state.partner_cannot_bridge': !active(partner),
    'state.partner_has_attack_opportunity': active(partner) && counts[partner] + 5 <= hand.length,
    // 对手出小牌，而他的搭档快出完：可能在送牌
    'state.opponent_feed_threat': fromOpp && target!.value <= 10 && !isBomb(target!) && active((targetSeat! + 2) % 4) && counts[(targetSeat! + 2) % 4] <= 4,
    'state.opponent_repeatedly_sheds_on_route': shedTypes.size > 0,
    'state.self_has_strong_bomb': baseCombos.some((c) => isBomb(c) && bombLevel(c) >= 3),
    'state.single_route_weak': singlesLow >= 3,
  };
  return { stage, features, shedTypes };
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
    'plan.has_verified_clear_chain': restHands.length > 0 && weakRest.length <= 1,
    'plan.can_keep_low_tail': weakRest.length === 1 && restHands.length >= 2,
    'plan.low_route_unrecoverable': unrecoverable,
    'plan.shares_vulnerable_listen_route': vulnerable,
    // 级牌单张：用于“同类最大”的判断说明
    'belief.claims_top_route': c.type === 'single' && cardValue(c.cards[0], level) === 15 ? true : undefined,
  };
}

type Weigh = (x: { inp: BookInput; bs: BookState; cand: BookCandidate | null; fc: FeatureContext }) => { w: number; note: string } | null;

/**
 * 能落到具体出法上的规则：返回分量（负数更推荐）和给玩家看的说明。
 * 分量都不大（±1 以内），只调整候选先后，不推翻一手出完、送对家等强规则。
 */
const WEIGHTS: Record<string, Weigh> = {
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
