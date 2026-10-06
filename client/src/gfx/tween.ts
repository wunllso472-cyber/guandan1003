import { Ticker } from 'pixi.js';

type Ease = (t: number) => number;
export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

interface Active {
  target: any;
  from: Record<string, number>;
  to: Record<string, number>;
  dur: number;
  t: number;
  delay: number;
  ease: Ease;
  resolve: () => void;
}

const active: Active[] = [];
let started = false;

function tick(ticker: Ticker) {
  const dt = ticker.deltaMS;
  for (let i = active.length - 1; i >= 0; i--) {
    const a = active[i];
    if (a.target.destroyed) { active.splice(i, 1); a.resolve(); continue; }
    if (a.delay > 0) {
      a.delay -= dt;
      if (a.delay > 0) continue;
      for (const k in a.to) a.from[k] = getProp(a.target, k);
    }
    a.t = Math.min(1, a.t + dt / a.dur);
    const e = a.ease(a.t);
    for (const k in a.to) setProp(a.target, k, a.from[k] + (a.to[k] - a.from[k]) * e);
    if (a.t >= 1) { active.splice(i, 1); a.resolve(); }
  }
}

function getProp(o: any, k: string): number {
  if (k === 'scale') return o.scale.x;
  return o[k];
}
function setProp(o: any, k: string, v: number) {
  if (k === 'scale') o.scale.set(v);
  else o[k] = v;
}

/** 把 target 的数值属性补间到 to；同一对象的同名属性会被新补间覆盖。 */
export function tween(target: any, to: Record<string, number>, dur = 250, opts: { delay?: number; ease?: Ease } = {}): Promise<void> {
  if (!started) { Ticker.shared.add(tick); started = true; }
  // 对象已销毁（例如离开牌桌后仍在排队的动画）时直接结束
  if (!target || target.destroyed) return Promise.resolve();
  for (let i = active.length - 1; i >= 0; i--) {
    const a = active[i];
    if (a.target !== target) continue;
    for (const k in to) delete a.to[k];
    if (!Object.keys(a.to).length) { active.splice(i, 1); a.resolve(); }
  }
  return new Promise((resolve) => {
    const from: Record<string, number> = {};
    for (const k in to) from[k] = getProp(target, k);
    active.push({ target, from, to: { ...to }, dur: Math.max(1, dur), t: 0, delay: opts.delay ?? 0, ease: opts.ease ?? ease.outCubic, resolve });
  });
}

/** 只取消指定属性的补间（其余属性继续），例如重新排版时取消位置动画但保留淡入 */
export function killTweenProps(target: any, keys: string[]) {
  for (let i = active.length - 1; i >= 0; i--) {
    const a = active[i];
    if (a.target !== target) continue;
    for (const k of keys) delete a.to[k];
    if (!Object.keys(a.to).length) { active.splice(i, 1); a.resolve(); }
  }
}

export function killTweens(target: any) {
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i].target === target) { active[i].resolve(); active.splice(i, 1); }
  }
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 逐帧动画：dur 毫秒内每帧调用 fn(进度 0..1, 已过毫秒)；alive() 返回 false（如对象已销毁）时提前结束。
 */
export function frames(dur: number, fn: (t: number, ms: number) => void, alive: () => boolean = () => true): Promise<void> {
  return new Promise((resolve) => {
    let ms = 0;
    const step = (tk: Ticker) => {
      if (!alive()) { Ticker.shared.remove(step); resolve(); return; }
      ms = Math.min(dur, ms + tk.deltaMS);
      fn(ms / dur, ms);
      if (ms >= dur) { Ticker.shared.remove(step); resolve(); }
    };
    Ticker.shared.add(step);
  });
}
