import { Circle, Container, Graphics, Sprite, Text, Ticker, type Point } from 'pixi.js';
import { avatarTexture, backTexture, CARD_W, CARD_H, FONT_UI, cardTexture, wildBadgeTexture, shadowTexture, SHADOW_PAD } from '../gfx/textures';
import { tween, ease } from '../gfx/tween';
import { isWild } from '@shared/cards';
import { TURN_SECONDS } from '../game/types';

const PLACE_NAMES = ['', '头游', '二游', '三游', '末游'];

export class PlayerHud extends Container {
  private ring = new Graphics();
  private glow = new Graphics();
  private timerText: Text;
  private countBox = new Container();
  private countText: Text;
  private placeTag = new Container();
  private placeText: Text;
  private autoTag: Text;
  private offline = new Container();
  private deadline = 0;
  private urgent = false;
  private readonly R = 42;

  constructor(name: string, avatarIdx: number, ally: boolean, showCount: boolean, countSide: 1 | -1 = 1) {
    super();
    const R = this.R;
    const frame = new Graphics()
      .circle(0, 0, R + 5).fill({ color: ally ? 0xf5c34a : 0x5aa8ff })
      .circle(0, 0, R + 2).fill({ color: 0x1b1b1b, alpha: 0.6 });
    const av = new Sprite(avatarTexture(name, avatarIdx));
    av.anchor.set(0.5);
    av.width = av.height = R * 2;
    const nameBg = new Graphics().roundRect(-56, R + 6, 112, 26, 13).fill({ color: 0x000000, alpha: 0.45 });
    const nameText = new Text({ text: name, style: { fontFamily: FONT_UI, fontSize: 18, fill: 0xffffff, fontWeight: '700' } });
    nameText.anchor.set(0.5);
    nameText.position.set(0, R + 19);

    this.timerText = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: 30, fontWeight: '900', fill: 0xffffff, stroke: { color: 0x000000, width: 5 } } });
    this.timerText.anchor.set(0.5);

    // 剩余张数（≤10 张才显示，同腾讯“报牌”）
    const back = new Sprite(backTexture());
    back.width = 34; back.height = 34 * CARD_H / CARD_W;
    back.position.set(-17, -24);
    this.countText = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: 24, fontWeight: '900', fill: 0xffffff, stroke: { color: 0x8a0000, width: 5 } } });
    this.countText.anchor.set(0.5);
    this.countBox.addChild(back, this.countText);
    this.countBox.position.set((R + 34) * countSide, -6);
    this.countBox.visible = false;
    if (!showCount) this.countBox.renderable = false;

    const tagBg = new Graphics().roundRect(-34, -14, 68, 28, 8).fill({ color: 0xd8342a }).stroke({ color: 0xffe08a, width: 2 });
    this.placeText = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: 18, fontWeight: '900', fill: 0xfff2c0 } });
    this.placeText.anchor.set(0.5);
    this.placeTag.addChild(tagBg, this.placeText);
    this.placeTag.position.set(0, -R - 12);
    this.placeTag.visible = false;

    this.autoTag = new Text({ text: '托管', style: { fontFamily: FONT_UI, fontSize: 16, fontWeight: '900', fill: 0xffffff, stroke: { color: 0x2f6fd1, width: 4 } } });
    this.autoTag.anchor.set(0.5);
    this.autoTag.position.set(-R + 6, R - 6);
    this.autoTag.visible = false;

    const offBg = new Graphics().circle(0, 0, R).fill({ color: 0x000000, alpha: 0.55 });
    const offText = new Text({ text: '离线', style: { fontFamily: FONT_UI, fontSize: 20, fontWeight: '900', fill: 0xdddddd } });
    offText.anchor.set(0.5);
    this.offline.addChild(offBg, offText);
    this.offline.visible = false;

    this.addChild(this.glow, frame, av, this.offline, this.ring, this.timerText, nameBg, nameText, this.countBox, this.placeTag, this.autoTag);
    Ticker.shared.add(this.tick, this);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Circle(0, 0, R + 8);
  }

  override destroy() {
    Ticker.shared.remove(this.tick, this);
    super.destroy({ children: true });
  }

  setCount(n: number) {
    this.countBox.visible = n > 0 && n <= 10;
    this.countText.text = String(n);
  }

  setPlace(place: number) {
    this.placeTag.visible = place > 0;
    this.placeText.text = PLACE_NAMES[place] ?? '';
    if (place > 0) {
      this.placeTag.scale.set(2);
      tween(this.placeTag, { scale: 1 }, 400, { ease: ease.outBack });
    }
  }

  setAuto(on: boolean) { this.autoTag.visible = on; }

  setOffline(on: boolean) { this.offline.visible = on; }

  setDeadline(until: number) { this.deadline = until; }

  private tick() {
    const R = this.R;
    this.ring.clear();
    this.glow.clear();
    const left = this.deadline - Date.now();
    if (left <= 0) { if (this.timerText.text) this.timerText.text = ''; return; }
    // 当前出牌人的光晕
    const pulse = 0.35 + 0.25 * Math.sin(Date.now() / 220);
    this.glow.circle(0, 0, R + 16).fill({ color: 0xffe27a, alpha: pulse * 0.5 });
    this.glow.circle(0, 0, R + 10).fill({ color: 0xffe27a, alpha: pulse * 0.6 });
    const frac = Math.min(1, left / (TURN_SECONDS * 1000));
    const color = left < 5000 ? 0xff4a3a : left < 10000 ? 0xffc23a : 0x5cff8a;
    this.ring.arc(0, 0, R + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac).stroke({ color, width: 7, cap: 'round' });
    this.ring.circle(0, 0, R).fill({ color: 0x000000, alpha: 0.35 });
    // 只在变化时更新文字，避免每帧重绘文字贴图
    const sec = String(Math.ceil(left / 1000));
    if (this.timerText.text !== sec) this.timerText.text = sec;
    const urgent = left < 5000;
    if (urgent !== this.urgent) {
      this.urgent = urgent;
      this.timerText.style.fill = urgent ? 0xff6655 : 0xffffff;
    }
  }
}

/** 某个座位打出的牌。align: 牌组锚点（0 左对齐，0.5 居中，1 右对齐） */
export class PlayedView extends Container {
  stale = false;
  private readonly S = 0.58;
  private readonly GAP = 36;

  constructor(public align: number) {
    super();
  }

  clear() {
    this.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.stale = false;
  }

  /** from: 飞入起点（本地坐标），为空则原地淡入 */
  showCards(ids: number[], level: number, from?: Point | null) {
    this.clear();
    const n = ids.length;
    const w = (n - 1) * this.GAP + CARD_W * this.S;
    const x0 = -w * this.align;
    ids.forEach((id, i) => {
      const c = new Container();
      const sh = new Sprite(shadowTexture());
      sh.width = CARD_W + SHADOW_PAD * 2;
      sh.height = CARD_H + SHADOW_PAD * 2;
      sh.position.set(-SHADOW_PAD - 3, -SHADOW_PAD + 2);
      c.addChild(sh);
      const s = new Sprite(cardTexture(id));
      s.width = CARD_W; s.height = CARD_H;
      c.addChild(s);
      if (isWild(id, level)) {
        const b = new Sprite(wildBadgeTexture());
        b.anchor.set(0.5);
        b.position.set(52, 20);
        c.addChild(b);
      }
      const tx = x0 + i * this.GAP, ty = -CARD_H * this.S / 2;
      this.addChild(c);
      if (from) {
        c.position.set(from.x - CARD_W * this.S / 2 + (i - n / 2) * 6, from.y - CARD_H * this.S / 2);
        c.scale.set(this.S * 0.6);
        c.alpha = 0.6;
        tween(c, { x: tx, y: ty, scale: this.S, alpha: 1 }, 260, { delay: i * 12, ease: ease.outCubic });
      } else {
        c.scale.set(this.S);
        c.position.set(tx, ty);
        c.alpha = 0;
        tween(c, { alpha: 1 }, 160, { delay: i * 18 });
      }
    });
  }

  /** 出牌区中心（本地坐标） */
  center(n: number) {
    const w = (n - 1) * this.GAP + CARD_W * this.S;
    return { x: -w * this.align + w / 2, y: 0, w };
  }

  showText(text: string) {
    this.clear();
    const t = new Text({ text, style: { fontFamily: FONT_UI, fontSize: 34, fontWeight: '900', fill: 0xe8eef5, stroke: { color: 0x14301f, width: 6 } } });
    t.anchor.set(this.align, 0.5);
    this.addChild(t);
    this.scale.set(1);
  }
}
