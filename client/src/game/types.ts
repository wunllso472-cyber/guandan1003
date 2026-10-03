// 视图层依赖的接口：单机（LocalGame）和联机（NetGame）各自实现。
import type { Combo } from '@shared/combo';
import type { Phase } from '@shared/game';
import type { TableEvent } from '@shared/table';
import type { PlayerInfo } from '@shared/protocol';
import type { ChatKind } from '@shared/chat';

export { TURN_SECONDS } from '@shared/table';
export type { PlayerInfo };

/** 视图读取的对局状态（单机是真实引擎，联机是本地镜像） */
export interface GameStateView {
  readonly level: number;
  readonly levels: [number, number];
  readonly levelTeam: number;
  readonly phase: Phase;
  /** 只有自己（以及出完后的对家）的手牌是已知的 */
  readonly hands: number[][];
  readonly lastPlay: { seat: number; combo: Combo } | null;
  readonly turn: number;
  readonly finishOrder: number[];
  readonly pendingReturns: { from: number; to: number }[];
  isActive(seat: number): boolean;
  handCounts(): number[];
}

export type ClientEvent =
  | TableEvent
  | { type: 'presence'; seat: number; online: boolean }
  | { type: 'reveal'; seat: number; cards: number[] }
  | { type: 'nextWait'; waiting: number[] }
  | { type: 'error'; msg: string }
  /** 重连后状态整体刷新 */
  | { type: 'sync' };

export interface GameClient {
  readonly mySeat: number;
  readonly players: PlayerInfo[];
  readonly game: GameStateView;
  /** 单机可以重新开始；联机不行 */
  readonly canRestart: boolean;
  on(fn: (e: ClientEvent) => void): void;
  play(cards: number[], combo?: Combo): string | null;
  pass(): string | null;
  returnTribute(cardId: number): string | null;
  setAuto(on: boolean): void;
  isAuto(seat: number): boolean;
  isOnline(seat: number): boolean;
  hints(): Combo[];
  chat(kind: ChatKind, id: number, to?: number): string | null;
  nextRound(): void;
  restart(): void;
  dispose(): void;
}
