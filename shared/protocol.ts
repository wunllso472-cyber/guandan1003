// 联机协议（WebSocket 上的 JSON 消息）。
import type { Combo, ComboType } from './combo';
import type { GameEvent, Phase, RoundResult } from './game';
import type { ChatKind, ChatMsg } from './chat';
import type { DecisionLog } from './autoplay';

export type Voice = 'male' | 'female';

export interface PlayerInfo { name: string; avatar: number; isAI: boolean; voice: Voice }

export interface SeatInfo {
  name: string;
  avatar: number;
  isAI: boolean;
  ready: boolean;
  online: boolean;
  voice: Voice;
}

export interface RoomInfo {
  code: string;
  host: number; // 房主座位
  seats: (SeatInfo | null)[];
  state: 'waiting' | 'playing';
}

/** 发给某个座位的事件：在 GameEvent 基础上增加联机相关事件 */
export type NetEvent =
  | GameEvent
  /** left: 剩余毫秒（避免客户端时钟偏差） */
  | { type: 'deadline'; seat: number; left: number }
  | { type: 'auto'; seat: number; on: boolean }
  | { type: 'presence'; seat: number; online: boolean }
  /** 自己出完后看到的对家手牌 */
  | { type: 'reveal'; seat: number; cards: number[] }
  | { type: 'nextWait'; waiting: number[] }
  /** 自己托管/超时代打时的决策依据（只发给本人） */
  | { type: 'decision'; seat: number; d: DecisionLog }
  /** 暂停/继续（只有房间里只有一个真人时才允许） */
  | { type: 'pause'; on: boolean }
  | ({ type: 'chat' } & ChatMsg);

/** 断线重连时的完整状态 */
export interface Snapshot {
  seat: number;
  players: PlayerInfo[];
  level: number;
  levels: [number, number];
  levelTeam: number;
  phase: Phase;
  myHand: number[];
  reveal: { seat: number; cards: number[] } | null;
  counts: number[];
  lastPlay: { seat: number; combo: Combo } | null;
  turn: number;
  finishOrder: number[];
  pendingReturns: { from: number; to: number }[];
  deadlines: { seat: number; left: number }[];
  auto: boolean[];
  online: boolean[];
  result: RoundResult | null;
  /** 是否处于暂停 */
  paused?: boolean;
}

export type ClientMsg =
  | { t: 'hello'; token: string; name: string; voice?: Voice }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'sit'; seat: number }
  | { t: 'ready'; on: boolean }
  | { t: 'addAI'; seat: number }
  | { t: 'removeAI'; seat: number }
  | { t: 'start' }
  | { t: 'play'; cards: number[]; type?: ComboType }
  | { t: 'pass' }
  | { t: 'return'; card: number }
  | { t: 'auto'; on: boolean }
  /** 暂停/继续（房间里只有一个真人时才允许） */
  | { t: 'pause'; on: boolean }
  | { t: 'next' }
  | { t: 'chat'; kind: ChatKind; id: number; to?: number }
  /** 请求 Jev 出牌建议；ctx 由客户端按自己的视角整理（见 shared/advisor.ts 的 buildJevContext） */
  | { t: 'advise'; id: number; ctx: unknown }
  | { t: 'ping' };

export type ServerMsg =
  /** room: 断线重连时所在的房间号 */
  | { t: 'welcome'; room: string | null }
  | { t: 'room'; room: RoomInfo; seat: number }
  | { t: 'left' }
  /** jev：服务端是否已配置 Jev 出牌建议 */
  | { t: 'start'; seat: number; players: PlayerInfo[]; jev?: boolean }
  | { t: 'snapshot'; s: Snapshot }
  | { t: 'ev'; e: NetEvent }
  | { t: 'error'; msg: string }
  /** Jev 建议：ranking 为候选 id 按推荐程度排序；未配置、超时或出错时为 null */
  | { t: 'advice'; id: number; ranking: string[] | null; confidence?: number; error?: string }
  | { t: 'pong' };
