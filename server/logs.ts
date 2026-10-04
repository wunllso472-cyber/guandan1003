// 复盘日志：客户端每局结束上传本局出牌和决策依据，供开发者（Claude）复盘策略时读取。
// 只存在内存里（Render 免费版重启或休眠会清空）；客户端本地也保存最近的局，重新打开页面时补传，按局编号去重。
// 读取需要密钥：代码里只放密钥的 SHA-256（仓库公开），密钥本身在本地 .env.local 的 GD_LOG_KEY。
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const KEY_SHA256 = process.env.GD_LOG_KEY_SHA256 ?? 'e5893df1fa686622cebd9d9b5d7867f3c12ecafb3ebcaf2923fd150e83aa7ccc';
const MAX_ROUNDS = 500;
const MAX_BODY = 512 * 1024;

const rounds = new Map<string, { at: number; rec: Record<string, unknown> }>();

function authorized(key: string | null): boolean {
  if (!key) return false;
  const a = createHash('sha256').update(key).digest();
  const b = Buffer.from(KEY_SHA256, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

function store(rec: unknown) {
  if (!rec || typeof rec !== 'object') return;
  const id = (rec as { id?: unknown }).id;
  if (typeof id !== 'string' || id.length > 64) return;
  rounds.delete(id);
  rounds.set(id, { at: Date.now(), rec: rec as Record<string, unknown> });
  while (rounds.size > MAX_ROUNDS) rounds.delete(rounds.keys().next().value!);
}

/** 处理 /logs：POST 上传（{ rounds: [...] }），GET 读取（?key=…&since=毫秒时间戳&limit=…） */
export function handleLogs(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS).end(); return; }
  if (req.method === 'POST') {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413, CORS).end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { rounds?: unknown[] };
        for (const r of (Array.isArray(body.rounds) ? body.rounds : []).slice(0, 60)) store(r);
        res.writeHead(204, CORS).end();
      } catch {
        res.writeHead(400, CORS).end();
      }
    });
    return;
  }
  if (!authorized(url.searchParams.get('key'))) { res.writeHead(403, CORS).end('forbidden'); return; }
  const since = Number(url.searchParams.get('since') ?? 0);
  const limit = Math.min(MAX_ROUNDS, Number(url.searchParams.get('limit') ?? MAX_ROUNDS));
  const list = [...rounds.values()].filter((x) => x.at >= since).slice(-limit).map((x) => x.rec);
  res.writeHead(200, { ...CORS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ count: list.length, rounds: list }));
}
