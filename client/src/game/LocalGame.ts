// 单机对局：在浏览器内运行牌桌控制器，座位 0 是玩家，其余是 AI。
import { Table } from '@shared/table';
import type { Combo } from '@shared/combo';
import type { ChatKind } from '@shared/chat';
import type { Voice } from '@shared/protocol';
import type { ClientEvent, GameClient, PlayerInfo } from './types';

const AI_NAMES = ['阿强', '小美', '老王', '二丫', '大刘', '阿珍', '胖虎', '小雪', '铁柱', '翠花'];

export class LocalGame implements GameClient {
  readonly mySeat = 0;
  readonly canRestart = true;
  readonly players: PlayerInfo[];
  private table = new Table([false, true, true, true]);
  private listeners: ((e: ClientEvent) => void)[] = [];

  constructor(name: string, voice: Voice) {
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5);
    this.players = [
      { name, avatar: 0, isAI: false, voice },
      { name: names[0], avatar: 1, isAI: true, voice: 'female' },
      { name: names[1], avatar: 2, isAI: true, voice: 'male' },
      { name: names[2], avatar: 3, isAI: true, voice: 'female' },
    ];
    this.table.on((e) => { for (const fn of this.listeners) fn(e); });
  }

  get game() { return this.table.game; }

  /** 调试用：时间倍率 */
  set speed(v: number) { this.table.speed = v; }

  on(fn: (e: ClientEvent) => void) { this.listeners.push(fn); }
  start() { this.table.start(); }
  restart() { this.table.start(); }
  nextRound() { this.table.nextRound(); }
  dispose() { this.table.dispose(); }
  isAuto(seat: number) { return this.table.auto[seat]; }
  isOnline() { return true; }
  setAuto(on: boolean) { this.table.setAuto(this.mySeat, on); }
  chat(kind: ChatKind, id: number, to?: number) { return this.table.chat(this.mySeat, kind, id, to); }
  play(cards: number[], combo?: Combo) { return this.table.play(this.mySeat, cards, combo); }
  pass() { return this.table.pass(this.mySeat); }
  returnTribute(cardId: number) { return this.table.returnTribute(this.mySeat, cardId); }
}
