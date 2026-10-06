// 互动道具特效：道具沿弧线飞向目标头像（飞行中放大、带拖尾），命中后按道具播放多段动画。
// 鲜花：花束弹出 + 花瓣炸开 + 花瓣雨；爱心：两次心跳后炸成满天小爱心；干杯：两只酒杯蓄力碰杯、泡沫飞溅；
// 鸡蛋：压扁砸开、蛋壳飞溅、蛋黄往下流；炸弹：引线嗞嗞、弹体闪红，爆炸冲击波后头像被熏黑冒烟；
// 暴打：一堆拳头从四面八方连环出拳，最后一记重拳砸下，头上冒金星；
// 降龙十八掌：运功聚气，金龙蜿蜒飞去，一掌拍下三道冲击波，龙绕头像一圈后化作金光；
// 掀桌子：掀起牌桌、纸牌飞散，桌子翻滚着倒扣砸在头上，木屑纸牌尘土四溅。
import { Container, FillGradient, Point, Sprite, Text } from 'pixi.js';
import { particleTexture, propTexture } from '../gfx/emoji';
import { Particles } from '../gfx/particles';
import { tween, ease, wait, frames } from '../gfx/tween';
import { FONT_UI } from '../gfx/textures';
import { sound } from '../audio/Sound';

export interface PropHost {
  /** 座位头像中心（本层坐标） */
  seatPos(seat: number): Point;
  shakeHud(seat: number): void;
  /** 震屏 */
  shake(strength: number, ms: number): void;
  /** 画面大小（大字不超出屏幕） */
  bounds(): { w: number; h: number };
}

const PI = Math.PI;
const PETAL = [0xff2d55, 0xff5c7a, 0xe0103a, 0xff8fab, 0xffd0dc];
const PINK = [0xff3d6e, 0xff6f96, 0xff9ab4, 0xe8174a, 0xffc2d4];
const FIRE = [0xffe066, 0xff9a2a, 0xff4a1a];
const SPARK = [0xfff3a0, 0xffc04a, 0xffffff];
const easeIn = (t: number) => t * t;

export class PropFx extends Container {
  /** 道具后面的粒子 */
  private back = new Particles();
  /** 道具本体 */
  private mid = new Container();
  /** 道具前面的粒子 */
  private front = new Particles();
  /** 文字 */
  private top = new Container();

  constructor(private host: PropHost) {
    super();
    this.eventMode = 'none';
    this.addChild(this.back, this.mid, this.front, this.top);
  }

  /** 从 from 座位向 to 座位扔道具 */
  async play(from: number, to: number, key: string) {
    const a = this.host.seatPos(from), b = this.host.seatPos(to);
    sound.play('whoosh');
    try {
      switch (key) {
        case 'flower': await this.flower(a, b); break;
        case 'heart': await this.heart(a, b); break;
        case 'beer': await this.beer(a, b); break;
        case 'egg': await this.egg(a, b, to); break;
        case 'bomb': await this.bomb(a, b, to); break;
        case 'punch': await this.punch(a, b, to); break;
        case 'dragon': await this.dragon(a, b, to); break;
        case 'flip': await this.flip(a, b, to); break;
      }
    } catch (err) {
      // 动画过程中离开牌桌，对象已被销毁；牌桌还在时才是真的出错
      if (!this.destroyed) console.warn('道具特效出错', err);
    }
  }

  // ---------- 通用 ----------

  private sprite(key: string, size: number, x: number, y: number) {
    const s = new Sprite(propTexture(key));
    s.anchor.set(0.5);
    s.width = s.height = size;
    s.position.set(x, y);
    this.mid.addChild(s);
    return s;
  }

  private alive = (...xs: Container[]) => () => !this.destroyed && xs.every((x) => !x.destroyed);

  private later(ms: number, fn: () => void) {
    setTimeout(() => { if (!this.destroyed) fn(); }, ms);
  }

  /**
   * 一闪而过的光：发光/光环/闪光贴图从 from 放大到 to 并淡出。
   * 默认普通混合：叠加混合在绿色桌面上会把橙、黄、粉都偏成荧光绿，只有白色闪光用叠加（add）。
   */
  private pulse(kind: 'glow' | 'ring' | 'sparkle', x: number, y: number, o: { from: number; to: number; dur: number; color: number; alpha?: number; behind?: boolean; add?: boolean }) {
    const s = new Sprite(particleTexture(kind));
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.scale.set(o.from);
    s.tint = o.color;
    s.alpha = o.alpha ?? 1;
    if (o.add) s.blendMode = 'add';
    (o.behind ? this.back : this.front).addChild(s);
    void tween(s, { scale: o.to, alpha: 0 }, o.dur).then(() => { if (!s.destroyed) s.destroy(); });
  }

  /** 沿二次贝塞尔弧线飞行，途中放大（像朝镜头抛过来），每帧可以撒拖尾 */
  private async fly(s: Sprite, a: Point, b: Point, dur: number, o: { spin: number; arc: number; trail?: (x: number, y: number, t: number) => void }) {
    // 控制点在两人中点上方；上下对扔时再往侧面弯，免得冲过头顶
    const dx = b.x - a.x, dy = b.y - a.y;
    const side = Math.abs(dx) < Math.abs(dy) * 0.6 ? o.arc * 0.9 : 0;
    const ctrl = new Point((a.x + b.x) / 2 + side, (a.y + b.y) / 2 - o.arc);
    const base = s.scale.x, rot0 = s.rotation;
    await frames(dur, (t) => {
      const e = t * 0.7 + ease.inOutCubic(t) * 0.3;
      const u = 1 - e;
      s.x = u * u * a.x + 2 * u * e * ctrl.x + e * e * b.x;
      s.y = u * u * a.y + 2 * u * e * ctrl.y + e * e * b.y;
      s.rotation = rot0 + o.spin * e;
      s.scale.set(base * (1 + 0.4 * Math.sin(PI * e)));
      o.trail?.(s.x, s.y, t);
    }, this.alive(s));
    s.position.copyFrom(b);
    s.scale.set(base);
  }

  /** 喊招式名的位置：出招的人头顶，放不下（靠屏幕上边的座位）就放到头像下方 */
  private callY(a: Point, above: number, below = 120) {
    return a.y - above >= 40 ? a.y - above : a.y + below;
  }

  /** 金色大字（如“干杯！”） */
  private shout(text: string, x: number, y: number, size = 40) {
    const fill = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 0xfffbe0 }, { offset: 0.5, color: 0xffd34d }, { offset: 1, color: 0xf08a00 }], textureSpace: 'local' });
    const t = new Text({ text, style: { fontFamily: FONT_UI, fontSize: size, fontWeight: '900', fill, stroke: { color: 0x5a2800, width: 7 }, letterSpacing: 2, dropShadow: { color: 0x000000, alpha: 0.4, blur: 4, distance: 3, angle: PI / 2 } } });
    t.anchor.set(0.5);
    // 不超出屏幕：左右按字宽收进来，上下留边
    const { w, h } = this.host.bounds();
    const half = t.width / 2 + 12;
    x = Math.max(half, Math.min(w - half, x));
    y = Math.max(t.height / 2 + 8, Math.min(h - t.height / 2 - 8, y));
    t.position.set(x, y);
    t.scale.set(0.3);
    t.rotation = -0.08;
    this.top.addChild(t);
    void tween(t, { scale: 1 }, 280, { ease: ease.outBack })
      .then(() => tween(t, { alpha: 0, y: y - 30 }, 450, { delay: 650 }))
      .then(() => { if (!t.destroyed) t.destroy(); });
  }

  // ---------- 鲜花 ----------

  private async flower(a: Point, b: Point) {
    const s = this.sprite('flower', 78, a.x, a.y);
    s.rotation = -0.35;
    await this.fly(s, a, b, 720, {
      spin: 0.35, arc: 170,
      trail: (x, y) => {
        if (Math.random() < 0.55) this.front.burst({ kind: 'sparkle', x, y, count: 1, spread: 16, speed: [10, 40], life: [350, 650], scale: [0.12, 0.24], colors: [0xffd6e4, 0xffe58a, 0xffffff], twinkle: true });
        if (Math.random() < 0.3) this.back.burst({ kind: 'petal', x, y, count: 1, speed: [20, 60], life: [700, 1100], scale: [0.35, 0.55], colors: PETAL, gravity: 120, sway: 40, spin: 4 });
      },
    });
    sound.play('flower');
    sound.play('sparkle');
    this.pulse('glow', b.x, b.y, { from: 1.2, to: 3.4, dur: 650, color: 0xff7aa2, alpha: 0.55, behind: true });
    this.pulse('ring', b.x, b.y, { from: 0.3, to: 1.1, dur: 550, color: 0xffb3c8 });
    // 花瓣向上炸开，再慢慢飘落
    this.front.burst({ kind: 'petal', x: b.x, y: b.y - 10, count: 36, speed: [200, 440], angle: [PI * 1.05, PI * 1.95], life: [1700, 2500], scale: [0.38, 0.7], colors: PETAL, gravity: 320, drag: 1.7, sway: 70, spin: 9 });
    this.front.burst({ kind: 'sparkle', x: b.x, y: b.y, count: 18, speed: [60, 240], life: [600, 1100], scale: [0.15, 0.35], colors: [0xffffff, 0xffe58a, 0xffc2d6], drag: 2, twinkle: true });
    // 头顶再下一阵花瓣雨
    for (let i = 0; i < 3; i++) {
      this.later(160 + i * 260, () => this.front.burst({ kind: 'petal', x: b.x, y: b.y - 150, count: 9, spread: 95, speed: [10, 40], angle: [PI * 0.4, PI * 0.6], life: [1500, 2100], scale: [0.3, 0.52], colors: PETAL, gravity: 90, sway: 60, spin: 5, fadeIn: 200 }));
    }
    s.rotation = 0;
    await tween(s, { scale: s.scale.x * 1.45 }, 260, { ease: ease.outBack });
    const base = s.scale.x;
    await frames(1300, (t, ms) => {
      s.rotation = Math.sin(ms / 1000 * 7) * 0.12 * (1 - t);
      s.scale.set(base * (1 + 0.04 * Math.sin(ms / 1000 * 9)));
    }, this.alive(s));
    await tween(s, { alpha: 0, y: s.y - 30, scale: base * 0.9 }, 450);
    s.destroy();
  }

  // ---------- 爱心 ----------

  private async heart(a: Point, b: Point) {
    const s = this.sprite('heart', 70, a.x, a.y);
    await this.fly(s, a, b, 680, {
      spin: 0, arc: 150,
      trail: (x, y) => {
        if (Math.random() < 0.6) this.back.burst({ kind: 'heart', x, y, count: 1, spread: 8, speed: [10, 50], life: [500, 850], scale: [0.25, 0.45], colors: PINK, upright: true, gravity: -40 });
        if (Math.random() < 0.4) this.back.burst({ kind: 'glow', x, y, count: 1, speed: [0, 20], life: [250, 400], scale: [0.25, 0.4], colors: [0xff6f96] });
      },
    });
    // 两次心跳
    const base = s.scale.x;
    sound.play('thump');
    for (let i = 0; i < 2; i++) {
      this.pulse('glow', b.x, b.y, { from: 1.4, to: 3, dur: 450, color: 0xff4d79, alpha: 0.5, behind: true });
      this.pulse('ring', b.x, b.y, { from: 0.32, to: 0.95, dur: 450, color: 0xff9ab4 });
      await tween(s, { scale: base * 1.55 }, 120);
      await tween(s, { scale: base * 1.12 }, 170, { ease: ease.inOutCubic });
    }
    // 炸成满天小爱心
    sound.play('heart');
    sound.play('sparkle');
    this.pulse('glow', b.x, b.y, { from: 2, to: 5.5, dur: 750, color: 0xff6f96, alpha: 0.6, behind: true });
    this.pulse('ring', b.x, b.y, { from: 0.4, to: 1.9, dur: 700, color: 0xffffff, alpha: 0.9 });
    void tween(s, { scale: base * 2.3, alpha: 0 }, 260);
    this.front.burst({ kind: 'heart', x: b.x, y: b.y, count: 28, speed: [170, 400], life: [1300, 2100], scale: [0.35, 0.8], colors: PINK, upright: true, drag: 2.3, gravity: -90, sway: 50 });
    this.front.burst({ kind: 'sparkle', x: b.x, y: b.y, count: 22, speed: [80, 280], life: [700, 1200], scale: [0.15, 0.35], colors: [0xffffff, 0xffd0dc], drag: 2, twinkle: true });
    // 余韵：头像上方继续冒出小爱心
    for (let i = 0; i < 6; i++) {
      this.later(250 + i * 200, () => this.front.burst({ kind: 'heart', x: b.x, y: b.y - 20, count: 2, spread: 30, speed: [40, 90], angle: [PI * 1.3, PI * 1.7], life: [1200, 1600], scale: [0.3, 0.5], colors: PINK, upright: true, gravity: -30, sway: 40, fadeIn: 150 }));
    }
    await wait(300);
    s.destroy();
  }

  // ---------- 干杯 ----------

  private async beer(a: Point, b: Point) {
    const size = 74;
    const s = this.sprite('beer', size, a.x, a.y);
    await this.fly(s, a, b, 650, {
      spin: PI * 2, arc: 150,
      trail: (x, y) => {
        if (Math.random() < 0.35) this.back.burst({ kind: 'bubble', x, y, count: 1, spread: 10, speed: [10, 40], life: [400, 700], scale: [0.2, 0.4], upright: true, gravity: -60 });
      },
    });
    s.rotation = 0;
    // 左手一杯、右手一杯，把手朝外：左杯镜像，第二只杯子从右边滑进来
    s.scale.x *= -1;
    const s2 = this.sprite('beer', size, b.x + 110, b.y);
    s2.alpha = 0;
    await Promise.all([tween(s, { x: b.x - 58, rotation: -0.12 }, 180), tween(s2, { x: b.x + 58, alpha: 1, rotation: 0.12 }, 180)]);
    // 蓄力后仰，再猛地碰在一起
    await Promise.all([tween(s, { x: b.x - 72, rotation: -0.42 }, 170), tween(s2, { x: b.x + 72, rotation: 0.42 }, 170)]);
    await Promise.all([tween(s, { x: b.x - 30, rotation: 0.32 }, 110, { ease: easeIn }), tween(s2, { x: b.x + 30, rotation: -0.32 }, 110, { ease: easeIn })]);
    sound.play('beer');
    const cx = b.x, cy = b.y - 30;
    this.host.shake(3, 120);
    this.pulse('sparkle', cx, cy, { from: 0.6, to: 2.4, dur: 400, color: 0xffffff, add: true });
    this.pulse('glow', cx, cy, { from: 1, to: 3.2, dur: 520, color: 0xffd66b, alpha: 0.6 });
    this.front.burst({ kind: 'streak', x: cx, y: cy, count: 12, speed: [320, 580], life: [220, 380], scale: [0.35, 0.6], colors: [0xfff6c0, 0xffffff], alignVel: true, drag: 3 });
    this.front.burst({ kind: 'foam', x: cx, y: cy, count: 22, spread: 10, speed: [150, 360], angle: [PI * 1.1, PI * 1.9], life: [700, 1100], scale: [0.25, 0.6], gravity: 720 });
    this.front.burst({ kind: 'glow', x: cx, y: cy, count: 14, speed: [120, 300], angle: [PI * 1.05, PI * 1.95], life: [600, 900], scale: [0.08, 0.16], colors: [0xffc23a, 0xffa514], gravity: 650 });
    // 弹开回正
    await Promise.all([tween(s, { x: b.x - 46, rotation: 0.04 }, 240, { ease: ease.outBack }), tween(s2, { x: b.x + 46, rotation: -0.04 }, 240, { ease: ease.outBack })]);
    this.shout('干杯！', b.x, b.y - 92);
    for (let i = 0; i < 4; i++) {
      this.later(i * 180, () => {
        for (const x of [b.x - 46, b.x + 46]) this.front.burst({ kind: 'bubble', x, y: b.y - 26, count: 2, spread: 12, speed: [30, 70], angle: [PI * 1.35, PI * 1.65], life: [900, 1400], scale: [0.25, 0.5], upright: true, gravity: -60, sway: 30 });
      });
    }
    // 杯子轻轻晃两下
    await frames(800, (t, ms) => {
      const w = Math.sin(ms / 1000 * 10) * 0.06 * (1 - t);
      s.rotation = w; s2.rotation = -w;
    }, this.alive(s, s2));
    await Promise.all([tween(s, { alpha: 0, y: s.y - 20 }, 350), tween(s2, { alpha: 0, y: s2.y - 20 }, 350)]);
    s.destroy(); s2.destroy();
  }

  // ---------- 鸡蛋 ----------

  private async egg(a: Point, b: Point, to: number) {
    const s = this.sprite('egg', 56, a.x, a.y);
    await this.fly(s, a, b, 600, {
      spin: PI * 5, arc: 170,
      trail: (x, y) => {
        if (Math.random() < 0.5) this.back.burst({ kind: 'glow', x, y, count: 1, speed: [0, 10], life: [180, 300], scale: [0.1, 0.18], colors: [0xffffff], alpha: 0.5 });
      },
    });
    sound.play('egg');
    s.rotation = 0;
    // 砸扁
    const k0 = s.scale.x;
    await frames(70, (t) => s.scale.set(k0 * (1 + 0.45 * t), k0 * (1 - 0.45 * t)), this.alive(s));
    s.texture = propTexture('splat');
    s.width = s.height = 60;
    s.rotation = (Math.random() - 0.5) * 0.5;
    this.host.shakeHud(to);
    this.host.shake(4, 160);
    this.front.burst({ kind: 'shard', x: b.x, y: b.y, count: 12, speed: [180, 430], life: [600, 950], scale: [0.4, 0.8], gravity: 1100, spin: 14 });
    this.front.burst({ kind: 'yolk', x: b.x, y: b.y, count: 10, speed: [150, 360], life: [500, 800], scale: [0.3, 0.55], gravity: 1000, spin: 6 });
    this.front.burst({ kind: 'foam', x: b.x, y: b.y, count: 12, speed: [120, 320], life: [450, 750], scale: [0.25, 0.5], gravity: 900, alpha: 0.85 });
    await tween(s, { scale: s.scale.x * (112 / 60) }, 130, { ease: ease.outBack });
    // 蛋黄顺着头像往下流
    const drips = [-18, 16].map((dx) => {
      const d = new Sprite(particleTexture('yolk'));
      d.anchor.set(0.5, 0.15);
      d.position.set(b.x + dx, b.y + 20);
      d.scale.set(0.42);
      this.mid.addChild(d);
      return d;
    });
    const y0 = s.y;
    await frames(1600, (t) => {
      drips.forEach((d, i) => {
        d.y = b.y + 20 + (26 + i * 12) * ease.outCubic(t);
        d.scale.y = 0.42 * (1 + 1.3 * t);
      });
      s.y = y0 + 8 * t;
    }, this.alive(s, ...drips));
    await Promise.all([s, ...drips].map((x) => tween(x, { alpha: 0 }, 450)));
    s.destroy();
    drips.forEach((d) => d.destroy());
  }

  // ---------- 炸弹 ----------

  private async bomb(a: Point, b: Point, to: number) {
    const s = this.sprite('bomb', 70, a.x, a.y);
    // 引线头在贴图里的位置（128 逻辑尺寸，相对中心）
    const tip = () => {
      const k = Math.abs(s.width) / 128, r = s.rotation;
      const ox = 46 * k, oy = -52 * k;
      return { x: s.x + ox * Math.cos(r) - oy * Math.sin(r), y: s.y + ox * Math.sin(r) + oy * Math.cos(r) };
    };
    const sparks = (n: number) => {
      const p = tip();
      this.front.burst({ kind: 'streak', x: p.x, y: p.y, count: n, speed: [80, 260], life: [150, 320], scale: [0.15, 0.3], colors: SPARK, alignVel: true, gravity: 300 });
      this.front.burst({ kind: 'glow', x: p.x, y: p.y, count: 1, speed: [0, 0], life: [100, 160], scale: [0.25, 0.4], colors: [0xffb040] });
    };
    await this.fly(s, a, b, 700, {
      spin: PI * 2, arc: 160,
      trail: (x, y) => {
        sparks(1);
        if (Math.random() < 0.3) this.back.burst({ kind: 'smoke', x, y, count: 1, speed: [5, 20], life: [500, 800], scale: [0.2, 0.35], grow: 0.8 });
      },
    });
    s.rotation = 0;
    // 落地弹两下
    await tween(s, { y: b.y - 26 }, 140);
    await tween(s, { y: b.y }, 140, { ease: easeIn });
    await tween(s, { y: b.y - 10 }, 90);
    await tween(s, { y: b.y }, 90, { ease: easeIn });
    // 引线嗞嗞：火花四溅，弹体一胀一缩、越来越快地闪红
    sound.play('fuse');
    const base = s.scale.x;
    await frames(850, (t, ms) => {
      sparks(2);
      const f = Math.sin(ms / 1000 * (14 + 34 * t));
      s.scale.set(base * (1 + 0.08 * (f * 0.5 + 0.5) * (0.5 + t)));
      s.tint = f > 0.3 ? 0xff6a6a : 0xffffff;
      s.x = b.x + (Math.random() - 0.5) * 5 * t;
    }, this.alive(s));
    s.destroy();
    // 爆炸：白光核心、火球、冲击波、火花、碎屑、浓烟
    sound.play('boom');
    this.host.shake(10, 380);
    this.host.shakeHud(to);
    this.pulse('glow', b.x, b.y, { from: 1.2, to: 4.5, dur: 380, color: 0xfff6d0, alpha: 0.95 });
    this.pulse('glow', b.x, b.y, { from: 2, to: 5, dur: 750, color: 0xff7a1a, alpha: 0.75, behind: true });
    this.pulse('ring', b.x, b.y, { from: 0.3, to: 2.3, dur: 520, color: 0xffc060 });
    this.pulse('ring', b.x, b.y, { from: 0.2, to: 1.5, dur: 700, color: 0xffffff, alpha: 0.6 });
    this.front.burst({ kind: 'glow', x: b.x, y: b.y, count: 32, speed: [120, 380], life: [350, 700], scale: [0.25, 0.6], colors: FIRE, drag: 2.5 });
    this.front.burst({ kind: 'streak', x: b.x, y: b.y, count: 26, speed: [380, 740], life: [300, 560], scale: [0.3, 0.6], colors: SPARK, alignVel: true, drag: 1.5, gravity: 400 });
    this.front.burst({ kind: 'debris', x: b.x, y: b.y, count: 12, speed: [220, 480], life: [600, 900], scale: [0.4, 0.8], gravity: 1100, spin: 12 });
    this.back.burst({ kind: 'smoke', x: b.x, y: b.y, count: 10, spread: 20, speed: [40, 140], life: [800, 1300], scale: [0.45, 0.8], grow: 0.45, drag: 1.4, gravity: -40 });
    // 头像被熏黑，冒着烟，零星火星
    const soot = this.sprite('soot', 104, b.x, b.y);
    soot.alpha = 0;
    await tween(soot, { alpha: 0.95 }, 140);
    await frames(1700, () => {
      if (Math.random() < 0.12) this.front.burst({ kind: 'smoke', x: b.x, y: b.y - 18, count: 1, spread: 26, speed: [20, 50], angle: [PI * 1.35, PI * 1.65], life: [800, 1200], scale: [0.3, 0.5], grow: 0.6, gravity: -30 });
      if (Math.random() < 0.08) this.front.burst({ kind: 'glow', x: b.x, y: b.y, count: 1, spread: 34, speed: [10, 40], angle: [PI * 1.3, PI * 1.7], life: [400, 700], scale: [0.06, 0.12], colors: [0xffa040] });
    }, this.alive(soot));
    await tween(soot, { alpha: 0 }, 600);
    soot.destroy();
  }

  // ---------- 暴打 ----------

  /** 漫画拟声字（砰、啪…），弹出后淡出 */
  private onomatopoeia(x: number, y: number) {
    const words = ['砰', '啪', '嘭', '咚'];
    const fill = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 0xfff6a0 }, { offset: 1, color: 0xff7a00 }], textureSpace: 'local' });
    const t = new Text({ text: words[Math.floor(Math.random() * words.length)] + '！', style: { fontFamily: FONT_UI, fontSize: 30, fontWeight: '900', fill, stroke: { color: 0x8a1500, width: 6 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    t.rotation = (Math.random() - 0.5) * 0.6;
    t.scale.set(0.4);
    this.top.addChild(t);
    void tween(t, { scale: 1.1 }, 140, { ease: ease.outBack })
      .then(() => tween(t, { alpha: 0, y: y - 18 }, 300, { delay: 180 }))
      .then(() => { if (!t.destroyed) t.destroy(); });
  }

  /** 拳头打中：爆击星弹出、火花、偶尔冒拟声字 */
  private impact(x: number, y: number, big = false) {
    sound.play('punch');
    const p = new Sprite(particleTexture('pow'));
    p.anchor.set(0.5);
    p.position.set(x, y);
    p.rotation = Math.random() * PI;
    p.scale.set(big ? 0.35 : 0.2);
    this.front.addChild(p);
    void tween(p, { scale: big ? 0.95 : 0.5 }, big ? 160 : 110, { ease: ease.outBack })
      .then(() => tween(p, { alpha: 0, scale: big ? 1.05 : 0.55 }, big ? 260 : 160))
      .then(() => { if (!p.destroyed) p.destroy(); });
    this.front.burst({ kind: 'streak', x, y, count: big ? 14 : 5, speed: big ? [300, 560] : [200, 380], life: [140, 260], scale: [0.2, 0.4], colors: [0xffffff, 0xfff3a0], alignVel: true, drag: 3 });
  }

  /** 一只拳头：从 angle 方向的远处冲向头像边缘，打中后缩回淡出 */
  private async jab(b: Point, angle: number, size: number) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const f = this.sprite('punch', size, b.x + dx * 130, b.y + dy * 130);
    f.rotation = angle + PI; // 拳面朝向头像
    f.alpha = 0;
    // 先往后蓄一下力，再猛地打出去
    await tween(f, { alpha: 1, x: b.x + dx * 140, y: b.y + dy * 140 }, 60);
    await tween(f, { x: b.x + dx * 46, y: b.y + dy * 46 }, 70, { ease: easeIn });
    this.impact(b.x + dx * 26, b.y + dy * 26);
    await tween(f, { x: b.x + dx * 70, y: b.y + dy * 70, alpha: 0 }, 160);
    f.destroy();
  }

  private async punch(a: Point, b: Point, to: number) {
    // 第一拳从扔的人那里飞过来，拳面朝飞行方向
    const s = this.sprite('punch', 64, a.x, a.y);
    let px = a.x, py = a.y;
    await this.fly(s, a, b, 460, {
      spin: 0, arc: 90,
      trail: (x, y) => {
        s.rotation = Math.atan2(y - py, x - px);
        px = x; py = y;
        if (Math.random() < 0.6) this.back.burst({ kind: 'streak', x, y, count: 1, speed: [0, 10], life: [120, 200], scale: [0.4, 0.6], colors: [0xffffff], alpha: 0.6 });
      },
    });
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    this.impact(b.x - Math.cos(dir) * 26, b.y - Math.sin(dir) * 26);
    this.host.shakeHud(to);
    s.destroy();
    // 一堆拳头四面八方连环出拳
    const hits = 14;
    const jabs: Promise<void>[] = [];
    for (let i = 0; i < hits; i++) {
      const angle = Math.random() * PI * 2;
      jabs.push(wait(60 + i * 85 + Math.random() * 30).then(() => (this.destroyed ? undefined : this.jab(b, angle, 54 + Math.random() * 14))));
      if (i % 3 === 1) this.later(130 + i * 85, () => this.onomatopoeia(b.x + (Math.random() - 0.5) * 120, b.y - 40 - Math.random() * 40));
    }
    await Promise.all(jabs);
    // 最后一记重拳从头顶砸下
    const k = this.sprite('punch', 96, b.x, b.y - 190);
    k.rotation = PI / 2;
    k.alpha = 0;
    await tween(k, { alpha: 1, y: b.y - 200 }, 90);
    await tween(k, { y: b.y - 40 }, 110, { ease: easeIn });
    this.impact(b.x, b.y - 20, true);
    this.pulse('ring', b.x, b.y, { from: 0.3, to: 1.4, dur: 450, color: 0xffd34d });
    this.host.shake(7, 220);
    this.host.shakeHud(to);
    this.shout('暴打！', b.x, b.y - 100, 44);
    await tween(k, { y: b.y - 90, alpha: 0 }, 260);
    k.destroy();
    // 头上冒金星，转几圈
    const stars = [0, 1, 2].map(() => {
      const st = new Sprite(particleTexture('star'));
      st.anchor.set(0.5);
      st.tint = 0xffe14a;
      st.scale.set(0.42);
      this.front.addChild(st);
      return st;
    });
    await frames(1300, (t, ms) => {
      stars.forEach((st, i) => {
        const a2 = ms / 1000 * 6 + (i * PI * 2) / 3;
        st.position.set(b.x + Math.cos(a2) * 44, b.y - 52 + Math.sin(a2) * 12);
        st.rotation = ms / 1000 * 5;
        st.alpha = t < 0.75 ? 1 : (1 - t) / 0.25;
      });
    }, this.alive(...stars));
    stars.forEach((st) => st.destroy());
  }

  // ---------- 降龙十八掌 ----------

  private async dragon(a: Point, b: Point, to: number) {
    // 运功：出招的人周围金光聚气
    this.shout('降龙十八掌！', a.x, this.callY(a, 96), 40);
    this.pulse('glow', a.x, a.y, { from: 0.8, to: 2.8, dur: 650, color: 0xffc94a, alpha: 0.6, behind: true });
    await frames(620, () => {
      for (let k = 0; k < 2; k++) {
        const th = Math.random() * PI * 2, r = 80 + Math.random() * 40;
        this.front.burst({ kind: 'glow', x: a.x + Math.cos(th) * r, y: a.y + Math.sin(th) * r, count: 1, angle: [th + PI, th + PI], speed: [r * 2.3, r * 2.6], life: [360, 420], scale: [0.1, 0.2], colors: [0xffd34d, 0xffb020, 0xfff3b0] });
      }
    }, this.alive(this));
    // 金龙出：先蜿蜒飞向目标，再绕头像盘一圈
    sound.play('roar');
    const R = 72;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const perp = { x: -dir.y, y: dir.x };
    const entry = { x: b.x - dir.x * R, y: b.y - dir.y * R };
    const ang0 = Math.atan2(entry.y - b.y, entry.x - b.x);
    // u ∈ [0,1] 飞行，[1,2] 盘绕
    const path = (u: number) => {
      if (u <= 1) {
        const w = Math.sin(u * PI * 3) * 52 * (1 - u * 0.4);
        return { x: a.x + (entry.x - a.x) * u + perp.x * w, y: a.y + (entry.y - a.y) * u + perp.y * w };
      }
      const th = ang0 + (u - 1) * PI * 2.3;
      return { x: b.x + Math.cos(th) * R, y: b.y + Math.sin(th) * R * 0.8 };
    };
    const N = 24, GAP = 0.03;
    // 从尾到头加进去，龙头盖在最上面
    const body = Array.from({ length: N }, (_, i) => {
      const k = N - 1 - i;
      const seg = this.sprite('dragonScale', 72 - k * 1.9, a.x, a.y);
      seg.alpha = 0;
      return { seg, k };
    });
    const head = this.sprite('dragonHead', 100, a.x, a.y);
    const place = (sp: Sprite, u: number) => {
      const p = path(u), q = path(u + 0.01);
      sp.position.set(p.x, p.y);
      sp.rotation = Math.atan2(q.y - p.y, q.x - p.x);
      // 往左飞时上下翻转，免得龙肚皮朝天
      sp.scale.y = Math.abs(sp.scale.y) * (Math.cos(sp.rotation) < 0 ? -1 : 1);
    };
    let struck = false;
    const T1 = 650, T2 = 800;
    await frames(T1 + T2, (_t, ms) => {
      const U = ms < T1 ? ms / T1 : 1 + (ms - T1) / T2;
      place(head, U);
      for (const { seg, k } of body) {
        const u = U - (k + 1) * GAP;
        seg.alpha = u > 0 ? 1 : 0;
        place(seg, Math.max(0, u));
      }
      if (Math.random() < 0.7) this.front.burst({ kind: 'sparkle', x: head.x, y: head.y, count: 1, spread: 18, speed: [10, 50], life: [300, 600], scale: [0.12, 0.25], colors: [0xffe58a, 0xffffff, 0xffc94a], twinkle: true });
      // 龙头到达：一掌拍下
      if (!struck && U >= 1) { struck = true; this.palmStrike(b, to); }
    }, this.alive(head));
    // 金龙化作金光散去，从尾到头
    for (const { seg, k } of [...body].sort((x, y) => y.k - x.k)) {
      this.later((N - k) * 25, () => {
        if (seg.destroyed) return;
        this.front.burst({ kind: 'sparkle', x: seg.x, y: seg.y, count: 3, spread: 10, speed: [40, 120], life: [400, 700], scale: [0.15, 0.3], colors: [0xffe58a, 0xffffff], twinkle: true });
        seg.destroy();
      });
    }
    await wait(N * 25 + 40);
    this.front.burst({ kind: 'sparkle', x: head.x, y: head.y, count: 10, speed: [60, 200], life: [500, 900], scale: [0.2, 0.4], colors: [0xffe58a, 0xffffff], twinkle: true, drag: 2 });
    await tween(head, { alpha: 0, scale: head.scale.x * 1.3 }, 220);
    head.destroy();
  }

  /** 一掌拍在头像上：金色掌印砸下、三道冲击波、金色火花、震屏 */
  private palmStrike(b: Point, to: number) {
    sound.play('boom');
    sound.play('punch');
    this.host.shake(12, 450);
    this.host.shakeHud(to);
    const palm = this.sprite('dragon', 150, b.x, b.y);
    const k = palm.scale.x;
    palm.scale.set(k * 2.2);
    palm.alpha = 0;
    void tween(palm, { scale: k, alpha: 1 }, 130, { ease: easeIn })
      .then(() => tween(palm, { alpha: 0, scale: k * 1.08 }, 900, { delay: 350 }))
      .then(() => { if (!palm.destroyed) palm.destroy(); });
    for (let i = 0; i < 3; i++) this.later(i * 130, () => this.pulse('ring', b.x, b.y, { from: 0.3, to: 2.4, dur: 600, color: 0xffd34d }));
    this.pulse('glow', b.x, b.y, { from: 1.5, to: 5, dur: 700, color: 0xffcf33, alpha: 0.75, behind: true });
    this.front.burst({ kind: 'glow', x: b.x, y: b.y, count: 30, speed: [200, 520], life: [400, 700], scale: [0.15, 0.35], colors: [0xffe066, 0xffb020, 0xfff3b0], drag: 2 });
    this.front.burst({ kind: 'streak', x: b.x, y: b.y, count: 22, speed: [380, 700], life: [280, 480], scale: [0.3, 0.55], colors: [0xfff3a0, 0xffffff], alignVel: true, drag: 1.5 });
  }

  // ---------- 掀桌子 ----------

  private async flip(a: Point, b: Point, to: number) {
    this.shout('(╯°□°)╯︵ ┻━┻', a.x, this.callY(a, 165, 130), 30);
    // 桌子从扔的人面前掀起来，牌飞出去
    const s = this.sprite('flip', 118, a.x, a.y - 10);
    s.alpha = 0;
    await tween(s, { alpha: 1, y: a.y - 40 }, 120);
    await tween(s, { rotation: -0.55, y: a.y - 72 }, 170);
    sound.play('whoosh');
    this.front.burst({ kind: 'card', x: s.x, y: s.y - 20, count: 14, spread: 20, speed: [220, 440], angle: [PI * 1.1, PI * 1.9], life: [900, 1300], scale: [0.5, 0.8], gravity: 750, spin: 12 });
    await this.fly(s, new Point(s.x, s.y), b, 640, {
      spin: PI * 2 + PI + 0.55, arc: 140,
      trail: (x, y) => {
        if (Math.random() < 0.15) this.back.burst({ kind: 'card', x, y, count: 1, speed: [30, 90], life: [600, 900], scale: [0.4, 0.6], gravity: 500, spin: 10 });
      },
    });
    // 倒扣着砸在头上
    s.rotation = PI;
    sound.play('crash');
    this.host.shake(14, 480);
    this.host.shakeHud(to);
    this.pulse('ring', b.x, b.y, { from: 0.3, to: 1.8, dur: 450, color: 0xe8c79a });
    this.front.burst({ kind: 'plank', x: b.x, y: b.y, count: 16, spread: 20, speed: [220, 520], life: [700, 1100], scale: [0.5, 0.9], gravity: 1100, spin: 14 });
    this.front.burst({ kind: 'card', x: b.x, y: b.y, count: 16, spread: 20, speed: [180, 460], life: [900, 1400], scale: [0.5, 0.8], gravity: 700, spin: 12, drag: 0.6 });
    this.back.burst({ kind: 'smoke', x: b.x, y: b.y + 20, count: 12, spread: 40, speed: [60, 180], angle: [PI * 1.0, PI * 2.0], life: [700, 1200], scale: [0.4, 0.75], grow: 0.7, drag: 1.5, colors: [0xd9c3a0] });
    await tween(s, { y: b.y - 22, rotation: PI + 0.18 }, 130);
    await tween(s, { y: b.y, rotation: PI }, 130, { ease: easeIn });
    await tween(s, { y: b.y - 8, rotation: PI - 0.06 }, 90);
    await tween(s, { y: b.y, rotation: PI }, 90, { ease: easeIn });
    await wait(700);
    await tween(s, { alpha: 0, y: b.y + 20 }, 400);
    s.destroy();
  }
}
