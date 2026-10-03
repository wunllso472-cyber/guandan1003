import { Container, Sprite, FederatedPointerEvent, Point } from 'pixi.js';
import { isWild } from '@shared/cards';
import { CARD_W, CARD_H, cardTexture, wildBadgeTexture, shadowTexture, SHADOW_PAD } from '../gfx/textures';
import { sound } from '../audio/Sound';
import { tween, ease } from '../gfx/tween';
import { arrangeByRank, arrangeSmart, groupSelected, insertCards, removeCards, type ArrangeMode } from '../game/arrange';

const SELECT_TINT = 0x9ec2ff;
/** 手牌放大倍数 */
export const HAND_SCALE = 1.14;
const HW = CARD_W * HAND_SCALE;
const HH = CARD_H * HAND_SCALE;

export class CardSprite extends Container {
  face: Sprite;
  badge: Sprite;
  constructor(public id: number) {
    super();
    const shadow = new Sprite(shadowTexture());
    shadow.width = CARD_W + SHADOW_PAD * 2;
    shadow.height = CARD_H + SHADOW_PAD * 2;
    shadow.position.set(-SHADOW_PAD - 4, -SHADOW_PAD - 3);
    this.addChild(shadow);
    this.face = new Sprite(cardTexture(id));
    this.face.width = CARD_W;
    this.face.height = CARD_H;
    this.badge = new Sprite(wildBadgeTexture());
    this.badge.anchor.set(0.5);
    this.badge.position.set(52, 20);
    this.badge.scale.set(0.9);
    this.badge.visible = false;
    this.addChild(this.face, this.badge);
  }
  setWild(level: number) { this.badge.visible = isWild(this.id, level); }
  set selected(v: boolean) { this.face.tint = v ? SELECT_TINT : 0xffffff; }
}

export interface HandArea { left: number; right: number; bottom: number; maxStack: number }

export class HandView extends Container {
  cols: number[][] = [];
  mode: ArrangeMode = 'smart';
  selected = new Set<number>();
  sprites = new Map<number, CardSprite>();
  level = 2;
  area: HandArea = { left: 0, right: 1280, bottom: 740, maxStack: 330 };
  enabled = true;
  onChange?: () => void;
  /** 智能补全：没有选牌时点一张牌，返回要一起选中的牌（不需要时返回 null） */
  autoPick?: (id: number) => number[] | null;

  private swipe: { visited: Set<number>; to: boolean } | null = null;
  /** 上一次点击，用于识别双击；colWasFull 记录第一次点击前整列是否已全部选中 */
  private lastTap: { id: number; t: number; colWasFull: boolean } | null = null;
  private static readonly DOUBLE_TAP_MS = 320;

  constructor() {
    super();
    this.sortableChildren = true;
  }

  /** 由场景在舞台上注册全局移动/抬起事件 */
  bindStage(stage: Container) {
    stage.on('globalpointermove', (e: FederatedPointerEvent) => this.onMove(e));
    stage.on('pointerup', () => (this.swipe = null));
    stage.on('pointerupoutside', () => (this.swipe = null));
  }

  hand(): number[] { return this.cols.flat(); }

  setHand(hand: number[], level: number, deal = false) {
    this.level = level;
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.selected.clear();
    this.cols = this.mode === 'smart' ? arrangeSmart(hand, level) : arrangeByRank(hand, level);
    for (const id of hand) this.makeSprite(id);
    if (deal) {
      const cx = (this.area.left + this.area.right) / 2 - HW / 2;
      this.layout(false);
      const order = [...this.sprites.values()].sort(() => Math.random() - 0.5);
      order.forEach((s, i) => {
        const tx = s.x, ty = s.y;
        s.position.set(cx, this.area.bottom - 420);
        s.alpha = 0;
        s.scale.set(0.6);
        tween(s, { x: tx, y: ty, alpha: 1, scale: HAND_SCALE }, 260, { delay: i * 45, ease: ease.outCubic });
        if (i % 3 === 0) setTimeout(() => sound.play('deal'), i * 45);
      });
    } else this.layout(false);
    this.onChange?.();
  }

  private makeSprite(id: number) {
    const s = new CardSprite(id);
    s.scale.set(HAND_SCALE);
    s.setWild(this.level);
    s.eventMode = 'static';
    s.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (!this.enabled) return;
      this.onTap(id);
    });
    this.sprites.set(id, s);
    this.addChild(s);
    return s;
  }

  private colOf(id: number): number[] | undefined {
    return this.cols.find((c) => c.includes(id));
  }

  private onTap(id: number) {
    const now = performance.now();
    const col = this.colOf(id) ?? [id];
    // 双击：选中或取消整列
    if (this.lastTap && this.lastTap.id === id && now - this.lastTap.t < HandView.DOUBLE_TAP_MS) {
      const to = !this.lastTap.colWasFull;
      this.lastTap = null;
      this.swipe = null;
      for (const x of col) this.setSelected(x, to);
      sound.play('select');
      this.onChange?.();
      return;
    }
    this.lastTap = { id, t: now, colWasFull: col.every((x) => this.selected.has(x)) };
    // 跟牌时智能补全：没有选牌时，自动选中包含这张牌、刚好能压过上家的一组
    if (this.selected.size === 0 && this.autoPick) {
      const ids = this.autoPick(id);
      if (ids && ids.length > 1) {
        this.select(ids);
        this.swipe = { visited: new Set(ids), to: true };
        sound.play('select');
        return;
      }
    }
    const to = !this.selected.has(id);
    this.swipe = { visited: new Set([id]), to };
    this.setSelected(id, to);
    sound.play('select');
    this.onChange?.();
  }

  private onMove(e: FederatedPointerEvent) {
    if (!this.swipe) return;
    const p = this.toLocal(e.global, undefined, new Point());
    const id = this.hit(p.x, p.y);
    if (id === null || this.swipe.visited.has(id)) return;
    this.swipe.visited.add(id);
    this.setSelected(id, this.swipe.to);
    sound.play('select');
    this.onChange?.();
  }

  /** 找到点下最上层的牌 */
  private hit(x: number, y: number): number | null {
    const list = [...this.sprites.values()].sort((a, b) => b.zIndex - a.zIndex);
    for (const s of list) {
      const by = s.y; // 选中不改变位置
      if (x >= s.x && x <= s.x + HW && y >= by && y <= by + HH) return s.id;
    }
    return null;
  }

  private setSelected(id: number, v: boolean) {
    if (v) this.selected.add(id); else this.selected.delete(id);
    const s = this.sprites.get(id);
    if (s) s.selected = v;
  }

  clearSelection() {
    for (const id of [...this.selected]) this.setSelected(id, false);
    this.onChange?.();
  }

  select(ids: number[]) {
    for (const id of [...this.selected]) this.setSelected(id, false);
    for (const id of ids) this.setSelected(id, true);
    this.onChange?.();
  }

  /** 理牌按钮：有选中的牌则单独成列，否则在按点数/智能理牌间切换。 */
  sortAction(): string {
    const hand = this.hand();
    if (this.selected.size) {
      this.cols = groupSelected(this.cols, [...this.selected], this.level);
      this.clearSelection();
      this.layout(true);
      return '已将选中的牌放在一起';
    }
    this.mode = this.mode === 'rank' ? 'smart' : 'rank';
    this.cols = this.mode === 'smart' ? arrangeSmart(hand, this.level) : arrangeByRank(hand, this.level);
    this.layout(true);
    return this.mode === 'smart' ? '已按牌型理牌' : '已按点数排列';
  }

  /** 移除牌，返回它们移除前的全局位置（用于出牌飞行动画）。 */
  removeCards(ids: number[]): Map<number, Point> {
    const pos = new Map<number, Point>();
    for (const id of ids) {
      const s = this.sprites.get(id);
      if (!s) continue;
      pos.set(id, s.getGlobalPosition(new Point()));
      s.destroy();
      this.sprites.delete(id);
      this.selected.delete(id);
    }
    this.cols = removeCards(this.cols, ids);
    this.layout(true);
    this.onChange?.();
    return pos;
  }

  /** 收到贡牌/还贡：按牌型模式时整手重新理牌，否则插到同点数的列；新牌高亮选中 */
  addCards(ids: number[]) {
    this.cols = this.mode === 'smart'
      ? arrangeSmart([...this.hand(), ...ids], this.level)
      : insertCards(this.cols, ids, this.level);
    for (const id of ids) {
      const s = this.makeSprite(id);
      s.position.set((this.area.left + this.area.right) / 2, this.area.bottom - 400);
      s.alpha = 0;
    }
    this.layout(true);
    for (const id of ids) {
      const s = this.sprites.get(id)!;
      tween(s, { alpha: 1 }, 300);
      this.setSelected(id, true);
    }
    this.onChange?.();
  }

  layout(animate: boolean) {
    const { left, right, bottom, maxStack } = this.area;
    const C = this.cols.length;
    if (!C) return;
    const avail = right - left;
    const spacing = C > 1 ? Math.min(HW * 0.66, (avail - HW) / (C - 1)) : 0;
    const total = spacing * (C - 1) + HW;
    const x0 = left + (avail - total) / 2;
    const maxLen = Math.max(...this.cols.map((c) => c.length));
    const vo = maxLen > 1 ? Math.min(46, (maxStack - HH) / (maxLen - 1)) : 0;
    this.cols.forEach((col, ci) => {
      col.forEach((id, i) => {
        const s = this.sprites.get(id);
        if (!s) return;
        const x = x0 + ci * spacing;
        const y = bottom - HH - (col.length - 1 - i) * vo;
        s.zIndex = ci * 20 + i;
        if (animate) tween(s, { x, y }, 220);
        else s.position.set(x, y);
      });
    });
  }
}
