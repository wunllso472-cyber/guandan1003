// 开发用：互动道具特效预览页（client/fxlab.html，不参与构建）。四个座位，按钮依次扔各种道具。
import { Application, Container, Graphics, Point, Text, Ticker } from 'pixi.js';
import { PROPS } from '@shared/chat';
import { PropFx } from './scene/PropFx';
import { TableFlip, setFlipRenderer } from './scene/TableFlip';
import { Sprite } from 'pixi.js';
import { propTexture } from './gfx/emoji';

const W = 1280, H = 720;
const app = new Application();
await app.init({ width: W, height: H, antialias: true, background: '#1d6b3c', resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
document.body.appendChild(app.canvas);
setFlipRenderer(app.renderer);
const root = new Container();
app.stage.addChild(root);
// 假桌面：绿呢 + 几张牌 + 四个座位（掀桌子时整体翻转）
const layer = new Container();
root.addChild(layer);
layer.addChild(new Graphics().rect(0, 0, W, H).fill({ color: 0x1d6b3c }).ellipse(W / 2, H / 2, 520, 250).stroke({ color: 0xffffff, alpha: 0.12, width: 4 }));
for (let i = 0; i < 5; i++) {
  const c = new Sprite(propTexture('flip'));
  c.anchor.set(0.5); c.width = c.height = 60; c.position.set(W / 2 - 120 + i * 60, H / 2);
  layer.addChild(c);
}
const seats = [new Point(W / 2, H - 110), new Point(W - 110, H / 2), new Point(W / 2, 110), new Point(110, H / 2)];
for (const [i, p] of seats.entries()) {
  const g = new Graphics().circle(0, 0, 47).fill({ color: i % 2 ? 0x5aa8ff : 0xf5c34a }).circle(0, 0, 42).fill({ color: 0xd06a9a });
  const t = new Text({ text: '座位' + i, style: { fontSize: 18, fill: 0xffffff, fontWeight: '700' } });
  t.anchor.set(0.5);
  g.position.copyFrom(p);
  t.position.set(p.x, p.y + 64);
  layer.addChild(g, t);
}
const shake = (st: number, ms: number) => {
  const end = performance.now() + ms;
  const step = () => { const left = end - performance.now(); if (left <= 0) { root.position.set(0, 0); return; } root.position.set((Math.random() - 0.5) * st * 2, (Math.random() - 0.5) * st * 2); requestAnimationFrame(step); };
  step();
};
const flipper = new TableFlip(layer, () => ({ w: W, h: H }));
// 自己坐 0 号位：0 号参与的掀桌才翻桌面
const fx = new PropFx({
  seatPos: (s) => seats[s].clone(), shakeHud: () => undefined, shake, bounds: () => ({ w: W, h: H }),
  flipTable: (from, to, onLand) => (from === 0 || to === 0 ? flipper.run(from, onLand) : Promise.resolve(false)),
});
root.addChild(fx);

const w = window as unknown as { fx: (key: string, from?: number, to?: number) => void; freezeAt: (ms: number) => void; resume: () => void; slow: (speed: number) => void };
w.fx = (key, from = 0, to = 2) => void fx.play(from, to, key);
w.freezeAt = (ms) => setTimeout(() => Ticker.shared.stop(), ms);
w.resume = () => Ticker.shared.start();
/** 慢放：Ticker 速度（1 为正常） */
w.slow = (speed) => { Ticker.shared.speed = speed; };
const bar = document.getElementById('bar')!;
for (const p of PROPS) {
  const b = document.createElement('button');
  b.textContent = p.name;
  b.onclick = () => { w.resume(); w.fx(p.key); };
  bar.appendChild(b);
}
