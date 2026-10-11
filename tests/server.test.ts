import { it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';

let proc: ChildProcess;
let port = 0;
let output = '';

/** 找一个空闲端口 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

/** 发原始路径的 GET（不经过 URL 规整，畸形编码原样发出） */
function get(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('超时')));
    req.end();
  });
}

beforeAll(async () => {
  port = await freePort();
  // 用真实的服务端进程：崩溃问题只有进程级别才能测出来
  proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), JEV_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (d) => (output += d));
  proc.stderr!.on('data', (d) => (output += d));
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { if ((await get('/healthz')) === 200) break; } catch { /* 还没启动 */ }
    if (proc.exitCode !== null || Date.now() > deadline) throw new Error(`服务端没有启动：${output}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}, 20_000);

afterAll(() => { proc?.kill(); });

it('畸形的百分号编码返回 400，服务端不崩溃', async () => {
  for (const path of ['/%E0%A4%A', '/%', '/assets/%zz.js']) {
    expect(await get(path)).toBe(400);
  }
  expect(await get('/healthz')).toBe(200);
  expect(proc.exitCode).toBeNull();
});

it('正常路径不受影响', async () => {
  expect(await get('/healthz')).toBe(200);
  expect(await get('/version')).toBe(200);
  // 编码正确的中文路径照常解码（不存在的文件回退到首页或 404，但不是 400）
  expect(await get('/%E4%B8%AD.png')).not.toBe(400);
});
