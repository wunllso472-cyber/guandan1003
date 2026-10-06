// 聊天互动：聊天面板（快捷语/表情）、道具选择、气泡；道具飞行和命中特效见 PropFx.ts。
import { Container, Graphics, Sprite, Text, Point } from 'pixi.js';
import { PropFx } from './PropFx';
import { PHRASES, EMOJI_NAMES, PROPS, type ChatMsg } from '@shared/chat';
import { FONT_UI } from '../gfx/textures';
import { emojiTexture, propTexture } from '../gfx/emoji';
import { tween, ease, wait } from '../gfx/tween';
import { sound } from '../audio/Sound';
import type { Effects } from './Effects';
import type { GameClient } from '../game/types';

export interface ChatHost {
  client: GameClient;
  fx: Effects;
  /** 座位头像中心（本层坐标） */
  seatPos(seat: number): Point;
  /** 座位相对自己的方位：0 下 1 右 2 上 3 左 */
  rel(seat: number): number;
  toast(text: string): void;
  shakeHud(seat: number): void;
}

export class ChatLayer extends Container {
  private panel = new Container();
  private picker = new Container();
  /** 道具特效（在气泡之上、面板之下） */
  private props: PropFx;
  private bubbles = new Map<number, Container>();
  private tab: 'phrase' | 'dialect' | 'emoji' = 'phrase';
  private DW = 1280;
  private DH = 750;

  constructor(private host: ChatHost) {
    super();
    this.props = new PropFx({
      seatPos: (s) => host.seatPos(s), shakeHud: (s) => host.shakeHud(s), shake: (st, ms) => host.fx.shake(st, ms),
      bounds: () => ({ w: this.DW, h: this.DH }),
    });
    this.addChild(this.props, this.panel, this.picker);
    this.panel.visible = false;
    this.picker.visible = false;
    // 面板内的按下事件不能冒泡到牌桌：牌桌按下时会关闭面板，导致点击（按下+抬起）无法完成
    for (const c of [this.panel, this.picker]) {
      c.eventMode = 'static';
      c.on('pointerdown', (e) => e.stopPropagation());
    }
  }

  layout(DW: number, DH: number) {
    this.DW = DW; this.DH = DH;
    if (this.panel.visible) this.openPanel();
    this.picker.visible = false;
  }

  get isOpen() { return this.panel.visible || this.picker.visible; }

  closeAll() {
    this.panel.visible = false;
    this.picker.visible = false;
  }

  // ---------- 聊天面板 ----------

  togglePanel() {
    if (this.panel.visible) { this.panel.visible = false; return; }
    this.picker.visible = false;
    this.openPanel();
  }

  private lastSent = 0;

  private send(kind: ChatMsg['kind'], id: number, to?: number) {
    if (Date.now() - this.lastSent < 1500) { this.host.toast('发送太频繁了'); return; }
    this.lastSent = Date.now();
    const err = this.host.client.chat(kind, id, to);
    if (err) this.host.toast(err);
    this.closeAll();
  }

  private openPanel() {
    const p = this.panel;
    p.removeChildren().forEach((c) => c.destroy({ children: true }));
    p.visible = true;
    // 普通话快捷语有 12 条，面板加高加宽；放不下时贴着屏幕顶部
    const W = 500, H = 580;
    p.position.set(this.DW - W - 150, Math.max(12, this.DH - H - 100));
    const bg = new Graphics()
      .roundRect(0, 0, W, H, 18).fill({ color: 0x1a120a, alpha: 0.88 }).stroke({ color: 0xf5c34a, alpha: 0.7, width: 2 });
    bg.eventMode = 'static';
    p.addChild(bg);
    // 页签
    const TABS = [['phrase', '快捷语'], ['dialect', '方言'], ['emoji', '表情']] as const;
    TABS.forEach(([t, label], i) => {
      const active = this.tab === t;
      const tb = new Container();
      const g = new Graphics().roundRect(0, 0, 120, 40, 20).fill({ color: active ? 0xf0a020 : 0x3a2a18 });
      const tx = new Text({ text: label, style: { fontFamily: FONT_UI, fontSize: 20, fontWeight: '900', fill: active ? 0xffffff : 0xd8c8a8 } });
      tx.anchor.set(0.5); tx.position.set(60, 20);
      tb.addChild(g, tx);
      tb.position.set(16 + i * 130, 14);
      tb.eventMode = 'static'; tb.cursor = 'pointer';
      tb.on('pointertap', (e) => { e.stopPropagation(); this.tab = t; this.openPanel(); });
      p.addChild(tb);
    });
    const close = new Text({ text: '✕', style: { fontFamily: FONT_UI, fontSize: 26, fill: 0xd8c8a8 } });
    close.anchor.set(0.5); close.position.set(W - 26, 34);
    close.eventMode = 'static'; close.cursor = 'pointer';
    close.on('pointertap', (e) => { e.stopPropagation(); this.closeAll(); });
    p.addChild(close);

    if (this.tab !== 'emoji') {
      // 编号是 PHRASES 的下标；普通话一页，东北话和粤语一页
      const list = PHRASES.map((ph, id) => ({ ...ph, id })).filter((ph) => (this.tab === 'phrase' ? ph.lang === 'zh' : ph.lang !== 'zh'));
      list.forEach((ph, i) => {
        const row = new Container();
        const g = new Graphics().roundRect(0, 0, W - 32, 38, 10).fill({ color: 0xffffff, alpha: i % 2 ? 0.04 : 0.09 });
        const tag = ph.lang === 'ne' ? '东北话' : ph.lang === 'yue' ? '粤语' : '';
        const tx = new Text({ text: ph.text, style: { fontFamily: FONT_UI, fontSize: 19, fill: 0xfff4dc } });
        tx.position.set(14, 8);
        row.addChild(g, tx);
        if (tag) {
          const tt = new Text({ text: tag, style: { fontFamily: FONT_UI, fontSize: 14, fontWeight: '700', fill: 0xf0a020 } });
          tt.anchor.set(1, 0.5);
          tt.position.set(W - 46, 19);
          row.addChild(tt);
        }
        row.position.set(16, 66 + i * 42);
        row.eventMode = 'static'; row.cursor = 'pointer';
        row.on('pointertap', (e) => { e.stopPropagation(); this.send('phrase', ph.id); });
        p.addChild(row);
      });
    } else {
      EMOJI_NAMES.forEach((_, i) => {
        const cell = new Container();
        const g = new Graphics().roundRect(0, 0, 88, 88, 14).fill({ color: 0xffffff, alpha: 0.07 });
        const s = new Sprite(emojiTexture(i));
        s.width = s.height = 72;
        s.position.set(8, 8);
        cell.addChild(g, s);
        cell.position.set(30 + (i % 4) * 112, 72 + Math.floor(i / 4) * 116);
        cell.eventMode = 'static'; cell.cursor = 'pointer';
        cell.on('pointertap', (e) => { e.stopPropagation(); this.send('emoji', i); });
        p.addChild(cell);
      });
    }
  }

  // ---------- 道具选择 ----------

  openPicker(target: number) {
    this.panel.visible = false;
    const p = this.picker;
    p.removeChildren().forEach((c) => c.destroy({ children: true }));
    p.visible = true;
    const n = PROPS.length, cw = n > 6 ? 74 : 82;
    const W = n * cw + 20, H = 110;
    const pos = this.host.seatPos(target);
    const rel = this.host.rel(target);
    let x = pos.x - W / 2, y = pos.y + 70;
    if (rel === 1) { x = pos.x - W - 70; y = pos.y - H / 2; }
    if (rel === 3) { x = pos.x + 70; y = pos.y - H / 2; }
    x = Math.max(10, Math.min(this.DW - W - 10, x));
    y = Math.max(10, Math.min(this.DH - H - 10, y));
    p.position.set(x, y);
    const bg = new Graphics().roundRect(0, 0, W, H, 16).fill({ color: 0x1a120a, alpha: 0.88 }).stroke({ color: 0xf5c34a, alpha: 0.7, width: 2 });
    bg.eventMode = 'static';
    p.addChild(bg);
    PROPS.forEach((prop, i) => {
      const cell = new Container();
      const s = new Sprite(propTexture(prop.key));
      s.anchor.set(0.5);
      s.width = s.height = cw > 80 ? 58 : 54;
      s.position.set(cw / 2, 40);
      const t = new Text({ text: prop.name, style: { fontFamily: FONT_UI, fontSize: prop.name.length > 3 ? 13 : 16, fill: 0xfff4dc, fontWeight: '700' } });
      t.anchor.set(0.5); t.position.set(cw / 2, 88);
      cell.addChild(s, t);
      cell.position.set(10 + i * cw, 0);
      cell.eventMode = 'static'; cell.cursor = 'pointer';
      cell.on('pointertap', (e) => { e.stopPropagation(); this.send('prop', i, target); });
      p.addChild(cell);
    });
  }

  // ---------- 收到消息 ----------

  onChat(m: ChatMsg) {
    const voice = this.host.client.players[m.seat]?.voice ?? 'male';
    if (m.kind === 'phrase') {
      sound.say(voice, PHRASES[m.id].key, 1);
      this.bubble(m.seat, PHRASES[m.id].text);
    } else if (m.kind === 'emoji') {
      sound.play('chat');
      this.bubble(m.seat, null, m.id);
    } else if (m.to !== undefined) {
      void this.props.play(m.seat, m.to, PROPS[m.id].key);
    }
  }

  private bubble(seat: number, text: string | null, emoji?: number) {
    this.bubbles.get(seat)?.destroy({ children: true });
    const b = new Container();
    const rel = this.host.rel(seat);
    const pos = this.host.seatPos(seat);
    let content: Container;
    let w: number, h: number;
    if (text !== null) {
      const t = new Text({ text, style: { fontFamily: FONT_UI, fontSize: 22, fontWeight: '700', fill: 0x3b1f08, wordWrap: true, wordWrapWidth: 300, breakWords: true } });
      w = t.width + 32; h = t.height + 22;
      t.position.set(16, 11);
      content = t;
    } else {
      const s = new Sprite(emojiTexture(emoji!));
      s.width = s.height = 84;
      s.anchor.set(0.5);
      s.position.set(56, 52);
      w = 112; h = 104;
      content = s;
      void tween(s, { scale: s.scale.x * 1.15 }, 200, { ease: ease.outBack })
        .then(() => tween(s, { scale: s.scale.x / 1.15 }, 200))
        .then(() => tween(s, { rotation: 0.15 }, 150)).then(() => tween(s, { rotation: -0.15 }, 150)).then(() => tween(s, { rotation: 0 }, 150));
    }
    // 气泡朝向：左侧座位向右、右侧座位向左，上下座位向右偏
    const toLeft = rel === 1;
    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 14).fill({ color: 0xfffaf0 }).stroke({ color: 0xc99a52, width: 2 });
    const tailX = toLeft ? w - 20 : 20;
    const tailY = rel === 2 ? 0 : h;
    const dir = rel === 2 ? -1 : 1;
    bg.poly([tailX - 9, tailY, tailX + 9, tailY, tailX + (toLeft ? 12 : -12), tailY + 14 * dir]).fill({ color: 0xfffaf0 });
    b.addChild(bg, content);
    let x: number, y: number;
    if (rel === 0) { x = pos.x + 40; y = pos.y - h - 56; }
    else if (rel === 1) { x = pos.x - w - 20; y = pos.y - h - 46; }
    else if (rel === 2) { x = pos.x + 60; y = pos.y + 60; }
    else { x = pos.x + 20; y = pos.y - h - 46; }
    b.position.set(Math.max(8, Math.min(this.DW - w - 8, x)), Math.max(8, y));
    b.alpha = 0;
    b.eventMode = 'none';
    this.addChildAt(b, 0);
    this.bubbles.set(seat, b);
    void tween(b, { alpha: 1 }, 160)
      .then(() => wait(3000))
      .then(() => { if (!b.destroyed) return tween(b, { alpha: 0 }, 300); })
      .then(() => { if (!b.destroyed) b.destroy({ children: true }); if (this.bubbles.get(seat) === b) this.bubbles.delete(seat); });
  }
}
