// 小红书小工具排行榜：计分、托管不计分、周榜清零、提交，以及未授权时隐藏入口（平台接口和 DOM 都用最小桩）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeEl {
  className = '';
  textContent = '';
  type = '';
  children: FakeEl[] = [];
  private handlers: Record<string, (() => void)[]> = {};
  classList = {
    add: (c: string) => { if (!this.className.split(' ').includes(c)) this.className = (this.className + ' ' + c).trim(); },
    remove: (c: string) => { this.className = this.className.split(' ').filter((x) => x !== c).join(' '); },
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  addEventListener(t: string, fn: () => void) { (this.handlers[t] ??= []).push(fn); }
  appendChild(c: FakeEl) { this.children.push(c); return c; }
  insertBefore(c: FakeEl) { this.children.push(c); return c; }
  remove() { /* 桩 */ }
}

type Sub = { board: number; score: number };
function setup(opts: { fail?: number; serverBest?: number } = {}) {
  const subs: Sub[] = [];
  const reject = () => Promise.reject({ errMsg: 'x', errCode: opts.fail });
  const miniTool = {
    submitScore: (o: Sub) => { subs.push(o); return Promise.resolve({ score: o.score }); },
    getMyRank: () => (opts.fail ? reject() : Promise.resolve(opts.serverBest
      ? { status: 'EXACT', rank: 3, score: opts.serverBest }
      : { status: 'NOT_PARTICIPATING', rank: null, score: null })),
    getRankList: () => (opts.fail ? reject() : Promise.resolve({ data: [] })),
  };
  vi.stubGlobal('window', { xhs: { launchOptions: { miniToolEnv: { buildVersion: 9530001 } }, miniTool } });
  vi.stubGlobal('document', { createElement: () => new FakeEl(), body: new FakeEl() });
  return subs;
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

// 视图层只用到 mySeat 和 isAuto
const client = (auto = false) => ({ mySeat: 0, isAuto: () => auto }) as never;
const roundStart = { type: 'roundStart' } as never;
const roundEnd = (winTeam: number, up: number, gameOver = false) =>
  ({ type: 'roundEnd', result: { order: [], winTeam, levelsBefore: [2, 2], levelsAfter: [2, 2], up, gameOver } }) as never;

async function load() {
  vi.resetModules();
  const { initRank } = await import('../client/src/platform/rank');
  const card = new FakeEl();
  const toasts: string[] = [];
  const hooks = initRank({ lobbyCard: card as never, before: null, toast: (t) => toasts.push(t) });
  await flush();
  return { hooks, entry: card.children[0], toasts };
}

describe('小工具排行榜', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T04:00:00Z')); }); // 北京时间周六
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('赢一局按升级数计分，整盘获胜加 5 分，累计分和周得分分榜提交', async () => {
    const subs = setup();
    const { hooks, entry, toasts } = await load();
    expect(entry.classList.contains('hidden')).toBe(false);
    hooks.onClientEvent(roundStart, client());
    hooks.onClientEvent(roundEnd(0, 3), client());
    await flush();
    expect(subs).toEqual([{ board: 1, score: 3 }, { board: 2, score: 3 }]);
    expect(toasts.at(-1)).toBe('排行榜 +3 分，累计 3 分');
    hooks.onClientEvent(roundStart, client());
    hooks.onClientEvent(roundEnd(0, 2, true), client());
    await flush();
    expect(subs.slice(-2)).toEqual([{ board: 1, score: 10 }, { board: 2, score: 10 }]);
  });

  it('输了不计分；开过托管的局不计分', async () => {
    const subs = setup();
    const { hooks, toasts } = await load();
    hooks.onClientEvent(roundStart, client());
    hooks.onClientEvent(roundEnd(1, 3), client());
    hooks.onClientEvent(roundStart, client());
    hooks.onClientEvent({ type: 'auto', seat: 0, on: true } as never, client(true));
    hooks.onClientEvent(roundEnd(0, 3), client(true));
    await flush();
    expect(subs).toEqual([]);
    expect(toasts).toEqual(['本局开过托管，不计入排行榜']);
  });

  it('本机没有分数时用平台记录的最好成绩补回；跨周后周得分从 0 开始', async () => {
    const subs = setup({ serverBest: 40 });
    const { hooks } = await load();
    hooks.onClientEvent(roundStart, client());
    hooks.onClientEvent(roundEnd(0, 1), client());
    await flush();
    expect(subs).toEqual([{ board: 1, score: 41 }, { board: 2, score: 1 }]);
    vi.setSystemTime(new Date('2026-11-16T01:00:00Z')); // 北京时间周一 9 点
    hooks.onClientEvent(roundStart, client());
    hooks.onClientEvent(roundEnd(0, 2), client());
    await flush();
    expect(subs.slice(-2)).toEqual([{ board: 1, score: 43 }, { board: 2, score: 2 }]);
  });

  it('未授权（1005）时隐藏入口，之后不再计分提交', async () => {
    const subs = setup({ fail: 1005 });
    const { hooks, entry } = await load();
    expect(entry.classList.contains('hidden')).toBe(true);
    hooks.onClientEvent(roundStart, client());
    hooks.onClientEvent(roundEnd(0, 3), client());
    await flush();
    expect(subs).toEqual([]);
  });
});
