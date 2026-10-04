// 牌桌控制器：在规则引擎外加上计时、AI 座位、托管。
// 单机（浏览器内）和联机（服务端）共用。
import { GuandanGame, type GameEvent, type RoundResult } from './game';
import { aiPlay, returnCard, hintOptions } from './ai';
import { smartPlay } from './autoplay';
import { CardTracker } from './tracker';
import { isBomb, type Combo } from './combo';
import { validateChat, CHAT_COOLDOWN_MS, type ChatKind, type ChatMsg } from './chat';

export const TURN_SECONDS = 30;
/** 发牌动画时长，第一手出牌前等待 */
const DEAL_MS = 2200;

export type TableEvent =
  | GameEvent
  | { type: 'deadline'; seat: number; until: number }
  | { type: 'auto'; seat: number; on: boolean }
  | ({ type: 'chat' } & ChatMsg);

export class Table {
  readonly game = new GuandanGame();
  /** 玩家托管（AI 座位始终由 AI 控制，不算托管） */
  readonly auto = [false, false, false, false];
  /** 当前的倒计时：座位 → 截止时间 */
  readonly deadlines = new Map<number, number>();
  lastResult: RoundResult | null = null;
  /** 调试用：时间倍率 */
  speed = 1;
  /**
   * 托管（含超时代打）用“提示”的策略时，每手蒙特卡洛模拟的时间预算（毫秒）。
   * 模拟在当前线程同步执行，单机会短暂占用浏览器、联机会占用服务端，所以预算要小；0 表示只用顾问。
   */
  autoBudgetMs = 300;
  /** 每个座位视角的记牌器（只用该座位能知道的公开信息），托管决策用 */
  private trackers = [0, 1, 2, 3].map((s) => new CardTracker(s));

  private timeouts = [0, 0, 0, 0];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private roundStartAt = 0;
  private disposed = false;
  private listeners: ((e: TableEvent) => void)[] = [];
  private lastChat = [0, 0, 0, 0];
  /** 电脑互动用的计时器，不随出牌调度清除 */
  private chatTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(public isAI: boolean[]) {
    this.game.on((e) => this.handle(e));
  }

  on(fn: (e: TableEvent) => void) { this.listeners.push(fn); }
  private emit(e: TableEvent) { for (const fn of this.listeners) fn(e); }

  controlled(seat: number) { return this.isAI[seat] || this.auto[seat]; }

  start() {
    this.clearTimers();
    this.lastResult = null;
    this.game.newGame();
    this.game.startRound();
  }

  nextRound() {
    if (this.game.phase === 'roundEnd') this.game.startRound();
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
    for (const t of this.chatTimers) clearTimeout(t);
    this.chatTimers.clear();
  }

  /** 发送快捷语/表情/道具（有冷却） */
  chat(seat: number, kind: ChatKind, id: number, to?: number): string | null {
    const msg: ChatMsg = { seat, kind, id, ...(kind === 'prop' ? { to } : {}) };
    const err = validateChat(msg);
    if (err) return err;
    const now = Date.now();
    if (now - this.lastChat[seat] < CHAT_COOLDOWN_MS) return '发送太频繁了';
    this.lastChat[seat] = now;
    this.emit({ type: 'chat', ...msg });
    // 电脑被砸道具时可能回敬
    if (kind === 'prop' && to !== undefined && this.isAI[to] && Math.random() < 0.4) {
      const back = id >= 3 ? id : Math.random() < 0.5 ? 1 : 0;
      this.aiLater(1200 + Math.random() * 800, () => this.chat(to, 'prop', back, seat));
    }
    return null;
  }

  private aiLater(ms: number, fn: () => void) {
    const t = setTimeout(() => { this.chatTimers.delete(t); if (!this.disposed) fn(); }, ms);
    this.chatTimers.add(t);
  }

  /** 电脑偶尔的互动 */
  private aiReact(e: GameEvent) {
    if (e.type === 'play' && this.isAI[e.seat] && isBomb(e.combo) && Math.random() < 0.3) {
      this.aiLater(900, () => this.chat(e.seat, 'emoji', Math.random() < 0.5 ? 5 : 9));
    }
    if (e.type === 'finish' && e.place === 1 && this.isAI[e.seat] && Math.random() < 0.4) {
      this.aiLater(700, () => this.chat(e.seat, 'phrase', 3));
    }
  }

  setAuto(seat: number, on: boolean) {
    if (this.auto[seat] === on) return;
    this.auto[seat] = on;
    this.timeouts[seat] = 0;
    this.emit({ type: 'auto', seat, on });
    if (this.waitingOn(seat)) this.schedule();
  }

  /** 座位改由 AI 接管（玩家离开房间） */
  setAI(seat: number, on: boolean) {
    this.isAI[seat] = on;
    if (this.waitingOn(seat)) this.schedule();
  }

  /** 是否正在等这个座位操作 */
  private waitingOn(seat: number) {
    const g = this.game;
    if (g.phase === 'play') return g.turn === seat;
    if (g.phase === 'return') return g.pendingReturns.some((p) => p.from === seat);
    return false;
  }

  play(seat: number, cards: number[], combo?: Combo): string | null {
    const err = this.game.play(seat, cards, combo);
    if (!err) this.timeouts[seat] = 0;
    return err;
  }

  pass(seat: number): string | null {
    const err = this.game.pass(seat);
    if (!err) this.timeouts[seat] = 0;
    return err;
  }

  returnTribute(seat: number, cardId: number): string | null {
    return this.game.returnTribute(seat, cardId);
  }

  hints(seat: number): Combo[] {
    const g = this.game;
    return hintOptions({
      seat, hand: g.hands[seat], level: g.level,
      target: g.lastPlay?.combo ?? null, targetSeat: g.lastPlay?.seat ?? null, handCounts: g.handCounts(),
    });
  }

  private handle(e: GameEvent) {
    for (const t of this.trackers) t.apply(e);
    if (e.type === 'roundStart') { this.roundStartAt = Date.now(); this.lastResult = null; }
    if (e.type === 'roundEnd') {
      this.lastResult = e.result;
      this.clearTimers();
      this.deadlines.clear();
    }
    this.emit(e);
    this.aiReact(e);
    if (e.type === 'turn' || e.type === 'tribute') {
      // 等引擎本次调用结束后再调度，避免重入
      queueMicrotask(() => this.schedule());
    }
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private after(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, Math.max(0, ms) * this.speed));
  }

  private dealDelay() {
    return Math.max(0, this.roundStartAt + DEAL_MS - Date.now());
  }

  private setDeadline(seat: number, until: number) {
    this.deadlines.set(seat, until);
    this.emit({ type: 'deadline', seat, until });
  }

  private schedule() {
    if (this.disposed) return;
    this.clearTimers();
    this.deadlines.clear();
    const g = this.game;
    if (g.phase === 'return') {
      for (const pr of g.pendingReturns) {
        const seat = pr.from;
        const act = () => {
          if (g.phase === 'return' && g.pendingReturns.some((p) => p.from === seat)) {
            g.returnTribute(seat, returnCard(g.hands[seat], g.level));
          }
        };
        if (this.controlled(seat)) {
          this.after(this.dealDelay() + 1500 + Math.random() * 800, act);
        } else {
          const until = Date.now() + this.dealDelay() + TURN_SECONDS * 1000 * this.speed;
          this.setDeadline(seat, until);
          this.after((until - Date.now()) / this.speed, act);
        }
      }
      return;
    }
    if (g.phase !== 'play') return;
    const seat = g.turn;
    const until = Date.now() + this.dealDelay() + TURN_SECONDS * 1000 * this.speed;
    this.setDeadline(seat, until);
    if (this.controlled(seat)) {
      const delay = this.dealDelay() + (this.isAI[seat] ? 700 + Math.random() * 700 : 600);
      this.after(delay, () => this.aiAct(seat));
    } else {
      this.after((until - Date.now()) / this.speed, () => this.onTimeout(seat));
      // 玩家想太久，电脑催一下
      const others = [0, 1, 2, 3].filter((s) => s !== seat && this.isAI[s] && g.isActive(s));
      if (others.length && Math.random() < 0.35) {
        const who = others[Math.floor(Math.random() * others.length)];
        // 催促：普通话“快点吧”，偶尔用东北话、粤语版本（编号见 chat.ts 的 PHRASES）
        const nudge = Math.random() < 0.8 ? 0 : Math.random() < 0.5 ? 12 : 16;
        this.after(this.dealDelay() + 18000, () => this.chat(who, 'phrase', nudge));
      }
    }
  }

  private aiAct(seat: number) {
    const g = this.game;
    if (g.phase !== 'play' || g.turn !== seat) return;
    const target = g.lastPlay?.combo ?? null, targetSeat = g.lastPlay?.seat ?? null;
    let c: Combo | null;
    if (this.isAI[seat]) {
      // 电脑座位保持原来的出牌方式（不改变对手难度）
      c = aiPlay({ seat, hand: g.hands[seat], level: g.level, target, targetSeat, handCounts: g.handCounts() });
    } else {
      // 玩家托管或超时：与“提示”相同的策略
      try {
        c = smartPlay({ seat, hand: g.hands[seat], level: g.level, target, targetSeat, counts: g.handCounts(), tracker: this.trackers[seat] }, this.autoBudgetMs);
      } catch (err) {
        console.error('托管策略出错，改用电脑出牌', err);
        c = aiPlay({ seat, hand: g.hands[seat], level: g.level, target, targetSeat, handCounts: g.handCounts() });
      }
    }
    const err = c ? g.play(seat, c.cards, c) : g.pass(seat);
    if (err) {
      // 兜底：不应发生，避免卡死
      console.error('AI 出牌错误', err, c);
      if (g.lastPlay) g.pass(seat);
      else g.play(seat, [g.hands[seat][g.hands[seat].length - 1]]);
    }
  }

  private onTimeout(seat: number) {
    this.timeouts[seat]++;
    if (this.timeouts[seat] >= 2) {
      this.auto[seat] = true;
      this.emit({ type: 'auto', seat, on: true });
    }
    this.aiAct(seat);
  }
}
