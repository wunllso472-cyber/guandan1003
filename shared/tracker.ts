// 记牌器：从某个座位的视角，记录所有公开信息并推算外面的牌。
// 只使用该玩家本来就能知道的信息（自己的手牌、公开出牌、不出、进贡/还贡/抗贡、自己出完后看到的对家手牌）。
import { ALL_IDS, card, cardValue, isWild, value, BIG_JOKER, SMALL_JOKER } from './cards';
import type { Combo, ComboType } from './combo';
import type { GameEvent } from './game';

const BIG_JOKER_IDS = ALL_IDS.filter((id) => card(id).rank === BIG_JOKER);

export interface PassRecord {
  type: ComboType; value: number; size: number;
  /** 面对的是谁出的牌（面对搭档的牌不出是让牌，不能说明缺牌） */
  seat: number;
}

export interface SeatRecord {
  /** 出过的牌组（按时间顺序） */
  plays: Combo[];
  /** 首出时出的牌型（用于判断对家擅长什么） */
  leads: ComboType[];
  /** 面对哪些牌选择了“不出” */
  passes: PassRecord[];
  /** 确定在他手里的牌（进贡/还贡时公开、单下抗贡的两张大王，且还没打出） */
  known: Set<number>;
  /**
   * 确定不在他手里的牌（硬约束，不是推测）：
   * 进贡必须交最大的牌（逢人配除外），所以进贡者当时没有比贡牌更大的非逢人配牌；
   * 抗贡时两张大王都在进贡方手里，其他人没有大王。
   */
  lacks: Set<number>;
  /** 这一局进贡交出的牌（没有进贡为 null） */
  tributed: number | null;
  /** 剩余张数 */
  count: number;
  /** 名次，0 表示还没出完 */
  place: number;
}

const newSeat = (): SeatRecord => ({ plays: [], leads: [], passes: [], known: new Set(), lacks: new Set(), tributed: null, count: 27, place: 0 });

export class CardTracker {
  level = 2;
  seats: SeatRecord[] = [newSeat(), newSeat(), newSeat(), newSeat()];
  /** 已经打出的所有牌 */
  played = new Set<number>();
  /** 出牌历史，combo 为 null 表示不出 */
  history: { seat: number; combo: Combo | null; lead?: boolean }[] = [];
  /** 当前这一轮最后一手牌 */
  lastPlay: { seat: number; combo: Combo } | null = null;

  constructor(public mySeat: number) {}

  /** 接收对局事件（单机和联机的事件格式相同） */
  apply(e: GameEvent) {
    switch (e.type) {
      case 'roundStart':
        this.level = e.level;
        this.seats = [newSeat(), newSeat(), newSeat(), newSeat()];
        this.played.clear();
        this.history = [];
        this.lastPlay = null;
        break;
      case 'antiTribute': {
        // 抗贡：进贡方（一人或两人）合计有两张大王
        const givers = new Set(e.seats);
        for (let s = 0; s < 4; s++) {
          if (givers.has(s)) continue;
          for (const id of BIG_JOKER_IDS) this.seats[s].lacks.add(id);
        }
        if (e.seats.length === 1) for (const id of BIG_JOKER_IDS) this.seats[e.seats[0]].known.add(id);
        break;
      }
      case 'tribute':
        for (const t of e.list) {
          // 贡牌是他当时最大的非逢人配牌：比它大的非逢人配牌都不在他手里
          const v = cardValue(t.card, this.level);
          const rec = this.seats[t.from];
          rec.tributed = t.card;
          for (const id of ALL_IDS) if (!isWild(id, this.level) && cardValue(id, this.level) > v) rec.lacks.add(id);
          this.move(t.from, t.to, t.card);
        }
        break;
      case 'returnTribute':
        this.move(e.from, e.to, e.card);
        break;
      case 'turn':
        if (e.lead) this.lastPlay = null;
        break;
      case 'play': {
        const s = this.seats[e.seat];
        if (!this.lastPlay) s.leads.push(e.combo.type);
        s.plays.push(e.combo);
        s.count = e.left;
        for (const id of e.combo.cards) { this.played.add(id); s.known.delete(id); }
        this.history.push({ seat: e.seat, combo: e.combo, lead: !this.lastPlay });
        this.lastPlay = { seat: e.seat, combo: e.combo };
        break;
      }
      case 'pass':
        if (this.lastPlay) {
          const c = this.lastPlay.combo;
          this.seats[e.seat].passes.push({ type: c.type, value: c.value, size: c.cards.length, seat: this.lastPlay.seat });
        }
        this.history.push({ seat: e.seat, combo: null });
        break;
      case 'trickEnd':
        this.lastPlay = null;
        break;
      case 'finish':
        this.seats[e.seat].place = e.place;
        this.seats[e.seat].count = 0;
        break;
    }
  }

  private move(from: number, to: number, id: number) {
    this.seats[from].count--;
    this.seats[to].count++;
    this.seats[from].known.delete(id);
    this.seats[to].known.add(id);
    this.seats[to].lacks.delete(id);
  }

  /**
   * 外面的牌：不在我手里、没打出过、也不在已知的对家手牌里（自己出完后可见）。
   * 这些牌分布在其他三家手中。
   */
  unseen(myHand: number[], partnerHand: number[] | null = null): number[] {
    const mine = new Set(myHand);
    const partner = new Set(partnerHand ?? []);
    return ALL_IDS.filter((id) => !mine.has(id) && !this.played.has(id) && !partner.has(id));
  }
}

/** 外面的牌按点数统计（逢人配单独计数） */
export interface UnseenStat {
  /** 自然牌每个点数还剩几张（含王：16 小王、17 大王） */
  byRank: Map<number, number>;
  /** 外面还剩几张逢人配 */
  wilds: number;
  /** 外面最大的单张点值（cardValue），没有时为 0 */
  topValue: number;
  /** 外面可能凑出的同花顺中最大的起点（A 作 1 时为 1），凑不出时为 0 */
  maxSfStart: number;
}

export function unseenStat(ids: number[], level: number): UnseenStat {
  const byRank = new Map<number, number>();
  let wilds = 0, topValue = 0;
  for (const id of ids) {
    topValue = Math.max(topValue, cardValue(id, level));
    if (isWild(id, level)) { wilds++; continue; }
    const r = card(id).rank;
    byRank.set(r, (byRank.get(r) ?? 0) + 1);
  }
  return { byRank, wilds, topValue, maxSfStart: maxSfStart(ids, level, wilds) };
}

/** 外面的牌能凑出的最大同花顺起点：同花色连续 5 个点数，缺的用逢人配补 */
function maxSfStart(ids: number[], level: number, wilds: number): number {
  const has = new Set<string>();
  for (const id of ids) if (!isWild(id, level)) has.add(card(id).suit + card(id).rank);
  let best = 0;
  for (const suit of ['S', 'H', 'C', 'D']) {
    for (let start = 1; start <= 10; start++) {
      let need = 0;
      for (let p = 0; p < 5; p++) {
        const r = start + p === 1 ? 14 : start + p;
        if (!has.has(suit + r)) need++;
      }
      if (need <= wilds) best = Math.max(best, start);
    }
  }
  return best;
}

export const JOKER_RANKS = [SMALL_JOKER, BIG_JOKER];

/** 外面能否用同类型的牌压过 */
export function sameTypeBeatable(c: Pick<Combo, 'type' | 'value'>, st: UnseenStat, level: number): boolean {
  const nat = (r: number) => st.byRank.get(r) ?? 0;
  const v = (r: number) => value(r, level);
  switch (c.type) {
    case 'single':
      return st.topValue > c.value;
    case 'pair':
      if (st.wilds >= 2 && 15 > c.value) return true;
      for (const r of [SMALL_JOKER, BIG_JOKER]) if (nat(r) >= 2 && r > c.value) return true;
      for (let r = 2; r <= 14; r++) if (v(r) > c.value && nat(r) >= 1 && nat(r) + st.wilds >= 2) return true;
      return false;
    case 'triple': case 'fullhouse':
      for (let r = 2; r <= 14; r++) if (v(r) > c.value && nat(r) >= 1 && nat(r) + st.wilds >= 3) return true;
      return false;
    case 'straight': case 'tube': case 'plate': {
      const [len, mult] = c.type === 'straight' ? [5, 1] : c.type === 'tube' ? [3, 2] : [2, 3];
      for (let start = c.value + 1; start + len - 1 <= 14; start++) {
        let need = 0;
        for (let p = 0; p < len; p++) need += Math.max(0, mult - nat(start + p));
        if (need <= st.wilds) return true;
      }
      return false;
    }
    default:
      return false;
  }
}
