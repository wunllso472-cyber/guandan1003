// 记牌器：从某个座位的视角，记录所有公开信息并推算外面的牌。
// 只使用该玩家本来就能知道的信息（自己的手牌、公开出牌、不出、进贡/还贡的牌、自己出完后看到的对家手牌）。
import { ALL_IDS, card, cardValue, isWild, BIG_JOKER, SMALL_JOKER } from './cards';
import type { Combo, ComboType } from './combo';
import type { GameEvent } from './game';

export interface PassRecord { type: ComboType; value: number; size: number }

export interface SeatRecord {
  /** 出过的牌组（按时间顺序） */
  plays: Combo[];
  /** 首出时出的牌型（用于判断对家擅长什么） */
  leads: ComboType[];
  /** 面对哪些牌选择了“不出” */
  passes: PassRecord[];
  /** 确定在他手里的牌（进贡/还贡时公开、且还没打出） */
  known: Set<number>;
  /** 剩余张数 */
  count: number;
  /** 名次，0 表示还没出完 */
  place: number;
}

const newSeat = (): SeatRecord => ({ plays: [], leads: [], passes: [], known: new Set(), count: 27, place: 0 });

export class CardTracker {
  level = 2;
  seats: SeatRecord[] = [newSeat(), newSeat(), newSeat(), newSeat()];
  /** 已经打出的所有牌 */
  played = new Set<number>();
  /** 出牌历史，combo 为 null 表示不出 */
  history: { seat: number; combo: Combo | null }[] = [];
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
      case 'tribute':
        for (const t of e.list) this.move(t.from, t.to, t.card);
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
        this.history.push({ seat: e.seat, combo: e.combo });
        this.lastPlay = { seat: e.seat, combo: e.combo };
        break;
      }
      case 'pass':
        if (this.lastPlay) {
          const c = this.lastPlay.combo;
          this.seats[e.seat].passes.push({ type: c.type, value: c.value, size: c.cards.length });
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
  return { byRank, wilds, topValue };
}

export const JOKER_RANKS = [SMALL_JOKER, BIG_JOKER];
