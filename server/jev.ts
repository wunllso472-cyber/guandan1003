// Jev 出牌建议：服务端代为调用（密钥只在服务端），带限流、缓存、超时和结果校验。
//
// 配置（环境变量）：
//   JEV_API_KEY   Jev 的 API 密钥（本地开发写在 .env.local，Render 上在 Environment 里配置）
//
// 调用格式待 Jev 接口文档确认后在 callJev() 中实现；在此之前 isConfigured() 返回 false，
// 客户端会自动使用本地提示。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const TIMEOUT_MS = 1800;
const RATE_MS = 2000;
const CACHE_MS = 60_000;

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

/** 已拿到接口文档并实现 callJev 之后改为 true */
const IMPLEMENTED = false;

export function isConfigured(): boolean {
  return IMPLEMENTED && !!apiKey;
}

/**
 * 调用 Jev：把局面和候选出法交给它，返回按推荐程度排序的候选 id。
 * TODO(等 Jev 接口文档)：按文档实现请求与响应解析。
 */
async function callJev(_ctx: unknown, _options: JevOption[], _signal: AbortSignal): Promise<JevResult | null> {
  void apiKey;
  return null;
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
