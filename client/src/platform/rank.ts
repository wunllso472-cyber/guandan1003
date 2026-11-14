// 小红书小工具排行榜（平台 JS API，内测，客户端 9.51+）：只在构建模式 minitool 下使用。
// 计分：单机每局赢了，按本局升级数得分（双上 3、一三 2、一四 1）；打过 A 赢下整盘再加 5。
// 这一局里开过托管就不计分。榜位 1 = 累计总分（看总榜），榜位 2 = 本周得分（看周榜，北京时间周一 0 点重置）。
// 平台规则：昵称只用接口返回的、不保存；未授权（1005）隐藏入口；2002 榜单未就绪要有限次退避；榜单结果缓存 45 秒。
import { kv } from './kv';
import type { ClientEvent, GameClient } from '../game/types';

type RankItem = { rank: number; score: number; nickname: string | null };
type MyRank = { status: 'EXACT' | 'OVER_LIMIT' | 'NO_SCORE' | 'NOT_PARTICIPATING'; rank: number | null; score: number | null };
type Period = 'all' | 'month' | 'week' | 'day';
type RankApi = {
  submitScore(o: { board: number; score: number }): Promise<{ score: number }>;
  getRankList(o: { board: number; period: Period }): Promise<{ data: RankItem[] }>;
  getMyRank(o: { board: number; period: Period }): Promise<MyRank>;
};
type LaunchOptions = { miniToolEnv?: { buildVersion?: string | number } };
type Xhs = { launchOptions?: LaunchOptions; miniTool?: Partial<RankApi> & { getLaunchOptions?: () => Promise<LaunchOptions> } };

/** 客户端 9.51.0 起支持排行榜 */
const RANK_MIN_CLIENT_VERSION = 9510;
const BOARD_TOTAL = 1;
const BOARD_WEEK = 2;
const KEY = 'gd_rank';
/** 打过 A 赢下整盘的额外得分 */
const GAME_WIN_BONUS = 5;
const CACHE_MS = 45000;

const errCode = (e: unknown) => (e && typeof e === 'object' && typeof (e as { errCode?: unknown }).errCode === 'number' ? (e as { errCode: number }).errCode : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 北京时间的周 ----------
/** 本周一（北京时间）的日期序号，作为周榜的期号 */
function beijingWeekKey(now = Date.now()): number {
  const day = Math.floor((now + 8 * 3600 * 1000) / 86400000); // 1970-01-01 是周四
  return day - ((day + 3) % 7);
}

// ---------- 本机分数 ----------
interface Local { total: number; weekKey: number; week: number }
function loadLocal(): Local {
  const def: Local = { total: 0, weekKey: beijingWeekKey(), week: 0 };
  try {
    const s = { ...def, ...JSON.parse(kv.get(KEY) ?? '{}') } as Local;
    if (s.weekKey !== def.weekKey) { s.weekKey = def.weekKey; s.week = 0; }
    return s;
  } catch { return def; }
}
function saveLocal(s: Local) { kv.set(KEY, JSON.stringify(s)); }

// ---------- 平台能力 ----------
async function getApi(): Promise<RankApi | null> {
  const x = (window as unknown as { xhs?: Xhs }).xhs;
  const mt = x && x.miniTool;
  if (!mt || typeof mt.submitScore !== 'function' || typeof mt.getRankList !== 'function' || typeof mt.getMyRank !== 'function') return null;
  const read = (o: LaunchOptions | undefined) => Number(o && o.miniToolEnv && o.miniToolEnv.buildVersion) || 0;
  let ver = read(x && x.launchOptions);
  if (!ver && typeof mt.getLaunchOptions === 'function') { try { ver = read(await mt.getLaunchOptions()); } catch { ver = 0; } }
  if (Math.floor(ver / 1000) < RANK_MIN_CLIENT_VERSION) return null;
  return mt as RankApi;
}

/** 2002（榜单未就绪）按 500ms / 1s / 2s / 4s 退避重试，其余错误直接抛出 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (const wait of [500, 1000, 2000, 4000]) {
    try { return await fn(); } catch (e) { if (errCode(e) !== 2002) throw e; await sleep(wait); }
  }
  return fn();
}

// ---------- 对外 ----------
export interface RankHooks { onClientEvent(e: ClientEvent, client: GameClient): void }

/** 在大厅卡片里加“排行榜”入口；平台不支持或未授权时什么都不加，返回的钩子也不做事 */
export function initRank(opts: { lobbyCard: HTMLElement; before: Element | null; toast: (t: string) => void }): RankHooks {
  let api: RankApi | null = null;
  let disabled = false;
  const local = loadLocal();
  let autoThisRound = false;
  const cache = new Map<string, { at: number; list: RankItem[]; mine: MyRank }>();

  const btn = document.createElement('button');
  btn.className = 'btn rank-entry hidden';
  btn.type = 'button';
  btn.textContent = '排行榜';
  opts.lobbyCard.insertBefore(btn, opts.before);

  /** 未授权等不可恢复的错误：隐藏入口，不再调用 */
  function disable() {
    disabled = true;
    btn.classList.add('hidden');
    closeModal();
  }
  function fatal(e: unknown) {
    const c = errCode(e);
    return c === 1005 || c === 10003;
  }

  void getApi().then(async (a) => {
    if (!a) return;
    try {
      // 探测授权；本机分数丢失（换设备、清缓存）时用平台记录的最好成绩补回
      const mine = await withRetry(() => a.getMyRank({ board: BOARD_TOTAL, period: 'all' }));
      if (mine.status === 'EXACT' && typeof mine.score === 'number' && mine.score > local.total) { local.total = mine.score; saveLocal(local); }
    } catch (e) {
      if (fatal(e)) { disable(); return; }
    }
    api = a;
    btn.classList.remove('hidden');
  });

  async function submit() {
    if (!api || disabled) return;
    try {
      // 2004（写入结果未知）不重发：下一次得分会提交更高的累计分
      await api.submitScore({ board: BOARD_TOTAL, score: local.total });
      await api.submitScore({ board: BOARD_WEEK, score: local.week });
      cache.clear();
    } catch (e) {
      if (fatal(e)) disable();
    }
  }

  // ---------- 榜单弹窗 ----------
  let modal: HTMLElement | null = null;
  function closeModal() { if (modal) { modal.remove(); modal = null; } }

  async function load(tab: 'total' | 'week'): Promise<{ list: RankItem[]; mine: MyRank }> {
    const hit = cache.get(tab);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;
    const q = tab === 'total' ? { board: BOARD_TOTAL, period: 'all' as Period } : { board: BOARD_WEEK, period: 'week' as Period };
    const [res, mine] = await Promise.all([withRetry(() => api!.getRankList(q)), withRetry(() => api!.getMyRank(q))]);
    const v = { at: Date.now(), list: (res && res.data) || [], mine };
    cache.set(tab, v);
    return v;
  }

  function el(tag: string, cls: string, text?: string) {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function openModal() {
    if (!api || disabled) return;
    closeModal();
    const m = el('div', 'rank-modal');
    const card = el('div', 'rank-card');
    const head = el('div', 'rank-head');
    head.appendChild(el('b', '', '排行榜'));
    const close = el('button', 'rank-close', '×');
    close.addEventListener('click', closeModal);
    head.appendChild(close);
    const tabs = el('div', 'rank-tabs');
    const tTotal = el('button', 'on', '总榜（累计分）');
    const tWeek = el('button', '', '本周');
    tabs.appendChild(tTotal); tabs.appendChild(tWeek);
    const mineEl = el('div', 'rank-mine');
    const body = el('div', 'rank-body');
    const rule = el('div', 'rank-rule', `每局赢了按升级数得分（双上 3、一三 2、一四 1），打过 A 赢下整盘再加 ${GAME_WIN_BONUS} 分；开过托管的局不计分。`);
    card.appendChild(head); card.appendChild(tabs); card.appendChild(mineEl); card.appendChild(body); card.appendChild(rule);
    m.appendChild(card);
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    modal = m;

    let seq = 0;
    async function show(tab: 'total' | 'week') {
      tTotal.className = tab === 'total' ? 'on' : '';
      tWeek.className = tab === 'week' ? 'on' : '';
      const my = tab === 'total' ? local.total : local.week;
      mineEl.textContent = `我的${tab === 'total' ? '累计' : '本周'}得分：${my}`;
      body.textContent = '';
      body.appendChild(el('div', 'rank-empty', '加载中…'));
      const id = ++seq;
      try {
        const { list, mine } = await load(tab);
        if (id !== seq || modal !== m) return;
        const rankText = mine.status === 'EXACT' && mine.rank !== null ? `第 ${mine.rank} 名`
          : mine.status === 'OVER_LIMIT' ? '500+' : '未上榜';
        mineEl.textContent = `我的${tab === 'total' ? '累计' : '本周'}得分：${my} · 排名：${rankText}`;
        body.textContent = '';
        if (!list.length) { body.appendChild(el('div', 'rank-empty', '还没有人上榜，赢一局就能上榜')); return; }
        for (const it of list) {
          const row = el('div', 'rank-row' + (it.rank <= 3 ? ' top' : ''));
          row.appendChild(el('span', 'rank-no', String(it.rank)));
          row.appendChild(el('span', 'rank-name', it.nickname || '小红薯用户'));
          row.appendChild(el('span', 'rank-score', String(it.score)));
          body.appendChild(row);
        }
      } catch (e) {
        if (fatal(e)) { disable(); return; }
        if (id !== seq || modal !== m) return;
        body.textContent = '';
        body.appendChild(el('div', 'rank-empty', errCode(e) === 2002 ? '榜单还在准备中，请稍后再看' : '榜单加载失败，请稍后再试'));
      }
    }
    tTotal.addEventListener('click', () => void show('total'));
    tWeek.addEventListener('click', () => void show('week'));
    void show('total');
  }
  btn.addEventListener('click', openModal);

  return {
    onClientEvent(e, client) {
      if (disabled) return;
      if (e.type === 'roundStart') autoThisRound = client.isAuto(client.mySeat);
      else if (e.type === 'auto' && e.seat === client.mySeat && e.on) autoThisRound = true;
      else if (e.type === 'roundEnd') {
        const r = e.result;
        if (r.winTeam !== client.mySeat % 2) return;
        if (autoThisRound) { if (api) opts.toast('本局开过托管，不计入排行榜'); return; }
        const pts = r.up + (r.gameOver ? GAME_WIN_BONUS : 0);
        if (pts <= 0) return;
        const wk = beijingWeekKey();
        if (local.weekKey !== wk) { local.weekKey = wk; local.week = 0; }
        local.total += pts;
        local.week += pts;
        saveLocal(local);
        if (api) opts.toast(`排行榜 +${pts} 分，累计 ${local.total} 分`);
        void submit();
      }
    },
  };
}
