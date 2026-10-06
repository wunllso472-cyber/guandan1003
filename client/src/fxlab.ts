// 开发用：互动道具特效预览页（client/fxlab.html，不参与构建）。四个座位，按钮依次扔各种道具。
import { Application, Container, Graphics, Point, Text, Ticker } from 'pixi.js';
import { PROPS } from '@shared/chat';
import { PropFx } from './scene/PropFx';

const W = 1280, H = 720;
const app = new Application();
await app.init({ width: W, height: H, antialias: true, background: '#1d6b3c', resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
document.body.appendChild(app.canvas);
const root = new Container();
app.stage.addChild(root);
const seats = [new Point(W / 2, H - 110), new Point(W - 110, H / 2), new Point(W / 2, 110), new Point(110, H / 2)];
for (const [i, p] of seats.entries()) {
  const g = new Graphics().circle(0, 0, 47).fill({ color: i % 2 ? 0x5aa8ff : 0xf5c34a }).circle(0, 0, 42).fill({ color: 0xd06a9a });
  const t = new Text({ text: '座位' + i, style: { fontSize: 18, fill: 0xffffff, fontWeight: '700' } });
  t.anchor.set(0.5);
  g.position.copyFrom(p);
  t.position.set(p.x, p.y + 64);
  root.addChild(g, t);
}
const shake = (st: number, ms: number) => {
  const end = performance.now() + ms;
  const step = () => { const left = end - performance.now(); if (left <= 0) { root.position.set(0, 0); return; } root.position.set((Math.random() - 0.5) * st * 2, (Math.random() - 0.5) * st * 2); requestAnimationFrame(step); };
  step();
};
const fx = new PropFx({ seatPos: (s) => seats[s].clone(), shakeHud: () => undefined, shake, bounds: () => ({ w: W, h: H }) });
root.addChild(fx);

const w = window as unknown as { fx: (key: string, from?: number, to?: number) => void; freezeAt: (ms: number) => void; resume: () => void };
w.fx = (key, from = 0, to = 2) => void fx.play(from, to, key);
w.freezeAt = (ms) => setTimeout(() => Ticker.shared.stop(), ms);
w.resume = () => Ticker.shared.start();
const bar = document.getElementById('bar')!;
for (const p of PROPS) {
  const b = document.createElement('button');
  b.textContent = p.name;
  b.onclick = () => { w.resume(); w.fx(p.key); };
  bar.appendChild(b);
}
