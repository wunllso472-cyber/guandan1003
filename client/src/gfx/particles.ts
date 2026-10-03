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
      s.position.set(o.x, o.y);
      s.scale.set(rnd(o.scale ?? [0.4, 0.8]));
      s.rotation = Math.random() * Math.PI * 2;
      if (o.colors) s.tint = o.colors[Math.floor(Math.random() * o.colors.length)];
      if (o.blend === 'add') s.blendMode = 'add';
      const a = rnd([a0, a1]);
      const v = rnd(o.speed);
      this.addChild(s);
      this.list.push({
        s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.gravity ?? 0,
        life: rnd(o.life ?? [600, 1100]), age: 0, spin: (Math.random() - 0.5) * (o.spin ?? 6),
        grow: o.grow ?? 0, fade: true,
      });
    }
  }

  private update(t: Ticker) {
    const dt = Math.min(50, t.deltaMS) / 1000;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt * 1000;
      if (p.age >= p.life) { p.s.destroy(); this.list.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      if (p.grow) p.s.scale.set(p.s.scale.x * (1 + p.grow * dt));
      const k = p.age / p.life;
      p.s.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
  }
}
