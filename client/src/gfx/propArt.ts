// 互动道具的美术（Canvas 程序绘制，128×128 逻辑尺寸、2 倍分辨率）：道具本体和道具特效专用的粒子贴图。
// 粒子贴图大多画成白色/灰度，用 tint 上色，一张贴图可以出多种颜色。
import { Texture } from 'pixi.js';

const RES = 2;
const TAU = Math.PI * 2;

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w * RES; c.height = h * RES;
  const g = c.getContext('2d')!;
  g.scale(RES, RES);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return { c, g };
}

/** 圆角矩形路径（兼容不支持 ctx.roundRect 的旧浏览器） */
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function heartPath(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.36);
  g.bezierCurveTo(cx - s * 0.62, cy - s * 0.08, cx - s * 0.36, cy - s * 0.66, cx, cy - s * 0.3);
  g.bezierCurveTo(cx + s * 0.36, cy - s * 0.66, cx + s * 0.62, cy - s * 0.08, cx, cy + s * 0.36);
  g.closePath();
}

function radial(g: CanvasRenderingContext2D, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, stops: [number, string][]) {
  const gr = g.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function linear(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

/** 椭圆高光 */
function shine(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, a = 0.7) {
  g.fillStyle = radial(g, x, y, 0, x, y, Math.max(rx, ry), [[0, `rgba(255,255,255,${a})`], [1, 'rgba(255,255,255,0)']]);
  g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill();
}

// ---------- 道具本体 ----------

/** 一朵玫瑰（俯视）：底色 + 层层花瓣 + 中心卷 */
function rose(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.fillStyle = radial(g, cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r, [[0, '#ff6b86'], [0.55, '#e01640'], [1, '#8f0022']]);
  g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  // 外层花瓣：一圈月牙
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    g.fillStyle = 'rgba(255,120,145,0.35)';
    g.strokeStyle = 'rgba(110,0,28,0.55)'; g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, r * 0.62, r * 0.36, a + Math.PI / 2, Math.PI * 0.05, Math.PI * 0.95); g.fill(); g.stroke();
  }
  // 中心螺旋
  g.strokeStyle = 'rgba(100,0,25,0.75)'; g.lineWidth = 1.6;
  for (let k = 0; k < 3; k++) {
    const rr2 = r * (0.48 - k * 0.14);
    g.beginPath(); g.arc(cx + k, cy - k, rr2, 0.4 + k * 1.7, 0.4 + k * 1.7 + Math.PI * 1.3); g.stroke();
  }
  shine(g, cx - r * 0.38, cy - r * 0.42, r * 0.32, r * 0.18, -0.6, 0.55);
}

function drawBouquet(g: CanvasRenderingContext2D) {
  // 包装纸后片
  g.fillStyle = linear(g, 16, 0, 112, 0, [[0, '#c9688b'], [0.5, '#e892b0'], [1, '#c4648a']]);
  g.beginPath(); g.moveTo(14, 50); g.lineTo(64, 36); g.lineTo(114, 50); g.lineTo(64, 124); g.closePath(); g.fill();
  // 叶子
  g.fillStyle = linear(g, 0, 30, 0, 70, [[0, '#5fd36b'], [1, '#1f7a32']]);
  for (const [x, y, a] of [[24, 50, -0.9], [104, 50, 0.9], [36, 30, -0.4], [94, 30, 0.4], [64, 22, 0]] as const) {
    g.save(); g.translate(x, y); g.rotate(a);
    g.beginPath(); g.ellipse(0, 0, 7, 17, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,60,10,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 14); g.stroke();
    g.restore();
  }
  // 满天星
  for (const [x, y] of [[20, 40], [30, 26], [100, 28], [110, 42], [50, 20], [80, 18], [64, 12], [16, 54], [112, 56]]) {
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + x;
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.2, 0, TAU); g.fill();
    }
    g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(x, y, 1.4, 0, TAU); g.fill();
  }
  rose(g, 42, 48, 17);
  rose(g, 86, 48, 17);
  rose(g, 64, 34, 19);
  // 包装纸前片
  g.fillStyle = linear(g, 20, 0, 108, 0, [[0, '#ffd3e1'], [0.45, '#fff0f5'], [0.55, '#ffe3ec'], [1, '#f5b5ca']]);
  g.beginPath(); g.moveTo(20, 60); g.quadraticCurveTo(64, 74, 108, 60); g.lineTo(64, 124); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(190,80,120,0.55)'; g.lineWidth = 1.5; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(48, 70); g.lineTo(62, 118); g.stroke();
  // 蝴蝶结
  const bow = linear(g, 0, 84, 0, 104, [[0, '#ffe680'], [1, '#e8a317']]);
  g.fillStyle = bow; g.strokeStyle = '#a86b00'; g.lineWidth = 1.5;
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(64, 94);
    g.bezierCurveTo(64 + s * 8, 80, 64 + s * 24, 82, 64 + s * 22, 94);
    g.bezierCurveTo(64 + s * 20, 104, 64 + s * 8, 100, 64, 94); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(64, 95); g.lineTo(64 + s * 12, 114); g.lineTo(64 + s * 6, 112); g.lineTo(64 + s * 3, 116); g.lineTo(64, 96); g.fill(); g.stroke();
  }
  g.beginPath(); g.arc(64, 94, 5, 0, TAU); g.fill(); g.stroke();
}

function drawHeart(g: CanvasRenderingContext2D) {
  heartPath(g, 64, 70, 124);
  g.fillStyle = radial(g, 44, 42, 4, 64, 66, 70, [[0, '#ffb3c3'], [0.35, '#ff3d64'], [0.8, '#d10f3c'], [1, '#8c0024']]);
  g.fill();
  g.save(); heartPath(g, 64, 70, 124); g.clip();
  // 右下的暗部和边缘反光，显得饱满
  g.fillStyle = radial(g, 92, 104, 0, 92, 104, 46, [[0, 'rgba(70,0,20,0.45)'], [1, 'rgba(70,0,20,0)']]);
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,190,205,0.6)'; g.lineWidth = 5;
  heartPath(g, 64, 72, 112); g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(110,0,30,0.6)'; g.lineWidth = 2;
  heartPath(g, 64, 70, 124); g.stroke();
  shine(g, 40, 40, 15, 9, -0.6, 0.9);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(55, 33, 3, 0, TAU); g.fill();
}

function drawBeer(g: CanvasRenderingContext2D) {
  // 把手
  g.strokeStyle = 'rgba(225,240,255,0.95)'; g.lineWidth = 9;
  g.beginPath(); rr(g, 84, 50, 30, 46, 14); g.stroke();
  g.strokeStyle = 'rgba(120,150,180,0.6)'; g.lineWidth = 2;
  g.beginPath(); rr(g, 88.5, 54.5, 21, 37, 10); g.stroke();
  // 杯身（玻璃）
  g.fillStyle = 'rgba(220,240,255,0.35)';
  g.beginPath(); rr(g, 26, 36, 64, 80, 9); g.fill();
  // 啤酒
  g.fillStyle = linear(g, 0, 44, 0, 110, [[0, '#ffd75e'], [0.5, '#f8a514'], [1, '#c96a00']]);
  g.beginPath(); rr(g, 31, 44, 54, 64, 6); g.fill();
  // 气泡
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (const [x, y, r] of [[40, 96, 2], [48, 80, 1.6], [70, 92, 2.2], [62, 70, 1.5], [76, 60, 1.8], [44, 62, 1.3], [56, 100, 1.5]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  // 玻璃反光和杯底
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.beginPath(); rr(g, 36, 46, 6, 58, 3); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.beginPath(); rr(g, 76, 48, 4, 54, 2); g.fill();
  g.fillStyle = 'rgba(230,245,255,0.75)';
  g.beginPath(); rr(g, 28, 106, 60, 9, 4); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3;
  g.beginPath(); rr(g, 26, 36, 64, 80, 9); g.stroke();
  g.strokeStyle = 'rgba(90,110,130,0.5)'; g.lineWidth = 1.2;
  g.beginPath(); rr(g, 24.5, 34.5, 67, 83, 10); g.stroke();
  // 泡沫：一团奶油色的云，边上挂两滴
  for (const [x, y, r] of [[30, 38, 11], [44, 30, 13], [60, 26, 14], [76, 30, 13], [88, 38, 10], [38, 42, 9], [66, 40, 11], [52, 42, 9]]) {
    g.fillStyle = radial(g, x - r * 0.3, y - r * 0.4, 1, x, y, r, [[0, '#ffffff'], [0.7, '#fff6e0'], [1, '#ecd9b0']]);
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  g.fillStyle = '#fff6e0';
  for (const [x, y] of [[34, 50], [80, 48]]) {
    g.beginPath(); g.moveTo(x - 4, y - 6); g.quadraticCurveTo(x - 4, y + 4, x, y + 6); g.quadraticCurveTo(x + 4, y + 4, x + 4, y - 6); g.fill();
  }
}

function drawEgg(g: CanvasRenderingContext2D) {
  g.fillStyle = radial(g, 50, 44, 4, 64, 66, 54, [[0, '#ffffff'], [0.6, '#f7ecd6'], [1, '#d8bf93']]);
  g.beginPath(); g.moveTo(64, 14);
  g.bezierCurveTo(98, 14, 108, 78, 100, 96); g.bezierCurveTo(90, 120, 38, 120, 28, 96); g.bezierCurveTo(20, 78, 30, 14, 64, 14);
  g.fill();
  g.strokeStyle = 'rgba(160,120,70,0.6)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = 'rgba(170,130,80,0.35)';
  for (const [x, y] of [[74, 60], [56, 84], [84, 86], [48, 56], [70, 100]]) { g.beginPath(); g.arc(x, y, 1.6, 0, TAU); g.fill(); }
  shine(g, 48, 40, 12, 18, -0.4, 0.85);
}

function drawSplat(g: CanvasRenderingContext2D) {
  // 蛋清：不规则的半透明一摊，带往下流的两道
  g.fillStyle = 'rgba(255,255,248,0.88)';
  g.beginPath();
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * TAU;
    const r = 44 + (i % 2 ? 9 : -5) + Math.sin(i * 2.7) * 5;
    const x = 64 + Math.cos(a) * r, y = 60 + Math.sin(a) * r * 0.82;
    if (i === 0) g.moveTo(x, y); else g.quadraticCurveTo(64 + Math.cos(a - 0.17) * (r + 8), 60 + Math.sin(a - 0.17) * (r + 8) * 0.82, x, y);
  }
  g.closePath(); g.fill();
  for (const [x, len] of [[44, 26], [82, 34]]) {
    g.beginPath(); g.moveTo(x - 6, 92); g.lineTo(x - 4, 92 + len); g.arc(x, 92 + len, 4.5, Math.PI, 0, true); g.lineTo(x + 6, 92); g.fill();
  }
  g.strokeStyle = 'rgba(200,200,190,0.6)'; g.lineWidth = 1.5; g.stroke();
  shine(g, 40, 40, 16, 8, -0.5, 0.8);
  // 蛋黄
  g.fillStyle = radial(g, 58, 54, 2, 64, 62, 22, [[0, '#fff3a6'], [0.45, '#ffc21a'], [1, '#e67e00']]);
  g.beginPath(); g.ellipse(64, 62, 21, 19, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(180,90,0,0.5)'; g.lineWidth = 1.5; g.stroke();
  shine(g, 57, 54, 7, 4, -0.5, 0.95);
  // 粘着的蛋壳
  g.fillStyle = '#f3e4c4'; g.strokeStyle = 'rgba(150,110,60,0.7)'; g.lineWidth = 1.2;
  for (const [x, y, a, s] of [[18, 40, 0.4, 1], [108, 74, -0.6, 1.2], [100, 24, 1.2, 0.9], [26, 86, 2.2, 0.8]] as const) {
    g.save(); g.translate(x, y); g.rotate(a); g.scale(s, s);
    g.beginPath(); g.moveTo(-10, 0); g.lineTo(-3, -7); g.lineTo(2, -3); g.lineTo(9, -6); g.lineTo(7, 4); g.lineTo(-2, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}

function drawBomb(g: CanvasRenderingContext2D) {
  // 引线
  g.strokeStyle = '#7a5428'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(88, 36); g.bezierCurveTo(96, 20, 104, 22, 110, 12); g.stroke();
  g.strokeStyle = '#d9b27a'; g.lineWidth = 1.5; g.setLineDash([3, 4]);
  g.beginPath(); g.moveTo(88, 36); g.bezierCurveTo(96, 20, 104, 22, 110, 12); g.stroke();
  g.setLineDash([]);
  // 弹体
  g.fillStyle = radial(g, 42, 56, 4, 56, 74, 46, [[0, '#8a90a8'], [0.35, '#3a3e50'], [1, '#08090d']]);
  g.beginPath(); g.arc(56, 74, 42, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(150,170,220,0.35)'; g.lineWidth = 3;
  g.beginPath(); g.arc(56, 74, 39, Math.PI * 0.15, Math.PI * 0.75); g.stroke();
  // 引信座
  g.save(); g.translate(84, 40); g.rotate(0.65);
  g.fillStyle = linear(g, -11, 0, 11, 0, [[0, '#3b3f4f'], [0.5, '#a8afc4'], [1, '#2a2d38']]);
  g.beginPath(); rr(g, -11, -8, 22, 16, 3); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 1.5; g.stroke();
  g.restore();
  shine(g, 38, 54, 14, 9, -0.7, 0.75);
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(32, 50, 3, 0, TAU); g.fill();
  // 引线头的火光
  g.fillStyle = radial(g, 110, 12, 0, 110, 12, 12, [[0, 'rgba(255,255,220,1)'], [0.4, 'rgba(255,200,60,0.9)'], [1, 'rgba(255,120,0,0)']]);
  g.beginPath(); g.arc(110, 12, 12, 0, TAU); g.fill();
}

/** 被炸后熏黑的一团（盖在头像上） */
function drawSoot(g: CanvasRenderingContext2D) {
  for (const [x, y, r, a] of [[64, 64, 52, 0.75], [44, 50, 26, 0.6], [86, 56, 24, 0.6], [56, 86, 24, 0.55], [84, 84, 22, 0.5], [64, 40, 22, 0.5]]) {
    g.fillStyle = radial(g, x, y, 0, x, y, r, [[0, `rgba(18,16,14,${a})`], [0.7, `rgba(30,26,22,${a * 0.6})`], [1, 'rgba(30,26,22,0)']]);
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  // 几点火星残留
  for (const [x, y] of [[40, 70], [90, 46], [72, 96]]) {
    g.fillStyle = radial(g, x, y, 0, x, y, 4, [[0, 'rgba(255,170,60,0.9)'], [1, 'rgba(255,90,0,0)']]);
    g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill();
  }
}

const PROP_DRAW: Record<string, (g: CanvasRenderingContext2D) => void> = {
  flower: drawBouquet, heart: drawHeart, beer: drawBeer, egg: drawEgg, splat: drawSplat, bomb: drawBomb, soot: drawSoot,
};
const propCache = new Map<string, Texture>();
/** 道具贴图（128×128 逻辑尺寸） */
export function propTexture(key: string): Texture {
  let t = propCache.get(key);
  if (!t) {
    const { c, g } = canvas(128);
    PROP_DRAW[key](g);
    t = Texture.from(c);
    propCache.set(key, t);
  }
  return t;
}

// ---------- 道具特效粒子（白色/灰度，用 tint 上色） ----------

export const PROP_PARTICLES = {
  /** 四角闪光 */
  sparkle: () => {
    const { c, g } = canvas(64);
    g.fillStyle = radial(g, 32, 32, 0, 32, 32, 20, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#fff';
    for (const rot of [0, Math.PI / 2]) {
      g.save(); g.translate(32, 32); g.rotate(rot);
      g.beginPath(); g.moveTo(0, -30); g.quadraticCurveTo(2.5, 0, 0, 30); g.quadraticCurveTo(-2.5, 0, 0, -30); g.fill();
      g.restore();
    }
    return c;
  },
  /** 拖尾火花（横向，配合 alignVel 沿速度方向） */
  streak: () => {
    const { c, g } = canvas(64, 16);
    g.fillStyle = linear(g, 0, 0, 64, 0, [[0, 'rgba(255,255,255,0)'], [0.75, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,1)']]);
    g.beginPath(); g.ellipse(32, 8, 31, 4, 0, 0, TAU); g.fill();
    return c;
  },
  /** 冲击波光环 */
  ring: () => {
    const { c, g } = canvas(128);
    g.shadowColor = '#fff'; g.shadowBlur = 10;
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 6;
    g.beginPath(); g.arc(64, 64, 54, 0, TAU); g.stroke();
    return c;
  },
  /** 花瓣（灰度，tint 成红/粉） */
  petal: () => {
    const { c, g } = canvas(32);
    g.fillStyle = linear(g, 6, 6, 26, 26, [[0, '#ffffff'], [0.6, '#e6e6e6'], [1, '#a8a8a8']]);
    g.beginPath(); g.moveTo(16, 3); g.bezierCurveTo(30, 8, 28, 26, 16, 29); g.bezierCurveTo(4, 26, 2, 8, 16, 3); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(16, 7); g.quadraticCurveTo(14, 16, 16, 25); g.stroke();
    return c;
  },
  /** 小爱心（灰度，tint 成粉/红） */
  heart: () => {
    const { c, g } = canvas(40);
    heartPath(g, 20, 22, 38);
    g.fillStyle = radial(g, 14, 14, 1, 20, 20, 22, [[0, '#ffffff'], [0.5, '#f0f0f0'], [1, '#b0b0b0']]);
    g.fill();
    shine(g, 13, 13, 4, 2.6, -0.6, 0.95);
    return c;
  },
  /** 气泡 */
  bubble: () => {
    const { c, g } = canvas(32);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.arc(16, 16, 13, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(11, 11, 3, 0, TAU); g.fill();
    return c;
  },
  /** 蛋壳碎片 */
  shard: () => {
    const { c, g } = canvas(32);
    g.fillStyle = linear(g, 4, 4, 28, 28, [[0, '#fffaf0'], [1, '#e2cfa8']]);
    g.strokeStyle = 'rgba(150,110,60,0.8)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(4, 18); g.lineTo(12, 6); g.lineTo(18, 12); g.lineTo(28, 8); g.lineTo(24, 24); g.lineTo(10, 26); g.closePath(); g.fill(); g.stroke();
    return c;
  },
  /** 蛋黄滴（不上色） */
  yolk: () => {
    const { c, g } = canvas(24, 32);
    g.fillStyle = radial(g, 9, 18, 1, 12, 20, 12, [[0, '#fff3a6'], [0.5, '#ffc21a'], [1, '#e67e00']]);
    g.beginPath(); g.moveTo(12, 2); g.bezierCurveTo(16, 12, 22, 16, 22, 21); g.arc(12, 21, 10, 0, Math.PI); g.bezierCurveTo(2, 16, 8, 12, 12, 2); g.fill();
    shine(g, 9, 18, 3, 2, -0.5, 0.9);
    return c;
  },
  /** 爆炸碎屑（不上色） */
  debris: () => {
    const { c, g } = canvas(24);
    g.fillStyle = linear(g, 0, 0, 24, 24, [[0, '#5a5a66'], [1, '#141418']]);
    g.beginPath(); g.moveTo(3, 10); g.lineTo(10, 3); g.lineTo(20, 6); g.lineTo(21, 17); g.lineTo(11, 21); g.closePath(); g.fill();
    return c;
  },
};
