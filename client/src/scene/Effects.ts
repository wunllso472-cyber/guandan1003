// 牌桌特效：大字、牌型标签、炸弹/同花顺/天王炸、胜利彩带、震屏。
import { Container, Graphics, Text, FillGradient } from 'pixi.js';
import { FONT_UI } from '../gfx/textures';
import { tween, ease, wait } from '../gfx/tween';
import { Particles } from '../gfx/particles';

export class Effects extends Container {
  readonly particles = new Particles();
  private flashG = new Graphics();
  DW = 1280;
  DH = 750;

  constructor(private shakeTarget: Container) {
    super();
    this.eventMode = 'none';
    this.flashG.alpha = 0;
    this.addChild(this.flashG, this.particles);
  }

  layout(DW: number, DH: number) {
    this.DW = DW; this.DH = DH;
    this.flashG.clear().rect(0, 0, DW, DH).fill({ color: 0xffffff });
  }

  /** 屏幕中央的大字 */
  bigText(text: string, colors: [number, number], size = 72) {
    const fill = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: colors[0] }, { offset: 1, color: colors[1] }], textureSpace: 'local' });
    const t = new Text({
      text,
      style: {
        fontFamily: FONT_UI, fontSize: size, fontWeight: '900', fill, stroke: { color: 0x3a1500, width: 10 },
        dropShadow: { color: 0x000000, alpha: 0.5, blur: 6, distance: 5, angle: Math.PI / 2 }, letterSpacing: 4,
      },
    });
    t.anchor.set(0.5);
    t.position.set(this.DW / 2, this.DH * 0.4);
    t.scale.set(2.4);
    t.alpha = 0;
    this.addChild(t);
    void tween(t, { scale: 1, alpha: 1 }, 320, { ease: ease.outBack })
      .then(() => (t.destroyed ? undefined : tween(t, { alpha: 0, y: t.y - 40 }, 400, { delay: 800 })))
      .then(() => { if (!t.destroyed) t.destroy(); });
  }

  /** 牌型小标签（顺子、三连对等），出现在出牌区下方 */
  comboLabel(text: string, x: number, y: number) {
    const fill = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 0xfff3a0 }, { offset: 1, color: 0xf0a020 }], textureSpace: 'local' });
    const t = new Text({ text, style: { fontFamily: FONT_UI, fontSize: 34, fontWeight: '900', fill, stroke: { color: 0x5a2800, width: 6 }, letterSpacing: 3 } });
    t.anchor.set(0.5);
    t.position.set(x - 60, y);
    t.alpha = 0;
    this.addChild(t);
    this.particles.burst({ kind: 'star', x, y, count: 8, speed: [60, 160], life: [400, 700], scale: [0.2, 0.4], colors: [0xffe58a, 0xffffff], blend: 'add' });
    void tween(t, { x, alpha: 1 }, 220, { ease: ease.outBack })
      .then(() => tween(t, { alpha: 0 }, 300, { delay: 700 }))
      .then(() => { if (!t.destroyed) t.destroy(); });
  }

  private shaking: { x: number; y: number; end: number; strength: number; ms: number } | null = null;

  /** 震屏；重叠的震动会合并，结束后回到原位 */
  shake(strength = 12, ms = 400) {
    const target = this.shakeTarget;
    const now = performance.now();
    if (this.shaking) {
      this.shaking.end = Math.max(this.shaking.end, now + ms);
      this.shaking.strength = Math.max(this.shaking.strength, strength);
      this.shaking.ms = Math.max(this.shaking.ms, ms);
      return;
    }
    const st = (this.shaking = { x: target.x, y: target.y, end: now + ms, strength, ms });
    const step = () => {
      if (target.destroyed) { this.shaking = null; return; }
      const left = st.end - performance.now();
      if (left <= 0) { target.position.set(st.x, st.y); this.shaking = null; return; }
      const s = st.strength * Math.min(1, left / st.ms);
      target.position.set(st.x + (Math.random() - 0.5) * s * 2, st.y + (Math.random() - 0.5) * s * 2);
      requestAnimationFrame(step);
    };
    step();
  }

  flash(alpha = 0.6, ms = 300) {
    this.flashG.alpha = alpha;
    void tween(this.flashG, { alpha: 0 }, ms);
  }

  /** 普通炸弹：火光 + 烟 + 震屏 */
  bomb(x: number, y: number, big = false) {
    this.flash(big ? 0.7 : 0.45, 350);
    this.shake(big ? 18 : 12, big ? 600 : 420);
    const p = this.particles;
    p.burst({ kind: 'glow', x, y, count: 1, speed: [0, 0], life: [450, 450], scale: [3, 3], grow: 2.5, colors: [0xffd27a], blend: 'add' });
    p.burst({ kind: 'glow', x, y, count: big ? 40 : 26, speed: [180, 520], life: [400, 800], scale: [0.3, 0.7], colors: [0xffe066, 0xff8a2a, 0xff4a1a], blend: 'add', gravity: 200 });
    p.burst({ kind: 'smoke', x, y, count: 7, speed: [40, 120], life: [700, 1100], scale: [0.6, 1.0], grow: 0.6, angle: [Math.PI, Math.PI * 2] });
    p.burst({ kind: 'star', x, y, count: 14, speed: [250, 500], life: [500, 800], scale: [0.25, 0.5], colors: [0xfff3a0], blend: 'add', gravity: 600 });
  }

  /** 同花顺：彩色光点环绕 */
  straightFlush(x: number, y: number) {
    this.flash(0.35, 300);
    this.shake(8, 300);
    const colors = [0xff5a5a, 0xffb84a, 0xfff35a, 0x5aff8a, 0x5ac8ff, 0xb05aff];
    this.particles.burst({ kind: 'star', x, y, count: 36, speed: [150, 420], life: [700, 1200], scale: [0.25, 0.55], colors, blend: 'add', gravity: 120 });
    this.particles.burst({ kind: 'glow', x, y, count: 1, speed: [0, 0], life: [500, 500], scale: [2.5, 2.5], grow: 2, colors: [0xfff6c0], blend: 'add' });
  }

  /** 天王炸：连续烟花 */
  async jokerBomb() {
    this.flash(0.8, 500);
    this.shake(22, 700);
    const colors = [[0xffe066, 0xffffff], [0xff5a7a, 0xffd0dc], [0x5ad8ff, 0xffffff], [0xb07aff, 0xffe0ff], [0x7aff9a, 0xffffff]];
    for (let i = 0; i < 6; i++) {
      const x = this.DW * (0.2 + Math.random() * 0.6), y = this.DH * (0.15 + Math.random() * 0.35);
      this.particles.burst({ kind: 'glow', x, y, count: 50, speed: [120, 380], life: [800, 1300], scale: [0.18, 0.35], colors: colors[i % colors.length], blend: 'add', gravity: 160 });
      this.particles.burst({ kind: 'star', x, y, count: 10, speed: [60, 200], life: [600, 900], scale: [0.2, 0.4], colors: [0xffffff], blend: 'add' });
      await wait(220);
    }
  }

  /** 胜利彩带 */
  confetti() {
    const colors = [0xff5a5a, 0xffc04a, 0x5ad86a, 0x4aa8ff, 0xc07aff, 0xff7ac8];
    for (let i = 0; i < 5; i++) {
      this.particles.burst({
        kind: 'rect', x: this.DW * (0.1 + i * 0.2), y: -20, count: 24, speed: [80, 260], angle: [Math.PI * 0.3, Math.PI * 0.7],
        life: [2200, 3200], scale: [0.6, 1.1], colors, gravity: 160, spin: 10,
      });
    }
  }
}
