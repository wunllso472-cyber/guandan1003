import { Container, Sprite, FederatedPointerEvent, Point } from 'pixi.js';
import { card, isWild, sortByValueDesc, type Suit } from '@shared/cards';
import { resolvePlay, type Combo } from '@shared/combo';
import { findAllPlays } from '@shared/finder';
import { CARD_W, CARD_H, cardTexture, wildBadgeTexture, shadowTexture, lockTexture, comboTagTexture, SHADOW_PAD } from '../gfx/textures';
import { sound } from '../audio/Sound';
import { tween, ease, killTweenProps } from '../gfx/tween';
import { arrangeByRank, arrangeSmart, removeCards } from '../game/arrange';

const SELECT_TINT = 0xc4dcff;
/** 选中的牌上抬的高度 */
const LIFT = 20;
/** 按住多久进入拖动整列 */
const HOLD_MS = 380;
/** 按住期间手指移动超过这个距离就算滑动选牌，不再进入拖动 */
const HOLD_SLOP = 12;
/** 手牌放大倍数 */
export const HAND_SCALE = 1;
const HW = CARD_W * HAND_SCALE;
const HH = CARD_H * HAND_SCALE;

export const SF_SUITS: Suit[] = ['S', 'H', 'C', 'D'];

const CN_NUM = ['', '', '', '', '四', '五', '六', '七', '八', '九', '十'];

/** 一列牌显示在底下的牌型标签：锁定的列（理牌组成的一手）显示任意牌型，自动理牌只标炸弹 */
function tagFor(col: number[], level: number, locked: boolean, smart: boolean): string | null {
  if (!locked && !smart) return null;
  const c: Combo | undefined = resolvePlay(col, level, null)[0];
  if (!c) return null;
  if (c.type === 'bomb') return `${CN_NUM[c.cards.length] ?? c.cards.length}炸`;
  if (c.type === 'straightflush') return '同花顺';
  if (c.type === 'jokerbomb') return '天王炸';
  if (!locked) return null;
  return ({ single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二', straight: '顺子', tube: '连对', plate: '钢板' } as Record<string, string>)[c.type] ?? null;
}

export class CardSprite extends Container {
  face: Sprite;
  badge: Sprite;
  lock: Sprite;
  tag: Sprite | null = null;
  /** 排版位置（未上抬时的 y） */
  baseY = 0;
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
    this.lock = new Sprite(lockTexture());
    this.lock.anchor.set(0.5);
    this.lock.position.set(72, 19);
    this.lock.scale.set(0.5);
    this.lock.visible = false;
    this.addChild(this.face, this.badge, this.lock);
  }
  setWild(level: number) { this.badge.visible = isWild(this.id, level); }
  set selected(v: boolean) { this.face.tint = v ? SELECT_TINT : 0xffffff; }
  setTag(text: string | null) {
    if (this.tag) { this.tag.destroy(); this.tag = null; }
    if (!text) return;
    const t = comboTagTexture(text);
    this.tag = new Sprite(t);
    this.tag.scale.set(0.5);
    this.tag.position.set(5, CARD_H - 7 - t.height * 0.5);
    this.addChild(this.tag);
  }
}

export interface HandArea { left: number; right: number; bottom: number; maxStack: number }

export class HandView extends Container {
  cols: number[][] = [];
  selected = new Set<number>();
  sprites = new Map<number, CardSprite>();
  level = 2;
  area: HandArea = { left: 0, right: 1280, bottom: 740, maxStack: 330 };
  enabled = true;
  onChange?: () => void;
  /** 智能补全：没有选牌时点一张牌，返回要一起选中的牌（不需要时返回 null） */
  autoPick?: (id: number) => number[] | null;
  /** 理牌锁定成一手的列：牌 → 组号 */
  private lockGroup = new Map<number, number>();
  private nextGroup = 1;
  /** 未锁定的牌当前怎么排：发牌时按点数，一键理后按牌型 */
  private mode: 'rank' | 'smart' = 'rank';
  /** 理牌或一键理生效过（理牌按钮变成“恢复”） */
  arranged = false;

  private swipe: { visited: Set<number>; to: boolean } | null = null;
  /** 上一次点击，用于识别双击；colWasFull 记录第一次点击前整列是否已全部选中 */
  private lastTap: { id: number; t: number; colWasFull: boolean } | null = null;
  private static readonly DOUBLE_TAP_MS = 320;
  /** 按住一张牌：到时间没移动就进入拖动整列；snapshot 是按下前的选择，进入拖动时恢复 */
  private press: { id: number; x: number; y: number; snapshot: Set<number>; timer: ReturnType<typeof setTimeout> } | null = null;
  /** 正在拖动的列 */
  private drag: { col: number[]; startX: number; dx: number } | null = null;
  /** 最近一次排版的列位置 */
  private slots = { x0: 0, spacing: 0 };
  private sfCache: { key: string; bySuit: Map<Suit, number[][]> } | null = null;

  constructor() {
    super();
    this.sortableChildren = true;
  }

  /** 由场景在舞台上注册全局移动/抬起事件 */
  bindStage(stage: Container) {
    stage.on('globalpointermove', (e: FederatedPointerEvent) => this.onMove(e));
    stage.on('pointerup', () => this.onUp());
    stage.on('pointerupoutside', () => this.onUp());
  }

  hand(): number[] { return this.cols.flat(); }

  private isLocked(col: number[]) { return col.length > 0 && this.lockGroup.has(col[0]); }

  /** 锁定的列保持原样放在右边，其余牌按当前方式重新排 */
  private rebuild(extra: number[] = []) {
    const locked = this.cols.filter((c) => this.isLocked(c));
    const loose = [...this.cols.filter((c) => !this.isLocked(c)).flat(), ...extra];
    const arranged = this.mode === 'smart' ? arrangeSmart(loose, this.level) : arrangeByRank(loose, this.level);
    this.cols = [...arranged, ...locked];
  }

  setHand(hand: number[], level: number, deal = false) {
    this.level = level;
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.selected.clear();
    this.cancelPress();
    this.drag = null;
    this.lockGroup.clear();
    this.mode = 'rank';
    this.arranged = false;
    this.cols = arrangeByRank(hand, level);
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
      const snapshot = new Set(this.selected);
      this.cancelPress();
      this.press = { id, x: e.global.x, y: e.global.y, snapshot, timer: setTimeout(() => this.startDrag(), HOLD_MS) };
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
    if (this.drag) {
      this.drag.dx = this.toLocal(e.global, undefined, new Point()).x - this.drag.startX;
      const ci = this.cols.indexOf(this.drag.col);
      for (const id of this.drag.col) {
        const s = this.sprites.get(id);
        if (s) { killTweenProps(s, ['x']); s.x = this.slots.x0 + ci * this.slots.spacing + this.drag.dx; }
      }
      return;
    }
    if (this.press && Math.hypot(e.global.x - this.press.x, e.global.y - this.press.y) > HOLD_SLOP) this.cancelPress();
    if (!this.swipe) return;
    const p = this.toLocal(e.global, undefined, new Point());
    const id = this.hit(p.x, p.y);
    if (id === null || this.swipe.visited.has(id)) return;
    this.swipe.visited.add(id);
    this.setSelected(id, this.swipe.to);
    sound.play('select');
    this.onChange?.();
  }

  private cancelPress() {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }

  /** 按住不动：撤销这次点击造成的选牌，整列跟着手指左右移动 */
  private startDrag() {
    const p = this.press;
    this.press = null;
    if (!p || !this.enabled) return;
    const col = this.colOf(p.id);
    if (!col) return;
    for (const id of [...this.selected]) if (!p.snapshot.has(id)) this.setSelected(id, false);
    for (const id of p.snapshot) if (!this.selected.has(id)) this.setSelected(id, true);
    this.swipe = null;
    this.lastTap = null;
    const local = this.toLocal(new Point(p.x, p.y), undefined, new Point());
    this.drag = { col, startX: local.x, dx: 0 };
    for (const id of col) {
      const s = this.sprites.get(id);
      if (!s) continue;
      s.zIndex += 1000;
      s.alpha = 0.85;
      tween(s, { y: s.baseY - LIFT - 10 }, 120);
    }
    sound.play('select');
    this.onChange?.();
  }

  private onUp() {
    this.swipe = null;
    this.cancelPress();
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const from = this.cols.indexOf(d.col);
    if (from >= 0 && this.slots.spacing > 0) {
      const to = Math.max(0, Math.min(this.cols.length - 1, Math.round(from + d.dx / this.slots.spacing)));
      this.cols.splice(from, 1);
      this.cols.splice(to, 0, d.col);
    }
    for (const id of d.col) { const s = this.sprites.get(id); if (s) s.alpha = 1; }
    this.layout(true);
  }

  /** 找到点下最上层的牌（按当前位置算，上抬的牌按上抬后的位置） */
  private hit(x: number, y: number): number | null {
    const list = [...this.sprites.values()].sort((a, b) => b.zIndex - a.zIndex);
    for (const s of list) {
      if (x >= s.x && x <= s.x + HW && y >= s.y && y <= s.y + HH) return s.id;
    }
    return null;
  }

  private setSelected(id: number, v: boolean) {
    if (v) this.selected.add(id); else this.selected.delete(id);
    const s = this.sprites.get(id);
    if (!s) return;
    s.selected = v;
    if (!this.drag?.col.includes(id)) tween(s, { y: s.baseY - (v ? LIFT : 0) }, 110);
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

  /** 把这些牌锁定成一手，放在最右边 */
  private lockCards(ids: number[]) {
    const g = this.nextGroup++;
    const set = new Set(ids);
    // 一列里按规则引擎识别出的顺序摆（逢人配在它替代的位置）；三带二对子在上、三张在下
    const combo = resolvePlay(ids, this.level, null)[0];
    let order = combo ? [...combo.cards] : sortByValueDesc(ids, this.level).reverse();
    if (combo?.type === 'fullhouse') order = [...order.slice(3), ...order.slice(0, 3)];
    for (const id of ids) this.lockGroup.set(id, g);
    this.cols = [...this.cols.map((c) => c.filter((id) => !set.has(id))).filter((c) => c.length), order];
    this.normalizeLocks();
  }

  /** 锁定列被拆开（出牌、被选去组别的牌）后剩下的牌不再锁定，并回到普通牌里重排 */
  private normalizeLocks() {
    let changed = false;
    for (const col of this.cols) {
      const gids = new Set(col.map((id) => this.lockGroup.get(id)));
      if (gids.size === 1 && !gids.has(undefined)) continue;
      for (const id of col) if (this.lockGroup.delete(id)) changed = true;
    }
    if (changed) this.rebuild();
  }

  /** 理牌按钮：把选中的牌锁定成一手 */
  groupAction(): string {
    if (!this.selected.size) return '先选中要组成一手的牌，再点理牌';
    const ids = [...this.selected];
    this.lockCards(ids);
    this.arranged = true;
    this.clearSelection();
    this.layout(true);
    const tag = tagFor(ids, this.level, true, false);
    return tag ? `已理成一手：${tag}` : '已将选中的牌放在一起';
  }

  /** 一键理：未锁定的牌按牌型自动整理（炸弹在左并标出几炸），锁定的列不动 */
  smartAction(): string {
    this.mode = 'smart';
    this.rebuild();
    this.arranged = true;
    this.clearSelection();
    this.layout(true);
    return '已一键理牌';
  }

  /** 恢复：去掉所有锁定，回到发牌时的按点数排列 */
  restoreAction(): string {
    this.lockGroup.clear();
    this.mode = 'rank';
    this.rebuild();
    this.arranged = false;
    this.clearSelection();
    this.layout(true);
    return '已恢复';
  }

  /** 未锁定的牌里每个花色能组成的同花顺：用逢人配少的在前，同样的大的在前 */
  straightFlushesBySuit(): Map<Suit, number[][]> {
    const loose = this.cols.filter((c) => !this.isLocked(c)).flat();
    const key = [...loose].sort((a, b) => a - b).join(',') + '|' + this.level;
    if (this.sfCache?.key === key) return this.sfCache.bySuit;
    const wilds = (ids: number[]) => ids.filter((id) => isWild(id, this.level)).length;
    const bySuit = new Map<Suit, number[][]>();
    const list = findAllPlays(loose, this.level)
      .filter((c) => c.type === 'straightflush')
      .sort((a, b) => wilds(a.cards) - wilds(b.cards) || b.value - a.value);
    for (const c of list) {
      const nat = c.cards.find((id) => !isWild(id, this.level)) ?? c.cards[0];
      const suit = card(nat).suit;
      if (!bySuit.has(suit)) bySuit.set(suit, []);
      bySuit.get(suit)!.push(c.cards);
    }
    this.sfCache = { key, bySuit };
    return bySuit;
  }

  /** 点花色：把这个花色的一组同花顺锁定成一手 */
  groupStraightFlush(suit: Suit): string {
    const list = this.straightFlushesBySuit().get(suit);
    if (!list?.length) return '这个花色没有同花顺';
    this.lockCards(list[0]);
    this.arranged = true;
    this.clearSelection();
    this.layout(true);
    sound.play('select');
    return '已组成同花顺';
  }

  /** 移除牌，返回它们移除前的全局位置（用于出牌飞行动画）。 */
  removeCards(ids: number[]): Map<number, Point> {
    const pos = new Map<number, Point>();
    this.cancelPress();
    this.drag = null;
    for (const id of ids) {
      const s = this.sprites.get(id);
      if (!s) continue;
      pos.set(id, s.getGlobalPosition(new Point()));
      s.destroy();
      this.sprites.delete(id);
      this.selected.delete(id);
    }
    this.cols = removeCards(this.cols, ids);
    for (const id of ids) this.lockGroup.delete(id);
    this.normalizeLocks();
    this.layout(true);
    this.onChange?.();
    return pos;
  }

  /** 收到贡牌/还贡：放进未锁定的牌里重新排；新牌高亮选中 */
  addCards(ids: number[]) {
    this.cancelPress();
    this.drag = null;
    this.rebuild(ids);
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
    this.slots = { x0, spacing };
    const maxLen = Math.max(...this.cols.map((c) => c.length));
    const vo = maxLen > 1 ? Math.min(46, (maxStack - HH) / (maxLen - 1)) : 0;
    this.cols.forEach((col, ci) => {
      const locked = this.isLocked(col);
      const tag = tagFor(col, this.level, locked, this.mode === 'smart');
      col.forEach((id, i) => {
        const s = this.sprites.get(id);
        if (!s) return;
        s.lock.visible = locked;
        s.setTag(i === col.length - 1 ? tag : null);
        const x = x0 + ci * spacing;
        s.baseY = bottom - HH - (col.length - 1 - i) * vo;
        const y = s.baseY - (this.selected.has(id) ? LIFT : 0);
        s.zIndex = ci * 20 + i;
        if (animate) tween(s, { x, y }, 220);
        else {
          // 取消还在进行的位置动画（例如发牌时屏幕尺寸变了），否则动画结束后牌会回到旧位置
          killTweenProps(s, ['x', 'y']);
          s.position.set(x, y);
        }
      });
    });
  }
}
