import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Action, Decision, GameState, Status } from './protocol.js';
import { inputSchema, outputSchema } from './schemas.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const checkInput = ajv.compile<GameState>(inputSchema);
const checkOutput = ajv.compile<Decision>(outputSchema);
export type ValidationResult<T> = { valid: true; value: T } | { valid: false; errors: string[] };
const formatErrors = (check: typeof checkInput | typeof checkOutput) =>
  (check.errors ?? []).map(error => `${error.instancePath || '/'}: ${error.message ?? 'invalid'}`);

/** Structural and basic cross-field checks. This does not implement card legality or a full history replay. */
export function validateState(value: unknown): ValidationResult<GameState> {
  if (!checkInput(value)) return { valid: false, errors: formatErrors(checkInput) };
  const errors: string[] = [];
  const ids = value.seats.map(seat => seat.player_id);
  if (new Set(ids).size !== 4) errors.push('seats: 座次重复');
  const selfIndex = value.turn_order.indexOf(value.self_id);
  if (value.turn_order[(selfIndex + 2) % 4] !== value.partner_id) errors.push('partner_id: 搭档必须为对家');
  const own = value.seats.find(seat => seat.player_id === value.self_id);
  if (own?.remaining_cards != null && own.remaining_cards !== value.self_hand.length) errors.push('self_hand: 与自家余牌数不一致');
  const finished = value.seats.filter(seat => seat.finished_rank !== null);
  if (new Set(finished.map(seat => seat.finished_rank)).size !== finished.length) errors.push('finished_rank: 名次重复');
  for (const seat of finished) if (seat.remaining_cards !== 0) errors.push(`${seat.player_id}: 出完者余牌必须为 0`);
  const played = new Set<string>();
  const events = new Set<string>();
  const counts = new Map<string, number>();
  for (const event of value.history) {
    if (events.has(event.event_id)) errors.push(`history: 重复事件 ${event.event_id}`);
    events.add(event.event_id);
    if (event.action_type === 'pass' && (event.cards.length !== 0 || event.declared !== null)) errors.push(`${event.event_id}: PASS 不能带牌或牌型声明`);
    if (event.action_type === 'play' && (event.cards.length === 0 || event.declared === null)) errors.push(`${event.event_id}: 出牌必须带实体牌和声明`);
    for (const card of event.cards) {
      if (played.has(card) || value.self_hand.includes(card)) errors.push(`history: 实体牌重复或与手牌冲突 ${card}`);
      played.add(card);
    }
    const previous = counts.get(event.player_id);
    if (previous !== undefined && event.remaining_after !== null && previous - event.cards.length !== event.remaining_after) errors.push(`${event.event_id}: 余牌数与扣牌不一致`);
    if (event.remaining_after !== null) counts.set(event.player_id, event.remaining_after);
    else counts.delete(event.player_id);
  }
  for (const seat of value.seats) {
    const last = counts.get(seat.player_id);
    if (last !== undefined && seat.remaining_cards !== null && last !== seat.remaining_cards) errors.push(`${seat.player_id}: 当前余牌数与最后记录不一致`);
  }
  const trick = value.current_trick;
  if ((trick.winning_action === null) !== (trick.winning_player === null)) errors.push('current_trick: 最大出牌和出牌者必须一起提供');
  if (value.legal_actions !== null) {
    const candidateIds = new Set<string>();
    for (const action of value.legal_actions) {
      if (candidateIds.has(action.action_id)) errors.push(`legal_actions: 重复 action_id ${action.action_id}`);
      candidateIds.add(action.action_id);
      if (action.cards.some(card => !value.self_hand.includes(card))) errors.push(`${action.action_id}: 候选牌不在自家手中`);
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true, value };
}

export function validateDecision(value: unknown): ValidationResult<Decision> {
  return checkOutput(value) ? { valid: true, value } : { valid: false, errors: formatErrors(checkOutput) };
}

/** Gate before requesting/accepting an executable action. verified/legal_validated are trusted adapter assertions. */
export function getExecutionGate(state: GameState): { status: Status; issues: string[] } {
  const validation = validateState(state);
  if (!validation.valid) return { status: 'needs_input', issues: validation.errors };
  const issues: string[] = [];
  if (!state.rules.verified || state.rules.profile_id === null || state.rules.level_rank === null) issues.push('必须提供已确认的规则配置与级牌');
  const ruleFields = ['rank_order', 'allowed_hand_types', 'wildcard_definition', 'wildcard_can_represent_joker', 'bomb_comparison', 'ace_in_sequences', 'tribute_return', 'initiative_after_finished_player', 'team_payoff'];
  for (const field of ruleFields) if (state.rules.details[field] == null) issues.push(`rules.details.${field}: 未确认`);
  if (state.current_actor !== state.self_id) issues.push('当前行动者必须为自己');
  if (state.seats.some(seat => seat.remaining_cards === null)) issues.push('必须提供各家余牌数');
  if (state.self_hand.length === 0) issues.push('自己已经无牌可出');
  const tribute = state.phase_hint === 'tribute';
  if (!tribute && (state.current_trick.trick_id === null || state.current_trick.lead_player === null || state.current_trick.trick_closed === null)) issues.push('必须提供当前轮次、领出者和是否已结束');
  if (issues.length) return { status: 'needs_input', issues };
  const verified = state.legal_actions?.filter(action => action.legal_validated) ?? [];
  if (verified.length === 0) return { status: 'needs_legal_validation', issues: ['尚无规则引擎已验证的候选动作'] };
  if (verified.some(action => tribute ? !['tribute', 'return_tribute'].includes(action.action_type) : !['play', 'pass'].includes(action.action_type))) return { status: 'needs_input', issues: ['候选动作与贡还/普通出牌阶段不一致'] };
  return { status: 'ready', issues: [] };
}

function sameAction(a: Action, b: Action): boolean {
  // Compare only the execution contract, not optional explanatory features.
  return a.action_id === b.action_id && a.action_type === b.action_type &&
    a.legal_validated === b.legal_validated &&
    JSON.stringify(a.cards) === JSON.stringify(b.cards) && deepEqual(a.declared, b.declared);
}
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}

/** Reject an AI-created or altered candidate even if the AI claims legal_validated=true. */
export function validateDecisionForState(value: unknown, state: GameState): ValidationResult<Decision> {
  const result = validateDecision(value);
  if (!result.valid || result.value.status !== 'ready') return result;
  const gate = getExecutionGate(state);
  if (gate.status !== 'ready') return { valid: false, errors: gate.issues };
  const recommendation = result.value.recommendation;
  if (!recommendation || !state.legal_actions?.some(action => action.legal_validated && sameAction(action, recommendation))) return { valid: false, errors: ['推荐必须照录输入中已验证的候选，不能修改牌或声明'] };
  return result;
}
