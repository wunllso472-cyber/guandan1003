// 轻量粒子系统
import { Container, Sprite, Ticker } from 'pixi.js';
import { particleTexture, type ParticleKind } from './emoji';

interface P {
  s: Sprite;
  vx: number; vy: number;
  g: number;
  life: number; age: number;
  spin: number;
  grow: number;
  fade: boolean;
  drag: number;
  sway: number; swayF: number; phase: number;
  align: boolean;
  fadeIn: number;
  twinkle: boolean;
  /** 基准透明度（随寿命淡出、闪烁都乘在它上面） */
  a: number;
}

export interface BurstOpts {
  kind: ParticleKind;
  x: number; y: number;
  count: number;
  speed: [number, number];
  /** 发射角范围（弧度），默认全方向 */
  angle?: [number, number];
  life?: [number, number];
  gravity?: number;
  scale?: [number, number];
  grow?: number;
  colors?: number[];
  spin?: number;
  blend?: 'add' | 'normal';
  /** 空气阻力：每秒速度衰减的比例（0.8 表示每秒大约减掉八成） */
  drag?: number;
  /** 左右飘动的速度幅度（像素/秒），花瓣、气泡用 */
  sway?: number;
  /** 旋转跟随速度方向（拖尾火花） */
  alignVel?: boolean;
  /** 出生点在半径内随机分布 */
  spread?: number;
  /** 不随机旋转（爱心、气泡保持正向） */
  upright?: boolean;
  /** 淡入时间（毫秒） */
  fadeIn?: number;
  /** 闪烁 */
  twinkle?: boolean;
  alpha?: number;
}

export class Particles extends Container {
  private list: P[] = [];

  constructor() {
    super();
    Ticker.shared.add(this.update, this);
  }

  override destroy() {
    Ticker.shared.remove(this.update, this);
    super.destroy({ children: true });
  }

  burst(o: BurstOpts) {
    const tex = particleTexture(o.kind);
    const [a0, a1] = o.angle ?? [0, Math.PI * 2];
    const rnd = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
    for (let i = 0; i < o.count; i++) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      const sr = o.spread ? Math.sqrt(Math.random()) * o.spread : 0, sa = Math.random() * Math.PI * 2;
      s.position.set(o.x + Math.cos(sa) * sr, o.y + Math.sin(sa) * sr);
      s.scale.set(rnd(o.scale ?? [0.4, 0.8]));
      s.rotation = o.upright ? (Math.random() - 0.5) * 0.4 : Math.random() * Math.PI * 2;
      if (o.colors) s.tint = o.colors[Math.floor(Math.random() * o.colors.length)];
      if (o.blend === 'add') s.blendMode = 'add';
      const a = rnd([a0, a1]);
      const v = rnd(o.speed);
      this.addChild(s);
      this.list.push({
        s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.gravity ?? 0,
        life: rnd(o.life ?? [600, 1100]), age: 0, spin: (Math.random() - 0.5) * (o.spin ?? 6),
        grow: o.grow ?? 0, fade: true,
        drag: o.drag ?? 0, sway: o.sway ?? 0, swayF: 2 + Math.random() * 2.5, phase: Math.random() * Math.PI * 2,
        align: !!o.alignVel, fadeIn: o.fadeIn ?? 0, twinkle: !!o.twinkle, a: o.alpha ?? 1,
      });
      if (o.upright || o.alignVel) this.list[this.list.length - 1].spin = o.upright ? (Math.random() - 0.5) * (o.spin ?? 1) : 0;
      if (o.alignVel) s.rotation = a;
      if (o.fadeIn) s.alpha = 0;
    }
  }

  private update(t: Ticker) {
    const dt = Math.min(50, t.deltaMS) / 1000;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt * 1000;
      if (p.age >= p.life) { p.s.destroy(); this.list.splice(i, 1); continue; }
      p.vy += p.g * dt;
      if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
      const sway = p.sway ? Math.sin(p.age / 1000 * p.swayF + p.phase) * p.sway : 0;
      p.s.x += (p.vx + sway) * dt;
      p.s.y += p.vy * dt;
      if (p.align) p.s.rotation = Math.atan2(p.vy, p.vx);
      else p.s.rotation += p.spin * dt;
      if (p.grow) p.s.scale.set(p.s.scale.x * (1 + p.grow * dt));
      const k = p.age / p.life;
      let alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (p.fadeIn && p.age < p.fadeIn) alpha *= p.age / p.fadeIn;
      if (p.twinkle) alpha *= 0.55 + 0.45 * Math.sin(p.age / 1000 * 18 + p.phase);
      p.s.alpha = alpha * p.a;
    }
  }
}
