// 房间：座位管理、准备/开局、把牌桌事件按座位过滤后下发。
import type { WebSocket } from 'ws';
import { Table, type TableEvent } from '../shared/table';
import { partnerOf } from '../shared/game';
import type { NetEvent, PlayerInfo, RoomInfo, ServerMsg, Snapshot, Voice } from '../shared/protocol';
import type { ChatKind } from '../shared/chat';
import { isConfigured as jevReady, warmUp } from './jev';
import type { ComboType } from '../shared/combo';

const AI_NAMES = ['阿强', '小美', '老王', '二丫', '大刘', '阿珍', '胖虎', '小雪', '铁柱', '翠花'];
const NEXT_ROUND_MS = 20_000;
const WAITING_DROP_MS = 60_000;

interface Human {
  kind: 'human';
  token: string;
  name: string;
  avatar: number;
  voice: Voice;
  ws: WebSocket | null;
  ready: boolean;
  /** 游戏中途离开房间，座位交给 AI */
  left: boolean;
  /** 因断线被自动托管，重连后取消 */
  autoByDrop: boolean;
  dropTimer?: ReturnType<typeof setTimeout>;
}
interface Bot { kind: 'ai'; name: string; avatar: number; voice: Voice }
type Seat = Human | Bot | null;

export class Room {
  seats: Seat[] = [null, null, null, null];
  host = 0;
  table: Table | null = null;
  players: PlayerInfo[] = [];
  lastActive = Date.now();
  private nextAck = new Set<number>();
  private nextTimer?: ReturnType<typeof setTimeout>;

  constructor(public code: string, private onEmpty: (r: Room) => void, private tokenMap: Map<string, Room>) {}

  get playing() { return this.table !== null; }

  private humans(): [number, Human][] {
    const out: [number, Human][] = [];
    this.seats.forEach((s, i) => { if (s?.kind === 'human' && !s.left) out.push([i, s]); });
    return out;
  }

  seatOf(token: string): number {
    return this.seats.findIndex((s) => s?.kind === 'human' && s.token === token && !s.left);
  }

  info(): RoomInfo {
    return {
      code: this.code,
      host: this.host,
      state: this.playing ? 'playing' : 'waiting',
      seats: this.seats.map((s) => s && ({
        name: s.name, avatar: s.avatar, isAI: s.kind === 'ai', voice: s.voice,
        ready: s.kind === 'ai' || s.ready, online: s.kind === 'ai' || !!s.ws,
      })),
    };
  }

  private send(ws: WebSocket | null, msg: ServerMsg) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private sendSeat(seat: number, msg: ServerMsg) {
    const s = this.seats[seat];
    if (s?.kind === 'human' && !s.left) this.send(s.ws, msg);
  }

  broadcastRoom() {
    for (const [i, h] of this.humans()) this.send(h.ws, { t: 'room', room: this.info(), seat: i });
  }

  // ---------- 座位 ----------

  /** 加入或重连。返回错误信息。 */
  join(token: string, name: string, ws: WebSocket, voice: Voice = 'male'): string | null {
    this.lastActive = Date.now();
    const existing = this.seatOf(token);
    if (existing >= 0) {
      const h = this.seats[existing] as Human;
      if (h.ws && h.ws !== ws) this.send(h.ws, { t: 'error', msg: '你已在其他页面进入该房间' });
      h.ws = ws;
      if (name && !this.table) h.name = name;
      h.voice = voice;
      clearTimeout(h.dropTimer);
      this.tokenMap.set(token, this);
      this.broadcastRoom();
      if (this.table) {
        this.send(ws, { t: 'start', seat: existing, players: this.players, jev: jevReady() });
        this.send(ws, { t: 'snapshot', s: this.snapshot(existing) });
        this.broadcastEvent({ type: 'presence', seat: existing, online: true });
        if (h.autoByDrop) { h.autoByDrop = false; this.table.setAuto(existing, false); }
      }
      return null;
    }
    if (this.playing) return '游戏已经开始，无法加入';
    const seat = this.seats.findIndex((s) => s === null);
    if (seat < 0) return '房间已满';
    const used = new Set(this.seats.map((s) => s?.avatar));
    let avatar = 0;
    while (used.has(avatar)) avatar++;
    this.seats[seat] = { kind: 'human', token, name, avatar, voice, ws, ready: false, left: false, autoByDrop: false };
    if (this.humans().length === 1) this.host = seat;
    this.tokenMap.set(token, this);
    this.broadcastRoom();
    return null;
  }

  disconnect(token: string, ws: WebSocket) {
    const seat = this.seatOf(token);
    if (seat < 0) return;
    const h = this.seats[seat] as Human;
    if (h.ws !== ws) return;
    h.ws = null;
    if (this.table) {
      this.broadcastEvent({ type: 'presence', seat, online: false });
      if (!this.table.auto[seat]) { h.autoByDrop = true; this.table.setAuto(seat, true); }
      this.checkNext();
    } else {
      // 等待中断线：保留座位一段时间
      h.dropTimer = setTimeout(() => this.leave(token), WAITING_DROP_MS);
    }
    this.broadcastRoom();
    if (!this.humans().some(([, x]) => x.ws)) this.lastActive = Date.now();
  }

  leave(token: string) {
    const seat = this.seatOf(token);
    if (seat < 0) return;
    const h = this.seats[seat] as Human;
    clearTimeout(h.dropTimer);
    this.tokenMap.delete(token);
    this.send(h.ws, { t: 'left' });
    if (this.table) {
      h.left = true;
      h.ws = null;
      this.players[seat] = { ...this.players[seat], isAI: true };
      this.table.auto[seat] = false;
      this.table.setAI(seat, true);
      this.broadcastEvent({ type: 'presence', seat, online: false });
      this.checkNext();
    } else {
      this.seats[seat] = null;
    }
    const left = this.humans();
    if (!left.length) { this.dispose(); return; }
    if (this.host === seat) this.host = left[0][0];
    this.broadcastRoom();
  }

  sit(token: string, to: number): string | null {
    const from = this.seatOf(token);
    if (this.playing) return '游戏中不能换座';
    if (to === from) return null; // 已经坐在这里（例如重复点击）
    if (to < 0 || to > 3 || this.seats[to]) return '该座位已有人';
    const h = this.seats[from] as Human;
    this.seats[to] = h;
    this.seats[from] = null;
    h.ready = false;
    if (this.host === from) this.host = to;
    this.broadcastRoom();
    return null;
  }

  setReady(token: string, on: boolean) {
    const seat = this.seatOf(token);
    (this.seats[seat] as Human).ready = on;
    this.broadcastRoom();
  }

  addAI(token: string, seat: number): string | null {
    if (this.seatOf(token) !== this.host) return '只有房主可以添加电脑';
    if (this.playing) return '游戏已开始';
    if (seat < 0 || seat > 3 || this.seats[seat]) return '该座位已有人';
    const used = new Set(this.seats.map((s) => s?.name));
    const name = AI_NAMES.filter((n) => !used.has(n))[Math.floor(Math.random() * 6)] ?? '电脑';
    const avs = new Set(this.seats.map((s) => s?.avatar));
    let avatar = 0;
    while (avs.has(avatar)) avatar++;
    this.seats[seat] = { kind: 'ai', name, avatar, voice: Math.random() < 0.5 ? 'male' : 'female' };
    this.broadcastRoom();
    return null;
  }

  removeAI(token: string, seat: number): string | null {
    if (this.seatOf(token) !== this.host) return '只有房主可以移除电脑';
    if (this.playing) return '游戏已开始';
    if (this.seats[seat]?.kind !== 'ai') return '该座位不是电脑';
    this.seats[seat] = null;
    this.broadcastRoom();
    return null;
  }

  // ---------- 对局 ----------

  start(token: string): string | null {
    const seat = this.seatOf(token);
    if (seat !== this.host) return '只有房主可以开始游戏';
    if (this.playing) return '游戏已开始';
    if (this.seats.some((s) => !s)) return '需要 4 个座位都坐满（可添加电脑）';
    const notReady = this.humans().filter(([i, h]) => i !== this.host && !h.ready);
    if (notReady.length) return `还有玩家未准备：${notReady.map(([, h]) => h.name).join('、')}`;
    this.players = this.seats.map((s) => ({ name: s!.name, avatar: s!.avatar, isAI: s!.kind === 'ai', voice: s!.voice }));
    const table = new Table(this.seats.map((s) => s!.kind === 'ai'));
    this.table = table;
    table.on((e) => this.onTableEvent(e));
    warmUp();
    for (const [i, h] of this.humans()) this.send(h.ws, { t: 'start', seat: i, players: this.players, jev: jevReady() });
    this.broadcastRoom();
    table.start();
    return null;
  }

  action(token: string, msg: { t: string; cards?: number[]; type?: ComboType; card?: number; on?: boolean; kind?: ChatKind; id?: number; to?: number }): string | null {
    const seat = this.seatOf(token);
    const table = this.table;
    if (!table || seat < 0) return '游戏未开始';
    this.lastActive = Date.now();
    switch (msg.t) {
      case 'play': {
        if (!Array.isArray(msg.cards)) return '参数错误';
        const chosen = msg.type ? { type: msg.type, cards: msg.cards, value: 0 } : undefined;
        return table.play(seat, msg.cards, chosen);
      }
      case 'pass': return table.pass(seat);
      case 'return': return table.returnTribute(seat, Number(msg.card));
      case 'auto':
        (this.seats[seat] as Human).autoByDrop = false;
        table.setAuto(seat, !!msg.on);
        return null;
      case 'chat':
        return table.chat(seat, msg.kind as ChatKind, Number(msg.id), msg.to === undefined ? undefined : Number(msg.to));
      case 'next':
        this.nextAck.add(seat);
        this.checkNext();
        return null;
    }
    return '未知操作';
  }

  private onTableEvent(e: TableEvent) {
    const table = this.table!;
    if (e.type === 'roundStart') {
      clearTimeout(this.nextTimer);
      for (const [i, h] of this.humans()) {
        this.send(h.ws, { t: 'ev', e: { ...e, hands: e.hands.map((hand, j) => (j === i ? hand : [])) } });
      }
      return;
    }
    if (e.type === 'deadline') {
      this.broadcastEvent({ type: 'deadline', seat: e.seat, left: e.until - Date.now() });
      return;
    }
    if (e.type === 'finish') {
      const p = partnerOf(e.seat);
      if (table.game.isActive(p)) this.sendSeat(e.seat, { t: 'ev', e: { type: 'reveal', seat: p, cards: [...table.game.hands[p]] } });
    }
    this.broadcastEvent(e);
    if (e.type === 'roundEnd') {
      this.nextAck.clear();
      if (!e.result.gameOver) this.nextTimer = setTimeout(() => this.advance(), NEXT_ROUND_MS);
      this.checkNext();
    }
  }

  private broadcastEvent(e: NetEvent) {
    for (const [, h] of this.humans()) this.send(h.ws, { t: 'ev', e });
  }

  /** 所有在线玩家都点了“下一局/再来一盘”就继续 */
  private checkNext() {
    const g = this.table?.game;
    if (!g || (g.phase !== 'roundEnd' && g.phase !== 'gameEnd')) return;
    const waiting = this.humans().filter(([i, h]) => h.ws && !this.nextAck.has(i)).map(([i]) => i);
    if (!waiting.length && this.humans().some(([, h]) => h.ws)) { this.advance(); return; }
    this.broadcastEvent({ type: 'nextWait', waiting });
  }

  private advance() {
    const t = this.table;
    if (!t) return;
    clearTimeout(this.nextTimer);
    this.nextAck.clear();
    if (t.game.phase === 'roundEnd') t.nextRound();
    else if (t.game.phase === 'gameEnd') t.start();
  }

  snapshot(seat: number): Snapshot {
    const t = this.table!;
    const g = t.game;
    const p = partnerOf(seat);
    const reveal = !g.isActive(seat) && g.isActive(p) && g.phase === 'play' ? { seat: p, cards: [...g.hands[p]] } : null;
    return {
      seat,
      players: this.players,
      level: g.level,
      levels: [...g.levels],
      levelTeam: g.levelTeam,
      phase: g.phase,
      myHand: [...g.hands[seat]],
      reveal,
      counts: g.handCounts(),
      lastPlay: g.lastPlay,
      turn: g.turn,
      finishOrder: [...g.finishOrder],
      pendingReturns: [...g.pendingReturns],
      deadlines: [...t.deadlines].map(([s, until]) => ({ seat: s, left: until - Date.now() })),
      auto: [...t.auto],
      online: this.seats.map((s) => s?.kind === 'ai' || (s?.kind === 'human' && !!s.ws && !s.left)),
      result: t.lastResult,
    };
  }

  dispose() {
    clearTimeout(this.nextTimer);
    this.table?.dispose();
    this.table = null;
    for (const s of this.seats) if (s?.kind === 'human') { clearTimeout(s.dropTimer); this.tokenMap.delete(s.token); }
    this.onEmpty(this);
  }
}
