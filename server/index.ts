// 掼蛋服务端：静态文件 + WebSocket（/ws）。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room } from './room';
import { getAdvice, warmUp } from './jev';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const here = dirname(fileURLToPath(import.meta.url));
// 打包后与 client 目录同级（dist/server.mjs + dist/client）；开发时由 Vite 提供页面
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? join(here, 'client'));
const ROOM_IDLE_MS = 10 * 60_000;
const STARTED_AT = new Date().toISOString();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') { res.end('ok'); return; }
  if (url.pathname === '/version') {
    // RENDER_GIT_COMMIT 由 Render 在部署时自动提供，用于核对线上运行的代码版本
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ commit: process.env.RENDER_GIT_COMMIT ?? 'local', startedAt: STARTED_AT }));
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(STATIC_DIR, p);
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(STATIC_DIR, 'index.html'); // 单页应用回退
    p = 'index.html';
  }
  try {
    const body = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': p.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    // 单独部署服务端（网页在 Netlify）时没有静态文件
    if (url.pathname === '/') res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('掼蛋联机服务运行中');
    else res.writeHead(404).end('not found');
  }
});

const rooms = new Map<string, Room>();
/** token → 所在房间 */
const tokenRoom = new Map<string, Room>();

function newCode(): string {
  for (;;) {
    const c = String(Math.floor(100000 + Math.random() * 900000));
    if (!rooms.has(c)) return c;
  }
}

function createRoom(): Room {
  const room = new Room(newCode(), (r) => rooms.delete(r.code), tokenRoom);
  rooms.set(room.code, room);
  return room;
}

// 出牌建议的局面信息较大，放宽到 64KB
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });

interface Conn { ws: WebSocket; token: string; name: string; voice: 'male' | 'female'; alive: boolean }

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  const conn: Conn = { ws, token: '', name: '', voice: 'male', alive: true };
  ws.on('pong', () => (conn.alive = true));
  (ws as any).conn = conn;

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    try {
      handle(conn, msg);
    } catch (err) {
      console.error('处理消息出错', msg, err);
      send(ws, { t: 'error', msg: '服务器错误' });
    }
  });

  ws.on('close', () => {
    const room = tokenRoom.get(conn.token);
    room?.disconnect(conn.token, ws);
  });
});

function handle(c: Conn, msg: ClientMsg) {
  if (msg.t === 'ping') { send(c.ws, { t: 'pong' }); return; }
  if (msg.t === 'hello') {
    c.token = String(msg.token ?? '').slice(0, 64);
    c.name = String(msg.name ?? '').trim().slice(0, 8) || '玩家';
    c.voice = msg.voice === 'female' ? 'female' : 'male';
    // 断线重连：自动回到原房间
    const room = tokenRoom.get(c.token);
    const back = room && room.seatOf(c.token) >= 0 ? room : null;
    send(c.ws, { t: 'welcome', room: back?.code ?? null });
    back?.join(c.token, c.name, c.ws, c.voice);
    return;
  }
  if (!c.token) return;
  const room = tokenRoom.get(c.token);
  const reply = (err: string | null) => { if (err) send(c.ws, { t: 'error', msg: err }); };

  switch (msg.t) {
    case 'create': {
      room?.leave(c.token);
      reply(createRoom().join(c.token, c.name, c.ws, c.voice));
      return;
    }
    case 'join': {
      const target = rooms.get(String(msg.code));
      if (!target) { reply('房间不存在或已解散'); return; }
      if (room && room !== target) room.leave(c.token);
      reply(target.join(c.token, c.name, c.ws, c.voice));
      return;
    }
  }
  if (!room) { reply('你不在房间中'); return; }
  if (msg.t === 'advise') {
    // 只有正在对局中的玩家可以请求建议
    if (!room.playing || room.seatOf(c.token) < 0) { send(c.ws, { t: 'advice', id: msg.id, ranking: null, error: '不在对局中' }); return; }
    const id = Number(msg.id);
    void getAdvice(c.token, msg.ctx).then(({ result, error }) => {
      send(c.ws, { t: 'advice', id, ranking: result?.ranking ?? null, confidence: result?.confidence, error });
    });
    return;
  }
  switch (msg.t) {
    case 'leave': room.leave(c.token); return;
    case 'sit': reply(room.sit(c.token, Number(msg.seat))); return;
    case 'ready': room.setReady(c.token, !!msg.on); return;
    case 'addAI': reply(room.addAI(c.token, Number(msg.seat))); return;
    case 'removeAI': reply(room.removeAI(c.token, Number(msg.seat))); return;
    case 'start': reply(room.start(c.token)); return;
    case 'play': case 'pass': case 'return': case 'auto': case 'next': case 'chat':
      reply(room.action(c.token, msg as any));
      return;
  }
}

// 心跳：清理死连接
setInterval(() => {
  for (const ws of wss.clients) {
    const conn = (ws as any).conn as Conn;
    if (!conn.alive) { ws.terminate(); continue; }
    conn.alive = false;
    ws.ping();
  }
}, 20_000);

// 清理长时间无人在线的房间
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const online = room.seats.some((s) => s?.kind === 'human' && !s.left && s.ws);
    if (!online && now - room.lastActive > ROOM_IDLE_MS) room.dispose();
  }
}, 60_000);

// 有对局进行时保持到 Jev 的连接
setInterval(() => {
  if ([...rooms.values()].some((r) => r.playing)) warmUp();
}, 60_000);

http.listen(PORT, () => console.log(`掼蛋服务已启动：http://localhost:${PORT}`));
