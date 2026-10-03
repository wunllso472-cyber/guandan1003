// 掼蛋对局状态机。纯逻辑，单机和服务端共用。
// 座位 0..3，按 0→1→2→3 的顺序出牌；0、2 一队，1、3 一队。
import { ALL_IDS, card, shuffle, sortByValueDesc, cardValue, BIG_JOKER } from './cards';
import { playableInterpretations, resolvePlay, type Combo } from './combo';
import { tributeCard } from './ai';

export type Phase = 'idle' | 'return' | 'play' | 'roundEnd' | 'gameEnd';

export interface TributeInfo { from: number; to: number; card: number }

export interface RoundResult {
  order: number[];
  winTeam: number;
  levelsBefore: [number, number];
  levelsAfter: [number, number];
  up: number;
  gameOver: boolean;
  /** 打 A 失败次数变化提示 */
  note?: string;
}

export type GameEvent =
  /** roundNo：本盘第几局（1 表示新开一盘） */
  | { type: 'roundStart'; level: number; levelTeam: number; hands: number[][]; levels: [number, number]; roundNo: number }
  | { type: 'antiTribute'; seats: number[] }
  | { type: 'tribute'; list: TributeInfo[] }
  | { type: 'returnTribute'; from: number; to: number; card: number }
  | { type: 'turn'; seat: number; lead: boolean }
  | { type: 'play'; seat: number; combo: Combo; left: number }
  | { type: 'pass'; seat: number }
  | { type: 'trickEnd'; leader: number; jiefeng: boolean }
  | { type: 'finish'; seat: number; place: number }
  | { type: 'roundEnd'; result: RoundResult };

export const teamOf = (seat: number) => seat % 2;
export const partnerOf = (seat: number) => (seat + 2) % 4;

export class GuandanGame {
  levels: [number, number] = [2, 2];
  levelTeam = 0;
  aFails: [number, number] = [0, 0];
  phase: Phase = 'idle';
  hands: number[][] = [[], [], [], []];
  turn = -1;
  lastPlay: { seat: number; combo: Combo } | null = null;
  passCount = 0;
  finishOrder: number[] = [];
  /** 等待还贡：{收贡者 → 进贡者} */
  pendingReturns: { from: number; to: number }[] = [];
  /** 上一局的名次，用于进贡 */
  prevOrder: number[] | null = null;
  firstLeader = -1;
  roundNo = 0;

  private listeners: ((e: GameEvent) => void)[] = [];

  on(fn: (e: GameEvent) => void) { this.listeners.push(fn); }
  private emit(e: GameEvent) { for (const fn of this.listeners) fn(e); }

  get level(): number { return this.levels[this.levelTeam]; }

  isActive(seat: number) { return !this.finishOrder.includes(seat); }

  nextActive(seat: number): number {
    for (let i = 1; i <= 4; i++) {
      const s = (seat + i) % 4;
      if (this.isActive(s)) return s;
    }
    return -1;
  }

  handCounts(): number[] { return this.hands.map((h) => h.length); }

  /** 新游戏 */
  newGame() {
    this.levels = [2, 2];
    this.levelTeam = 0;
    this.aFails = [0, 0];
    this.prevOrder = null;
    this.roundNo = 0;
  }

  startRound(seed?: number) {
    this.roundNo++;
    const deck = shuffle([...ALL_IDS], seed);
    this.hands = [0, 1, 2, 3].map((s) => sortByValueDesc(deck.slice(s * 27, s * 27 + 27), this.level));
    this.finishOrder = [];
    this.lastPlay = null;
    this.passCount = 0;
    this.pendingReturns = [];
    this.emit({ type: 'roundStart', level: this.level, levelTeam: this.levelTeam, hands: this.hands.map((h) => [...h]), levels: [...this.levels], roundNo: this.roundNo });

    const order = this.prevOrder;
    if (!order) {
      // 首局随机先手
      const leader = seed !== undefined ? seed % 4 : Math.floor(Math.random() * 4);
      this.beginPlay(leader);
      return;
    }
    const first = order[0];
    const doubleDown = teamOf(order[1]) === teamOf(first);
    const givers = doubleDown ? [order[2], order[3]] : [order[3]];
    const bigJokers = givers.reduce((n, s) => n + this.hands[s].filter((id) => card(id).rank === BIG_JOKER).length, 0);
    if (bigJokers >= 2) {
      this.emit({ type: 'antiTribute', seats: givers });
      this.beginPlay(first);
      return;
    }
    const gifts = givers.map((s) => ({ from: s, card: tributeCard(this.hands[s], this.level) }));
    let list: TributeInfo[];
    if (!doubleDown) {
      list = [{ from: gifts[0].from, to: first, card: gifts[0].card }];
    } else {
      const [a, b] = gifts;
      const va = cardValue(a.card, this.level), vb = cardValue(b.card, this.level);
      // 大贡给头游；相同时由头游下家进贡给头游
      let big = a, small = b;
      if (vb > va || (vb === va && b.from === (first + 1) % 4)) { big = b; small = a; }
      list = [{ from: big.from, to: first, card: big.card }, { from: small.from, to: order[1], card: small.card }];
    }
    for (const t of list) {
      this.hands[t.from] = this.hands[t.from].filter((x) => x !== t.card);
      this.hands[t.to] = sortByValueDesc([...this.hands[t.to], t.card], this.level);
    }
    this.firstLeader = list[0].from;
    this.pendingReturns = list.map((t) => ({ from: t.to, to: t.from }));
    this.phase = 'return';
    this.emit({ type: 'tribute', list });
  }

  /** 还贡：只能还 10 及以下的牌（没有时可还任意牌）。 */
  returnTribute(seat: number, cardId: number): string | null {
    if (this.phase !== 'return') return '现在不是还贡阶段';
    const pr = this.pendingReturns.find((p) => p.from === seat);
    if (!pr) return '你不需要还贡';
    if (!this.hands[seat].includes(cardId)) return '没有这张牌';
    const hasSmall = this.hands[seat].some((id) => card(id).rank <= 10);
    if (hasSmall && card(cardId).rank > 10) return '还贡需选择 10 及以下的牌';
    this.hands[seat] = this.hands[seat].filter((x) => x !== cardId);
    this.hands[pr.to] = sortByValueDesc([...this.hands[pr.to], cardId], this.level);
    this.pendingReturns = this.pendingReturns.filter((p) => p !== pr);
    this.emit({ type: 'returnTribute', from: seat, to: pr.to, card: cardId });
    if (!this.pendingReturns.length) this.beginPlay(this.firstLeader);
    return null;
  }

  private beginPlay(leader: number) {
    this.phase = 'play';
    this.turn = leader;
    this.lastPlay = null;
    this.passCount = 0;
    this.emit({ type: 'turn', seat: leader, lead: true });
  }

  /** 出牌。combo 不传时自动选择最佳解释。返回错误信息或 null。 */
  play(seat: number, cards: number[], chosen?: Combo): string | null {
    if (this.phase !== 'play') return '现在不能出牌';
    if (seat !== this.turn) return '还没轮到你';
    if (!cards.length) return '请选择要出的牌';
    const hand = this.hands[seat];
    if (new Set(cards).size !== cards.length || cards.some((c) => !hand.includes(c))) return '手牌中没有这些牌';
    const target = this.lastPlay?.combo ?? null;
    const opts = resolvePlay(cards, this.level, target);
    if (!opts.length) return target ? '压不过上家' : '不符合出牌规则';
    let combo = opts[0];
    if (chosen) {
      // 按类型匹配（识别结果取该类型的最大值；顺子若同花则按同花顺）
      const all = playableInterpretations(cards, this.level, target);
      const m = all.find((o) => o.type === chosen.type) ??
        (chosen.type === 'straight' ? all.find((o) => o.type === 'straightflush') : undefined);
      if (!m) return '牌型不匹配';
      combo = m;
    }
    const used = new Set(cards);
    this.hands[seat] = hand.filter((c) => !used.has(c));
    this.lastPlay = { seat, combo };
    this.passCount = 0;
    this.emit({ type: 'play', seat, combo, left: this.hands[seat].length });
    if (this.hands[seat].length === 0) {
      this.finishOrder.push(seat);
      this.emit({ type: 'finish', seat, place: this.finishOrder.length });
      if (this.checkRoundEnd()) return null;
    }
    this.advance(seat);
    return null;
  }

  pass(seat: number): string | null {
    if (this.phase !== 'play') return '现在不能操作';
    if (seat !== this.turn) return '还没轮到你';
    if (!this.lastPlay) return '首出不能不出';
    this.passCount++;
    this.emit({ type: 'pass', seat });
    const ls = this.lastPlay.seat;
    const active = 4 - this.finishOrder.length;
    const need = active - (this.isActive(ls) ? 1 : 0);
    if (this.passCount >= need) {
      let leader: number;
      let jiefeng = false;
      if (this.isActive(ls)) leader = ls;
      else if (this.isActive(partnerOf(ls))) { leader = partnerOf(ls); jiefeng = true; }
      else leader = this.nextActive(ls);
      this.lastPlay = null;
      this.passCount = 0;
      this.turn = leader;
      this.emit({ type: 'trickEnd', leader, jiefeng });
      this.emit({ type: 'turn', seat: leader, lead: true });
      return null;
    }
    this.advance(seat);
    return null;
  }

  private advance(from: number) {
    this.turn = this.nextActive(from);
    this.emit({ type: 'turn', seat: this.turn, lead: false });
  }

  private checkRoundEnd(): boolean {
    const fo = this.finishOrder;
    const done = (fo.length >= 2 && teamOf(fo[0]) === teamOf(fo[1])) || fo.length >= 3;
    if (!done) return false;
    const rest = [0, 1, 2, 3].filter((s) => !fo.includes(s)).sort((a, b) => this.hands[a].length - this.hands[b].length);
    const order = [...fo, ...rest];
    this.endRound(order);
    return true;
  }

  private endRound(order: number[]) {
    const winTeam = teamOf(order[0]);
    const partnerPlace = order.indexOf(partnerOf(order[0]));
    const up = [0, 3, 2, 1][partnerPlace];
    const before: [number, number] = [...this.levels];
    let gameOver = false;
    let note: string | undefined;
    const playingA = this.levels[this.levelTeam] === 14;

    if (playingA && winTeam === this.levelTeam && partnerPlace !== 3) {
      gameOver = true;
    } else {
      if (playingA) {
        const t = this.levelTeam;
        this.aFails[t]++;
        if (this.aFails[t] >= 3) {
          this.levels[t] = 2;
          this.aFails[t] = 0;
          note = `${t === 0 ? '甲' : '乙'}队打 A 三次未过，退回打 2`;
        } else {
          note = `${t === 0 ? '甲' : '乙'}队打 A 未过（第 ${this.aFails[t]} 次）`;
        }
      }
      if (!(playingA && winTeam === this.levelTeam)) {
        this.levels[winTeam] = Math.min(14, this.levels[winTeam] + up);
      }
      this.levelTeam = winTeam;
    }
    this.prevOrder = order;
    this.phase = gameOver ? 'gameEnd' : 'roundEnd';
    this.turn = -1;
    this.emit({
      type: 'roundEnd',
      result: { order, winTeam, levelsBefore: before, levelsAfter: [...this.levels], up, gameOver, note },
    });
  }
}
