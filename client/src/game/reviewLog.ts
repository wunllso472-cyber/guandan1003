// 复盘日志：记录每一局的出牌过程和每次决策的依据，打牌过程中实时上传服务端（/logs，同一局按编号覆盖），
// 暂停、离开牌桌、关页面和局末同时保存在本地，供开发者复盘策略。
// 单机能看到四家起手牌，一并记录；联机只记录自己的手牌和公开信息。
import { advise, cardLabel, comboLabel } from '@shared/advisor';
import { decisionLog, type DecisionLog } from '@shared/autoplay';
import { rankName } from '@shared/cards';
import { teamOf } from '@shared/game';
import type { CardTracker } from '@shared/tracker';
import type { ClientEvent, GameClient } from './types';
import { logsUrl } from '../net/Connection';

/** 一条出牌记录 */
export interface Entry {
  /** play 出牌 / pass 不出 / trick 一轮结束 / finish 出完 / tribute 进贡还贡 */
  t: 'play' | 'pass' | 'trick' | 'finish' | 'tribute';
  /** 座位 */
  s?: number;
  /** 牌型名称，如“对9” */
  c?: string;
  /** 具体的牌 */
  cards?: string;
  /** 出完后剩余张数 */
  left?: number;
  /** 首出 */
  lead?: boolean;
  /** 出牌前自己的手牌 */
  hand?: string[];
  /** 托管/超时代打的决策依据 */
  why?: DecisionLog;
  /** 自己出牌时，策略当时的建议（顾问排序，不含模拟） */
  sug?: DecisionLog;
  /** 自己点了“提示”时给出的建议 */
  hint?: DecisionLog;
  note?: string;
}

export interface RoundRecord {
  id: string;
  v: 1;
  at: string;
  mode: 'local' | 'online';
  me: number;
  /** 座位 0-3 的玩家：名字（关系） */
  players: string[];
  level: string;
  levels: [string, string];
  /** 起手牌（发牌后、进贡前）；联机只有自己的 */
  hands: Record<number, string[]>;
  log: Entry[];
  result?: { order: number[]; winTeam: number; up: number; note?: string; levelsAfter: [string, string] };
  /** 本局还在进行中（实时上传的中间状态） */
  live?: boolean;
  /** 最后更新时间 */
  upd?: string;
  /** 已给出但还没执行的托管决策（含局面依据，即决策面板上的最新一条） */
  pending?: DecisionLog;
}

const STORE = 'gd_review_v1';
const KEEP = 40;

/** 本机保存的复盘记录（旧的在前） */
export function loadAll(): RoundRecord[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]') as RoundRecord[]; } catch { return []; }
}

function saveRound(r: RoundRecord) {
  try {
    const all = loadAll().filter((x) => x.id !== r.id);
    all.push(r);
    localStorage.setItem(STORE, JSON.stringify(all.slice(-KEEP)));
  } catch { /* 存储满或被禁用：只上传 */ }
}

async function upload(rounds: RoundRecord[], keepalive = false) {
  const url = logsUrl();
  if (!url || !rounds.length) return;
  // 分批，单次请求不超过服务端的大小限制
  for (let i = 0; i < rounds.length; i += 6) {
    try {
      // keepalive：关页面时请求也能发出去（浏览器限制 64KB，超出会失败，本地已保存，下次打开再补传）
      await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rounds: rounds.slice(i, i + 6) }), keepalive });
    } catch { return; }
  }
}

/** 实时上传的最短间隔（毫秒）：期间的多次变化合并成一次 */
const LIVE_INTERVAL = 1500;

/** 页面打开时补传本地保存的局（服务端重启后数据会丢，按局编号去重） */
export function syncReviewLogs() {
  void upload(loadAll());
}

export class ReviewLogger {
  private rec: RoundRecord | null = null;
  private pendingWhy: DecisionLog | null = null;
  private pendingSug: DecisionLog | null = null;
  private pendingHint: DecisionLog | null = null;
  private leadNext = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onHide = () => this.flush(true);

  constructor(private client: GameClient, private tracker: CardTracker) {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onHide);
  }

  /** 离开牌桌：把进行中的局保存并上传 */
  dispose() {
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onHide);
    this.flush(true);
  }

  /** 稍后上传本局当前状态（合并短时间内的多次变化） */
  private schedule() {
    if (!this.rec || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, LIVE_INTERVAL);
  }

  /** 立即上传本局当前状态；save 时同时保存到本地 */
  private flush(save = false) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const r = this.rec;
    if (!r) return;
    r.upd = new Date().toISOString();
    if (save) saveRound(r);
    void upload([r], save);
  }

  private get level() { return this.client.game.level; }
  private cards(ids: number[]) { return ids.map((id) => cardLabel(id, this.level)).join(' '); }

  /** 在牌桌处理完事件（记牌器已更新）之后调用 */
  onEvent(e: ClientEvent) {
    const g = this.client.game;
    const me = this.client.mySeat;
    switch (e.type) {
      case 'roundStart': {
        const rel = ['我', '下家', '对家', '上家'];
        this.rec = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          v: 1,
          at: new Date().toISOString(),
          mode: this.client.canRestart ? 'local' : 'online',
          me,
          players: this.client.players.map((p, s) => `${p.name}（${rel[(s - me + 4) % 4]}${p.isAI ? '，电脑' : ''}）`),
          level: rankName(e.level),
          levels: [rankName(e.levels[0]), rankName(e.levels[1])],
          hands: Object.fromEntries(e.hands.map((h, s) => [s, h.map((id) => cardLabel(id, e.level))]).filter(([, h]) => (h as string[]).length)),
          log: [],
          live: true,
        };
        this.leadNext = true;
        this.pendingWhy = this.pendingSug = this.pendingHint = null;
        break;
      }
      case 'tribute':
        this.rec?.log.push({ t: 'tribute', note: e.list.map((t) => `${t.from}→${t.to} 进贡 ${cardLabel(t.card, this.level)}`).join('；') });
        break;
      case 'returnTribute':
        this.rec?.log.push({ t: 'tribute', note: `${e.from}→${e.to} 还贡 ${cardLabel(e.card, this.level)}` });
        break;
      case 'turn':
        if (e.lead) this.leadNext = true;
        // 轮到自己手动出牌：记下策略此刻的建议，出牌后对照
        if (e.seat === me && !this.client.isAuto(me) && g.phase === 'play') {
          try {
            const adv = advise({ seat: me, hand: g.hands[me], level: g.level, target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, counts: g.handCounts(), tracker: this.tracker });
            this.pendingSug = adv.options.length ? decisionLog(adv, 'manual', 0, 'advisor') : null;
          } catch { this.pendingSug = null; }
        }
        break;
      case 'decision':
        if (e.seat === me) {
          this.pendingWhy = e.d;
          if (this.rec) this.rec.pending = e.d;
        }
        break;
      case 'pause':
        // 暂停时多半要看日志：立即上传并保存
        if (e.on) this.flush(true);
        return;
      case 'play':
      case 'pass': {
        if (!this.rec) break;
        const entry: Entry = e.type === 'play'
          ? { t: 'play', s: e.seat, c: comboLabel(e.combo, this.level), cards: this.cards(e.combo.cards), left: e.left, ...(this.leadNext ? { lead: true } : {}) }
          : { t: 'pass', s: e.seat };
        if (e.type === 'play') this.leadNext = false;
        if (e.seat === me) {
          // 出牌后手牌已更新，把出掉的牌加回去得到出牌前的手牌
          const before = e.type === 'play' ? [...g.hands[me], ...e.combo.cards] : g.hands[me];
          entry.hand = before.map((id) => cardLabel(id, this.level));
          if (this.pendingWhy) { const { ctx: _ctx, ...why } = this.pendingWhy; entry.why = why; }
          else if (this.pendingSug) entry.sug = this.pendingSug;
          if (this.pendingHint) entry.hint = this.pendingHint;
          this.pendingWhy = this.pendingSug = this.pendingHint = null;
          delete this.rec.pending;
        }
        this.rec.log.push(entry);
        break;
      }
      case 'trickEnd':
        this.rec?.log.push({ t: 'trick', ...(e.jiefeng ? { note: `${e.leader} 接风` } : {}) });
        this.leadNext = true;
        break;
      case 'finish':
        this.rec?.log.push({ t: 'finish', s: e.seat, note: `第 ${e.place} 个出完` });
        break;
      case 'roundEnd': {
        const r = this.rec;
        if (!r) break;
        const res = e.result;
        r.result = { order: res.order, winTeam: res.winTeam, up: res.up, note: res.note, levelsAfter: [rankName(res.levelsAfter[0]), rankName(res.levelsAfter[1])] };
        r.log.push({ t: 'trick', note: `本局${teamOf(me) === res.winTeam ? '我方' : '对方'}胜，升 ${res.up} 级` });
        delete r.live;
        delete r.pending;
        this.flush(true);
        this.rec = null;
        return;
      }
      default:
        return;
    }
    this.schedule();
  }

  /** 点“提示”得到的建议 */
  noteHint(d: DecisionLog) { this.pendingHint = d; }
}

