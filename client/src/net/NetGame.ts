// 联机对局：把服务器事件应用到本地状态镜像，再转发给视图。
import { partnerOf, type Phase } from '@shared/game';
import type { Combo } from '@shared/combo';
import type { ChatKind } from '@shared/chat';
import type { NetEvent, PlayerInfo, ServerMsg, Snapshot } from '@shared/protocol';
import type { ClientEvent, GameClient, GameStateView } from '../game/types';
import type { Connection } from './Connection';

class Mirror implements GameStateView {
  level = 2;
  levels: [number, number] = [2, 2];
  levelTeam = 0;
  phase: Phase = 'idle';
  hands: number[][] = [[], [], [], []];
  counts = [27, 27, 27, 27];
  lastPlay: { seat: number; combo: Combo } | null = null;
  turn = -1;
  finishOrder: number[] = [];
  pendingReturns: { from: number; to: number }[] = [];
  isActive(seat: number) { return !this.finishOrder.includes(seat); }
  handCounts() { return this.counts; }
}

export class NetGame implements GameClient {
  readonly canRestart = false;
  readonly game = new Mirror();
  private auto = [false, false, false, false];
  private online = [true, true, true, true];
  private listeners: ((e: ClientEvent) => void)[] = [];
  private off: () => void;

  /** 服务端未配置 Jev 时不提供该方法，提示直接用本地结果 */
  requestAdvice?: (ctx: unknown, timeoutMs: number) => Promise<{ ranking: string[]; confidence?: number } | null>;

  constructor(private conn: Connection, readonly mySeat: number, readonly players: PlayerInfo[], jev = false) {
    this.off = conn.onMessage((m) => this.onServer(m));
    if (jev) this.requestAdvice = (ctx, timeoutMs) => this.askAdvice(ctx, timeoutMs);
  }

  on(fn: (e: ClientEvent) => void) { this.listeners.push(fn); }
  private emit(e: ClientEvent) { for (const fn of this.listeners) fn(e); }

  private onServer(m: ServerMsg) {
    if (m.t === 'ev') this.apply(m.e);
    else if (m.t === 'snapshot') this.load(m.s);
    else if (m.t === 'error') this.emit({ type: 'error', msg: m.msg });
    else if (m.t === 'advice') this.advicePending.get(m.id)?.(m.ranking ? { ranking: m.ranking, confidence: m.confidence } : null);
  }

  private apply(e: NetEvent) {
    const g = this.game;
    const me = this.mySeat;
    const known = (s: number) => s === me || (s === partnerOf(me) && !g.isActive(me));
    const take = (s: number, ids: number[]) => {
      const set = new Set(ids);
      g.hands[s] = g.hands[s].filter((x) => !set.has(x));
    };
    switch (e.type) {
      case 'roundStart':
        g.level = e.level; g.levels = e.levels; g.levelTeam = e.levelTeam;
        g.hands = e.hands.map((h) => [...h]);
        g.counts = [27, 27, 27, 27];
        g.finishOrder = []; g.lastPlay = null; g.turn = -1; g.phase = 'idle'; g.pendingReturns = [];
        break;
      case 'tribute':
        g.phase = 'return';
        g.pendingReturns = e.list.map((t) => ({ from: t.to, to: t.from }));
        for (const t of e.list) {
          g.counts[t.from]--; g.counts[t.to]++;
          if (known(t.from)) take(t.from, [t.card]);
          if (known(t.to)) g.hands[t.to].push(t.card);
        }
        break;
      case 'returnTribute':
        g.pendingReturns = g.pendingReturns.filter((p) => p.from !== e.from);
        g.counts[e.from]--; g.counts[e.to]++;
        if (known(e.from)) take(e.from, [e.card]);
        if (known(e.to)) g.hands[e.to].push(e.card);
        break;
      case 'turn':
        g.phase = 'play';
        g.turn = e.seat;
        if (e.lead) g.lastPlay = null;
        break;
      case 'play':
        g.lastPlay = { seat: e.seat, combo: e.combo };
        g.counts[e.seat] = e.left;
        take(e.seat, e.combo.cards);
        break;
      case 'trickEnd':
        g.lastPlay = null;
        break;
      case 'finish':
        g.finishOrder.push(e.seat);
        break;
      case 'roundEnd':
        g.phase = e.result.gameOver ? 'gameEnd' : 'roundEnd';
        g.levels = e.result.levelsAfter;
        g.turn = -1;
        break;
      case 'reveal':
        g.hands[e.seat] = [...e.cards];
        break;
      case 'auto':
        this.auto[e.seat] = e.on;
        break;
      case 'presence':
        this.online[e.seat] = e.online;
        break;
      case 'deadline':
        this.emit({ type: 'deadline', seat: e.seat, until: Date.now() + e.left });
        return;
    }
    this.emit(e);
  }

  private load(s: Snapshot) {
    const g = this.game;
    g.level = s.level; g.levels = s.levels; g.levelTeam = s.levelTeam; g.phase = s.phase;
    g.hands = [[], [], [], []];
    g.hands[s.seat] = [...s.myHand];
    if (s.reveal) g.hands[s.reveal.seat] = [...s.reveal.cards];
    g.counts = [...s.counts];
    g.lastPlay = s.lastPlay;
    g.turn = s.turn;
    g.finishOrder = [...s.finishOrder];
    g.pendingReturns = [...s.pendingReturns];
    this.auto = [...s.auto];
    this.online = [...s.online];
    this.emit({ type: 'sync' });
    for (const d of s.deadlines) this.emit({ type: 'deadline', seat: d.seat, until: Date.now() + d.left });
    if (s.result && (s.phase === 'roundEnd' || s.phase === 'gameEnd')) this.emit({ type: 'roundEnd', result: s.result });
  }

  isAuto(seat: number) { return this.auto[seat]; }
  isOnline(seat: number) { return this.online[seat]; }

  private adviceSeq = 0;
  private advicePending = new Map<number, (r: { ranking: string[]; confidence?: number } | null) => void>();

  private askAdvice(ctx: unknown, timeoutMs: number): Promise<{ ranking: string[]; confidence?: number } | null> {
    const id = ++this.adviceSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.advicePending.delete(id); resolve(null); }, timeoutMs);
      this.advicePending.set(id, (r) => { clearTimeout(timer); this.advicePending.delete(id); resolve(r); });
      this.conn.send({ t: 'advise', id, ctx });
    });
  }

  play(cards: number[], combo?: Combo): string | null {
    this.conn.send({ t: 'play', cards, type: combo?.type });
    return null;
  }

  pass(): string | null {
    if (!this.game.lastPlay) return '首出不能不出';
    this.conn.send({ t: 'pass' });
    return null;
  }

  returnTribute(cardId: number): string | null {
    this.conn.send({ t: 'return', card: cardId });
    return null;
  }

  setAuto(on: boolean) { this.conn.send({ t: 'auto', on }); }
  chat(kind: ChatKind, id: number, to?: number) { this.conn.send({ t: 'chat', kind, id, to }); return null; }
  nextRound() { this.conn.send({ t: 'next' }); }
  restart() { /* 联机不支持 */ }
  dispose() { this.off(); }
}
