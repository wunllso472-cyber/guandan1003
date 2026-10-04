import type { FeatureContext, FeatureName } from './features.js';
import type { Stage } from './protocol.js';

export type Truth = true | false | 'unknown';
type Scalar = string | number | boolean;
export type Condition =
  | { feature: FeatureName; op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'; value: Scalar | readonly Scalar[] }
  | { all: readonly Condition[] }
  | { any: readonly Condition[] }
  | { not: Condition };

export interface StrategyRule {
  id: string;
  title: string;
  scope: 'global' | 'inference' | 'team' | 'grouping' | 'opening' | 'middle' | 'endgame' | 'tribute';
  basis: 'textbook_derived' | 'textbook_heuristic' | 'design_recommendation' | 'implementation_addition';
  kind: 'input_gate' | 'candidate_gate' | 'belief_gate' | 'belief_update' | 'plan_review' | 'soft_preference' | 'state_update';
  priority: number;
  condition: Condition;
  guidance: { prefer: string; avoid: string };
  exceptions: readonly string[];
  source: { printed_pages: readonly number[]; pdf_pages: readonly number[] };
}

export interface RuleLibrary {
  library_version: string;
  rules: StrategyRule[];
  feature_registry: Record<FeatureName, { type: 'boolean' | 'string' | 'number'; description: string; missing_value: string }>;
  [key: string]: unknown;
}

/** Three-valued logic: missing/null features cannot satisfy either positive or negative predicates. */
export function evaluateCondition(condition: Condition, context: FeatureContext): Truth {
  if ('all' in condition) {
    const values = condition.all.map(child => evaluateCondition(child, context));
    return values.includes(false) ? false : values.includes('unknown') ? 'unknown' : true;
  }
  if ('any' in condition) {
    const values = condition.any.map(child => evaluateCondition(child, context));
    return values.includes(true) ? true : values.includes('unknown') ? 'unknown' : false;
  }
  if ('not' in condition) {
    const value = evaluateCondition(condition.not, context);
    return value === 'unknown' ? value : !value;
  }
  const actual = Object.hasOwn(context, condition.feature) ? context[condition.feature] : undefined;
  if (actual == null || (typeof actual === 'number' && !Number.isFinite(actual))) return 'unknown';
  const expected = condition.value;
  if (condition.op === 'in') {
    if (!Array.isArray(expected) || expected.some(value => typeof value !== typeof actual)) return 'unknown';
    return expected.includes(actual);
  }
  if (Array.isArray(expected) || typeof actual !== typeof expected) return 'unknown';
  if (condition.op === 'eq') return actual === expected;
  if (condition.op === 'ne') return actual !== expected;
  if (typeof actual !== 'number' || typeof expected !== 'number' || !Number.isFinite(expected)) return 'unknown';
  switch (condition.op) {
    case 'gt': return actual > expected;
    case 'gte': return actual >= expected;
    case 'lt': return actual < expected;
    case 'lte': return actual <= expected;
    default: return 'unknown';
  }
}

/** Returns evidence for review; priority is check order, never a numerical action score. */
export function matchRules(library: RuleLibrary, context: FeatureContext, stage?: Stage) {
  const shared = new Set(['global', 'inference', 'team', 'grouping']);
  const evaluations = library.rules
    .filter(rule => stage === undefined || stage === 'undetermined' ? true : shared.has(rule.scope) || rule.scope === stage)
    .map(rule => ({ rule, result: evaluateCondition(rule.condition, context) }))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.rule.id.localeCompare(b.rule.id));
  return {
    matched: evaluations.filter(item => item.result === true).map(item => item.rule),
    unknown: evaluations.filter(item => item.result === 'unknown').map(item => item.rule),
    unmatched: evaluations.filter(item => item.result === false).map(item => item.rule),
  };
}
