// 表情、粒子贴图（Canvas 程序绘制）；道具和道具特效的贴图在 propArt.ts。
import { Texture } from 'pixi.js';
import { PROP_PARTICLES } from './propArt';

export { propTexture } from './propArt';

const RES = 2;

/** 圆角矩形路径（兼容不支持 ctx.roundRect 的旧浏览器） */
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w * RES; c.height = h * RES;
  const g = c.getContext('2d')!;
  g.scale(RES, RES);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return { c, g };
}

// ---------- 表情（96×96） ----------

function face(g: CanvasRenderingContext2D, color: [string, string] = ['#ffe873', '#f6a92a']) {
  const grad = g.createRadialGradient(40, 34, 6, 48, 48, 46);
  grad.addColorStop(0, color[0]);
  grad.addColorStop(1, color[1]);
  g.fillStyle = grad;
  g.beginPath(); g.arc(48, 48, 42, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(150,80,0,0.55)'; g.lineWidth = 2.5; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.ellipse(36, 24, 16, 8, -0.4, 0, Math.PI * 2); g.fill();
}

const INK = '#5a2e05';

function eyes(g: CanvasRenderingContext2D, y = 40, r = 5) {
  g.fillStyle = INK;
  for (const x of [34, 62]) { g.beginPath(); g.ellipse(x, y, r * 0.8, r * 1.2, 0, 0, Math.PI * 2); g.fill(); }
}

function arcLine(g: CanvasRenderingContext2D, x: number, y: number, r: number, a0: number, a1: number, w = 4, color = INK) {
  g.strokeStyle = color; g.lineWidth = w;
  g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
}

function heartPath(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.35);
  g.bezierCurveTo(cx - s * 0.6, cy - s * 0.1, cx - s * 0.35, cy - s * 0.65, cx, cy - s * 0.3);
  g.bezierCurveTo(cx + s * 0.35, cy - s * 0.65, cx + s * 0.6, cy - s * 0.1, cx, cy + s * 0.35);
}

function tear(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = '#5ec8ff';
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x + s * 0.8, y + s * 0.2, x, y + s * 0.6);
  g.quadraticCurveTo(x - s * 0.8, y + s * 0.2, x, y - s);
  g.fill();
}

const EMOJI_DRAW: ((g: CanvasRenderingContext2D) => void)[] = [
  // 0 微笑
  (g) => { face(g); eyes(g); arcLine(g, 48, 50, 18, 0.2 * Math.PI, 0.8 * Math.PI); g.fillStyle = 'rgba(255,120,120,0.45)'; g.beginPath(); g.arc(26, 56, 6, 0, 7); g.arc(70, 56, 6, 0, 7); g.fill(); },
  // 1 大笑（笑出泪）
  (g) => {
    face(g);
    arcLine(g, 34, 42, 7, 1.1 * Math.PI, 1.9 * Math.PI); arcLine(g, 62, 42, 7, 1.1 * Math.PI, 1.9 * Math.PI);
    g.fillStyle = INK; g.beginPath(); g.moveTo(26, 54); g.quadraticCurveTo(48, 90, 70, 54); g.closePath(); g.fill();
    g.fillStyle = '#ff6b6b'; g.beginPath(); g.ellipse(48, 72, 10, 5, 0, 0, Math.PI * 2); g.fill();
    tear(g, 18, 48, 9); tear(g, 78, 48, 9);
  },
  // 2 大哭
  (g) => {
    face(g);
    arcLine(g, 34, 44, 7, 1.15 * Math.PI, 1.85 * Math.PI); arcLine(g, 62, 44, 7, 1.15 * Math.PI, 1.85 * Math.PI);
    g.fillStyle = INK; g.beginPath(); g.ellipse(48, 70, 12, 9, 0, Math.PI, 0); g.fill();
    g.fillStyle = 'rgba(94,200,255,0.85)'; g.fillRect(28, 46, 8, 34); g.fillRect(60, 46, 8, 34);
  },
  // 3 生气
  (g) => {
    face(g, ['#ff9a6b', '#e2382b']);
    g.strokeStyle = INK; g.lineWidth = 5;
    g.beginPath(); g.moveTo(24, 30); g.lineTo(42, 38); g.moveTo(72, 30); g.lineTo(54, 38); g.stroke();
    eyes(g, 46, 4.5);
    arcLine(g, 48, 78, 14, 1.2 * Math.PI, 1.8 * Math.PI);
    g.strokeStyle = '#c4161c'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(72, 12); g.lineTo(80, 20); g.moveTo(80, 12); g.lineTo(72, 20); g.stroke();
  },
  // 4 流汗
  (g) => {
    face(g);
    g.strokeStyle = INK; g.lineWidth = 4;
    g.beginPath(); g.moveTo(26, 40); g.lineTo(40, 42); g.moveTo(56, 42); g.lineTo(70, 40); g.stroke();
    g.beginPath(); g.moveTo(36, 66); g.quadraticCurveTo(48, 60, 60, 66); g.stroke();
    tear(g, 76, 26, 10);
  },
  // 5 酷（墨镜）
  (g) => {
    face(g);
    g.fillStyle = '#1b1b1b';
    g.beginPath(); rr(g, 18, 32, 26, 16, 6); rr(g, 52, 32, 26, 16, 6); g.fill();
    g.fillRect(40, 36, 16, 4);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(22, 35, 8, 3); g.fillRect(56, 35, 8, 3);
    arcLine(g, 52, 54, 16, 0.25 * Math.PI, 0.7 * Math.PI);
  },
  // 6 惊讶
  (g) => {
    face(g);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(34, 40, 9, 0, 7); g.arc(62, 40, 9, 0, 7); g.fill();
    g.fillStyle = INK; g.beginPath(); g.arc(34, 40, 4, 0, 7); g.arc(62, 40, 4, 0, 7); g.fill();
    g.beginPath(); g.ellipse(48, 68, 8, 11, 0, 0, Math.PI * 2); g.fill();
  },
  // 7 喜欢（爱心眼）
  (g) => {
    face(g);
    g.fillStyle = '#ff3b5c';
    heartPath(g, 33, 42, 22); g.fill(); heartPath(g, 63, 42, 22); g.fill();
    arcLine(g, 48, 52, 16, 0.2 * Math.PI, 0.8 * Math.PI);
  },
  // 8 困
  (g) => {
    face(g);
    arcLine(g, 34, 40, 7, 0.1 * Math.PI, 0.9 * Math.PI); arcLine(g, 62, 40, 7, 0.1 * Math.PI, 0.9 * Math.PI);
    g.fillStyle = INK; g.beginPath(); g.ellipse(48, 66, 6, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5a8cff'; g.font = '900 20px Arial'; g.fillText('Z', 68, 22); g.font = '900 14px Arial'; g.fillText('z', 82, 10);
  },
  // 9 得意（眨眼）
  (g) => {
    face(g);
    g.fillStyle = INK; g.beginPath(); g.ellipse(34, 40, 4, 6, 0, 0, Math.PI * 2); g.fill();
    arcLine(g, 62, 44, 7, 1.1 * Math.PI, 1.9 * Math.PI);
    g.strokeStyle = INK; g.lineWidth = 4; g.beginPath(); g.moveTo(34, 62); g.quadraticCurveTo(52, 72, 66, 58); g.stroke();
    g.fillStyle = '#ff6b6b'; g.beginPath(); g.ellipse(58, 68, 6, 4, 0.3, 0, Math.PI * 2); g.fill();
  },
  // 10 亲亲
  (g) => {
    face(g);
    arcLine(g, 34, 42, 6, 1.1 * Math.PI, 1.9 * Math.PI); eyes(g, 40, 0.01);
    g.fillStyle = INK; g.beginPath(); g.ellipse(34, 40, 4, 5, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = 4;
    g.beginPath(); g.moveTo(44, 58); g.quadraticCurveTo(54, 62, 46, 66); g.quadraticCurveTo(54, 70, 44, 74); g.stroke();
    g.fillStyle = '#ff3b5c'; heartPath(g, 74, 62, 20); g.fill();
  },
  // 11 晕
  (g) => {
    face(g);
    g.strokeStyle = INK; g.lineWidth = 3;
    for (const x of [34, 62]) {
      g.beginPath();
      for (let a = 0; a < Math.PI * 5; a += 0.2) {
        const r = a * 1.1;
        const px = x + Math.cos(a) * r, py = 40 + Math.sin(a) * r;
        if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    }
    g.lineWidth = 4; g.beginPath(); g.moveTo(34, 68); g.quadraticCurveTo(41, 62, 48, 68); g.quadraticCurveTo(55, 74, 62, 68); g.stroke();
  },
];

let emojiTex: Texture[] | null = null;
export function emojiTexture(i: number): Texture {
  emojiTex ??= EMOJI_DRAW.map((draw) => { const { c, g } = canvas(96); draw(g); return Texture.from(c); });
  return emojiTex[i];
}

// ---------- 粒子 ----------

const PARTICLES = {
  ...PROP_PARTICLES,
  glow: () => {
    const { c, g } = canvas(64);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  },
  star: () => {
    const { c, g } = canvas(48);
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 9 : 22;
      g.lineTo(24 + Math.cos(a) * r, 24 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    return c;
  },
  smoke: () => {
    const { c, g } = canvas(64);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(120,110,100,0.32)'); gr.addColorStop(1, 'rgba(120,110,100,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  },
  rect: () => {
    const { c, g } = canvas(16, 10);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 16, 10);
    return c;
  },
  foam: () => {
    // 奶泡：中心亮、边缘柔和，带一点米黄的暗部
    const { c, g } = canvas(24);
    const gr = g.createRadialGradient(9, 9, 1, 12, 12, 11);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,248,228,0.95)'); gr.addColorStop(0.85, 'rgba(236,218,178,0.8)'); gr.addColorStop(1, 'rgba(236,218,178,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(12, 12, 11, 0, 7); g.fill();
    return c;
  },
};
const particleCache = new Map<string, Texture>();
export function particleTexture(key: keyof typeof PARTICLES): Texture {
  let t = particleCache.get(key);
  if (!t) { t = Texture.from(PARTICLES[key]()); particleCache.set(key, t); }
  return t;
}
export type ParticleKind = keyof typeof PARTICLES;
