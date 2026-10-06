// 牌桌控制器：在规则引擎外加上计时、AI 座位、托管。
// 单机（浏览器内）和联机（服务端）共用。
import { GuandanGame, teamOf, type GameEvent, type RoundResult } from './game';
import { aiPlay, hintOptions } from './ai';
import { smartReturn } from './tribute';
import { smartDecide, smartDecideAsync, withContext, type DecisionLog, type MCRunner } from './autoplay';
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
  /** 托管/超时代打的决策依据（联机只发给该座位本人） */
  | { type: 'decision'; seat: number; d: DecisionLog }
  /** 暂停/继续（单机，或联机房间里只有一个真人时） */
  | { type: 'pause'; on: boolean }
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
  /**
   * 电脑座位的难度：normal 原电脑出牌（不记牌）；hard 与托管相同的策略（记牌、顾问、蒙特卡洛模拟）。
   * 1000 局对打：托管策略对原电脑每局净升级约 +0.7。
   */
  aiLevel: 'normal' | 'hard' = 'normal';
  /** 设置后，困难电脑的模拟交给它异步执行（单机用后台线程，界面不卡）；不设置时在当前线程同步执行（预算 autoBudgetMs） */
  mcRunner: MCRunner | null = null;
  /** 异步模拟时每手的时间预算（毫秒） */
  asyncBudgetMs = 700;
  /** 每次轮到新的出牌人（或暂停）加一，用于丢弃过期的异步决策 */
  private turnSerial = 0;
  /** 每个座位视角的记牌器（只用该座位能知道的公开信息），托管决策用 */
  private trackers = [0, 1, 2, 3].map((s) => new CardTracker(s));

  private timeouts = [0, 0, 0, 0];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private roundStartAt = 0;
  /** 暂停开始的时间，0 表示没有暂停 */
  private pausedAt = 0;
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
    const t = setTimeout(() => { this.chatTimers.delete(t); if (!this.disposed && !this.paused) fn(); }, ms);
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

  get paused() { return this.pausedAt > 0; }

  /**
   * 暂停/继续：暂停时停掉所有出牌计时并丢弃进行中的电脑模拟；
   * 继续时发牌动画和倒计时顺延暂停的时长（倒计时至少留 5 秒），电脑重新决策。
   */
  setPaused(on: boolean) {
    if (on === this.paused || this.disposed) return;
    if (on) {
      this.pausedAt = Date.now();
      this.clearTimers();
      this.turnSerial++;
      this.emit({ type: 'pause', on: true });
      return;
    }
    const gap = Date.now() - this.pausedAt;
    this.pausedAt = 0;
    this.roundStartAt += gap;
    const keep = new Map([...this.deadlines].map(([s, until]) => [s, Math.max(until + gap, Date.now() + 5000 * this.speed)]));
    this.emit({ type: 'pause', on: false });
    this.schedule(keep);
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
    if (this.paused) return '游戏已暂停';
    const err = this.game.play(seat, cards, combo);
    if (!err) this.timeouts[seat] = 0;
    return err;
  }

  pass(seat: number): string | null {
    if (this.paused) return '游戏已暂停';
    const err = this.game.pass(seat);
    if (!err) this.timeouts[seat] = 0;
    return err;
  }

  returnTribute(seat: number, cardId: number): string | null {
    if (this.paused) return '游戏已暂停';
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
    if (e.type === 'turn' || e.type === 'roundStart') this.turnSerial++;
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

  /** keep：继续游戏时沿用的倒计时（座位 → 截止时间） */
  private schedule(keep?: Map<number, number>) {
    if (this.disposed || this.paused) return;
    this.clearTimers();
    this.deadlines.clear();
    const g = this.game;
    if (g.phase === 'return') {
      for (const pr of g.pendingReturns) {
        const seat = pr.from;
        const act = () => {
          if (g.phase === 'return' && g.pendingReturns.some((p) => p.from === seat)) {
            g.returnTribute(seat, smartReturn(g.hands[seat], g.level, teamOf(seat) === teamOf(pr.to)));
          }
        };
        if (this.controlled(seat)) {
          this.after(this.dealDelay() + 1500 + Math.random() * 800, act);
        } else {
          const until = keep?.get(seat) ?? Date.now() + this.dealDelay() + TURN_SECONDS * 1000 * this.speed;
          this.setDeadline(seat, until);
          this.after((until - Date.now()) / this.speed, act);
        }
      }
      return;
    }
    if (g.phase !== 'play') return;
    const seat = g.turn;
    const until = keep?.get(seat) ?? Date.now() + this.dealDelay() + TURN_SECONDS * 1000 * this.speed;
    this.setDeadline(seat, until);
    if (this.controlled(seat)) {
      // 困难电脑异步模拟本身要花时间，等待短一些
      const think = this.isAI[seat] ? (this.aiLevel === 'hard' && this.mcRunner ? 250 + Math.random() * 400 : 700 + Math.random() * 700) : 600;
      const delay = this.dealDelay() + think;
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

  private aiAct(seat: number, source: DecisionLog['source'] = 'auto') {
    const g = this.game;
    if (g.phase !== 'play' || g.turn !== seat) return;
    const target = g.lastPlay?.combo ?? null, targetSeat = g.lastPlay?.seat ?? null;
    const basic = () => aiPlay({ seat, hand: g.hands[seat], level: g.level, target, targetSeat, handCounts: g.handCounts() });
    const input = { seat, hand: g.hands[seat], level: g.level, target, targetSeat, counts: g.handCounts(), tracker: this.trackers[seat] };
    if (this.isAI[seat] && this.aiLevel === 'normal') {
      this.apply(seat, basic());
      return;
    }
    if (this.isAI[seat] && this.mcRunner) {
      // 困难电脑：模拟在后台执行，回来时如果已经不是这一手（重开、换人、对局结束）就丢弃
      const serial = this.turnSerial;
      smartDecideAsync(input, this.asyncBudgetMs, this.mcRunner)
        .then((r) => r.combo, (err) => { console.error('电脑策略出错，改用原电脑出牌', err); return basic(); })
        .then((c) => {
          if (this.disposed || serial !== this.turnSerial || g.phase !== 'play' || g.turn !== seat) return;
          this.apply(seat, c);
        });
      return;
    }
    // 玩家托管、超时：有后台模拟线程时交给它（预算与困难电脑相同，样本多、也不卡住服务器），回来时已不是这一手就丢弃
    if (!this.isAI[seat] && this.mcRunner) {
      const serial = this.turnSerial;
      smartDecideAsync(input, this.asyncBudgetMs, this.mcRunner, source)
        .then((r) => {
          if (this.disposed || serial !== this.turnSerial || g.phase !== 'play' || g.turn !== seat) return;
          this.emitDecision(seat, r, input);
          this.apply(seat, r.combo);
        }, (err) => {
          console.error('托管策略出错，改用电脑出牌', err);
          if (this.disposed || serial !== this.turnSerial || g.phase !== 'play' || g.turn !== seat) return;
          this.apply(seat, basic());
        });
      return;
    }
    // 同步执行（没有后台线程时）：与“提示”相同的策略
    let c: Combo | null;
    try {
      const r = smartDecide(input, this.autoBudgetMs, source);
      c = r.combo;
      this.emitDecision(seat, r, input);
    } catch (err) {
      console.error('托管策略出错，改用电脑出牌', err);
      c = basic();
    }
    this.apply(seat, c);
  }

  /** 先发决策依据，再出牌：复盘日志能把依据挂到这手牌上（电脑座位不发） */
  private emitDecision(seat: number, r: ReturnType<typeof smartDecide>, input: Parameters<typeof withContext>[1]) {
    if (!r.log || this.isAI[seat]) return;
    let d: DecisionLog = r.log;
    try { d = withContext(r, input) ?? r.log; } catch (err) { console.warn('决策依据生成失败', err); }
    this.emit({ type: 'decision', seat, d });
  }

  private apply(seat: number, c: Combo | null) {
    const g = this.game;
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
    this.aiAct(seat, this.auto[seat] ? 'auto' : 'timeout');
  }
}
