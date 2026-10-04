// Jev 出牌建议：服务端代为调用（密钥只在服务端），带限流、缓存、超时和结果校验。
//
// 配置（环境变量）：
//   JEV_API_KEY   Jev 的 API 密钥（本地开发写在 .env.local，Render 上在 Environment 里配置）
//
// 接口：POST https://api.typesafe.ai/v1/systemone（TypeSafe 官方，模型 jev-latest）。
// 用一道 Choice 题让 Jev 从候选出法里选最佳的一手：state 为玩家视角的局面（中文），
// 问题和选项说明用英文（官方建议：中文能用但英文更准）。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Agent, fetch } from 'undici';

const API = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const TIMEOUT_MS = 1800;
const RATE_MS = 2000;
const CACHE_MS = 60_000;

// 长连接池：默认空闲连接只保留约 4 秒，每次提示都要重新握手（约多 0.7 秒），这里保留 2 分钟
const dispatcher = new Agent({ keepAliveTimeout: 120_000, keepAliveMaxTimeout: 600_000 });

/** 预热：提前建立到 Jev 的连接（空请求，不消耗 token），避免第一次提示多等握手时间 */
export function warmUp() {
  if (!apiKey) return;
  fetch(API, { method: 'HEAD', dispatcher, signal: AbortSignal.timeout(5000) }).then((r) => r.body?.cancel()).catch(() => { /* 预热失败不影响使用 */ });
}

export interface JevOption { id: string }
export interface JevResult { ranking: string[]; confidence?: number }

function loadKey(): string | undefined {
  if (process.env.JEV_API_KEY) return process.env.JEV_API_KEY.trim();
  try {
    return readFileSync('.env.local', 'utf8').match(/^JEV_API_KEY=(.+)$/m)?.[1].trim();
  } catch {
    return undefined;
  }
}

const apiKey = loadKey();
const lastCall = new Map<string, number>();
const cache = new Map<string, { at: number; result: JevResult }>();

export function isConfigured(): boolean {
  return !!apiKey;
}

/** 累计用量（官方没有余额查询接口，按响应里的 usage 自己记） */
export const usage = { calls: 0, inputTokens: 0 };

const INSTRUCTIONS = {
  game: 'Guandan (掼蛋): 4 players, 2 decks (108 cards). The player "我" (me) and "对家" (partner, sits opposite) are a team; "上家" and "下家" are the opponents. A team wins the round by having both players go out first and second; going out early matters most.',
  rules: 'Card order and the wildcard are given in `level`, `rankOrder` and `wildcard`. Bombs beat any non-bomb play. Playing a combination the others cannot beat keeps the lead.',
  rulebook: 'The team goal for this situation is in `goal`. `rulebook` lists principles from an expert Guandan study that apply here. Each option carries `rule_hits` computed from the actual cards: "supports" means the principle favours this move, "opposes" means it argues against it. Weigh these expert judgements heavily, especially STOP_FINISH, PASS_GATE and LAST_HAND.',
  textbook: '`stage` is opening / middle / endgame (中局/残局), judged from the actual table. `textbookRules` lists the rules from the Jiangsu Guandan coaching textbook that apply to these options (宜 = prefer, 忌 = avoid, 例外 = exceptions). They are conditional heuristics, not hard rules: check the exceptions against the situation. The goal is the team result (our side goes out first, and we avoid both finishing last). Unrevealed hands are unknown, and a pass does not prove a player lacks the cards.',
  context: 'My hand is `me.hand`. Cards left per player are in `players`. The play to beat (if any) is `trick.lastPlay`; `trick.lead` means I am leading a new trick. `unseenCards` counts cards not yet seen (held by the other three players). `facts` are certain; `inferred` are guesses with a confidence. `history` lists recent plays.',
  strategy: [
    'If the partner has very few cards, feed them a small play of the type they likely hold so they can go out.',
    'If the partner made the current play and it is strong or cannot be beaten, usually pass instead of overtaking the partner.',
    'If an opponent has very few cards, avoid leading the combination type they could finish with, and beat their plays even with a bomb when needed.',
    'Prefer plays that reduce the number of hands left, keep bombs for critical moments, and avoid breaking bombs.',
    'A play marked as unbeatable keeps the lead; use control cards wisely.',
  ],
  question: 'Which option in the criteria is the best move for me (我) right now?',
};

const CONTROL_EN: Record<string, string> = {
  外面没人压得住: 'nobody else can beat it',
  只可能被炸弹压: 'only a bomb can beat it',
  可能被压: 'others may beat it',
};

/** 把候选出法写成 Choice 的选项说明（英文字段 + 中文牌面） */
function describe(o: Record<string, unknown>): Record<string, unknown> {
  if (o.play === '不出') return { move: 'pass (不出)', rule_hits: o.rule_hits };
  return {
    move: o.play,
    hands_left_after: o.handsLeftAfter,
    bombs_left_after: o.bombsLeftAfter,
    breaks_a_bomb: o.breaksBomb,
    uses_wildcard: o.usesWildcard,
    is_bomb: o.isBomb,
    goes_out: o.finishesHand,
    beatable: CONTROL_EN[o.control as string] ?? o.control,
    notes: o.notes,
    rule_hits: o.rule_hits,
  };
}

/** 调用 Jev：把局面和候选出法交给它，返回按概率从高到低排序的候选 id。 */
async function callJev(ctx: unknown, options: JevOption[], signal: AbortSignal): Promise<JevResult | null> {
  const { options: _drop, ...state } = ctx as Record<string, unknown>;
  void _drop;
  const criteria: Record<string, unknown> = {};
  for (const o of options) criteria[o.id] = describe(o as unknown as Record<string, unknown>);
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state,
      model: MODEL,
      questions: { best_move: { type: 'choice', instructions: INSTRUCTIONS, criteria } },
    }),
    signal,
    dispatcher,
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as {
    answers?: { best_move?: { probabilities?: Record<string, number>; confidence?: number } };
    usage?: { input_tokens?: number };
  };
  usage.calls++;
  usage.inputTokens += body.usage?.input_tokens ?? 0;
  const ans = body.answers?.best_move;
  if (!ans?.probabilities) return null;
  const ranking = Object.entries(ans.probabilities).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return { ranking, confidence: ans.confidence };
}

/** 处理一次建议请求。token 用于限流；返回 null 表示没有建议（客户端改用本地提示） */
export async function getAdvice(token: string, ctx: unknown): Promise<{ result: JevResult | null; error?: string }> {
  if (!isConfigured()) return { result: null, error: '未配置' };
  const options = (ctx as { options?: JevOption[] } | null)?.options;
  if (!Array.isArray(options) || options.length < 2 || options.length > 255) return { result: null, error: '候选数量不合法' };

  const now = Date.now();
  const key = createHash('sha1').update(JSON.stringify(ctx)).digest('hex');
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return { result: hit.result };
  if (now - (lastCall.get(token) ?? 0) < RATE_MS) return { result: null, error: '请求太频繁' };
  lastCall.set(token, now);

  try {
    const result = await callJev(ctx, options, AbortSignal.timeout(TIMEOUT_MS));
    if (!result) return { result: null, error: '没有结果' };
    // 只接受这一手真实存在的候选
    const valid = new Set(options.map((o) => o.id));
    const ranking = result.ranking.filter((id) => valid.has(id));
    if (!ranking.length) return { result: null, error: '结果不合法' };
    const clean = { ranking, confidence: result.confidence };
    cache.set(key, { at: now, result: clean });
    if (cache.size > 2000) for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k);
    return { result: clean };
  } catch (e) {
    return { result: null, error: (e as Error).name === 'TimeoutError' ? '超时' : '调用失败' };
  }
}

/** 测试与评估用：直接调用（不限流、不缓存），返回排序、置信度、概率和耗时 */
export async function adviseDirect(ctx: unknown, timeoutMs = 10_000) {
  const options = (ctx as { options: JevOption[] }).options;
  const t0 = Date.now();
  const r = await callJev(ctx, options, AbortSignal.timeout(timeoutMs));
  return { ...r, ms: Date.now() - t0 };
}
