// 程序化绘制的美术资源：牌面、牌背、牌桌、头像。
import { Texture } from 'pixi.js';
import { DECK, type Suit, BIG_JOKER } from '@shared/cards';

export const CARD_W = 116;
export const CARD_H = 162;
const RES = 2; // 贴图分辨率倍数

export const FONT_UI = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
const FONT_RANK = '"Arial Black","Helvetica Neue",Arial,sans-serif';

const RED = '#d4231c';
const BLACK = '#161616';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * RES);
  c.height = Math.ceil(h * RES);
  const g = c.getContext('2d')!;
  g.scale(RES, RES);
  return { c, g };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 以 (cx,cy) 为中心、尺寸 s 画花色。 */
export function drawSuit(g: CanvasRenderingContext2D, suit: Suit, cx: number, cy: number, s: number) {
  g.save();
  g.translate(cx, cy);
  g.scale(s / 100, s / 100);
  g.beginPath();
  switch (suit) {
    case 'H':
      g.moveTo(0, 38);
      g.bezierCurveTo(-30, 12, -50, -6, -50, -24);
      g.bezierCurveTo(-50, -44, -32, -52, -22, -52);
      g.bezierCurveTo(-10, -52, -2, -44, 0, -34);
      g.bezierCurveTo(2, -44, 10, -52, 22, -52);
      g.bezierCurveTo(32, -52, 50, -44, 50, -24);
      g.bezierCurveTo(50, -6, 30, 12, 0, 38);
      g.fill();
      break;
    case 'D':
      g.moveTo(0, -52);
      g.quadraticCurveTo(18, -22, 40, 0);
      g.quadraticCurveTo(18, 22, 0, 52);
      g.quadraticCurveTo(-18, 22, -40, 0);
      g.quadraticCurveTo(-18, -22, 0, -52);
      g.fill();
      break;
    case 'S':
      g.moveTo(0, -52);
      g.bezierCurveTo(-28, -24, -50, -8, -50, 12);
      g.bezierCurveTo(-50, 30, -34, 38, -22, 38);
      g.bezierCurveTo(-12, 38, -5, 32, -3, 26);
      g.lineTo(-12, 52);
      g.lineTo(12, 52);
      g.lineTo(3, 26);
      g.bezierCurveTo(5, 32, 12, 38, 22, 38);
      g.bezierCurveTo(34, 38, 50, 30, 50, 12);
      g.bezierCurveTo(50, -8, 28, -24, 0, -52);
      g.fill();
      break;
    case 'C':
      g.arc(0, -26, 22, 0, Math.PI * 2);
      g.moveTo(-6, 12);
      g.arc(-24, 12, 22, 0, Math.PI * 2);
      g.moveTo(46, 12);
      g.arc(24, 12, 22, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(-6, 0);
      g.lineTo(6, 0);
      g.lineTo(13, 52);
      g.lineTo(-13, 52);
      g.closePath();
      g.fill();
      break;
  }
  g.restore();
}

function cardBase(g: CanvasRenderingContext2D) {
  const grad = g.createLinearGradient(0, 0, 0, CARD_H);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#efebe2');
  roundRect(g, 1, 1, CARD_W - 2, CARD_H - 2, 10);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = '#a69e8c';
  g.stroke();
}

function rankLabel(rank: number): string {
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[rank] ?? String(rank);
}

function drawCrown(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, color: string) {
  const h = w * 0.62;
  g.save();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(cx - w / 2, cy + h / 2);
  g.lineTo(cx - w / 2, cy - h / 4);
  g.lineTo(cx - w / 4, cy + h / 8);
  g.lineTo(cx, cy - h / 2);
  g.lineTo(cx + w / 4, cy + h / 8);
  g.lineTo(cx + w / 2, cy - h / 4);
  g.lineTo(cx + w / 2, cy + h / 2);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff6c8';
  for (const dx of [-w / 2, 0, w / 2]) {
    g.beginPath();
    g.arc(cx + dx, cy + (dx === 0 ? -h / 2 : -h / 4), w * 0.07, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawFace(id: number): HTMLCanvasElement {
  const { c, g } = canvas(CARD_W, CARD_H);
  const card = DECK[id];
  cardBase(g);
  if (card.suit === 'J') {
    const big = card.rank === BIG_JOKER;
    const color = big ? RED : BLACK;
    g.fillStyle = color;
    g.font = `900 17px ${FONT_RANK}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    'JOKER'.split('').forEach((ch, i) => g.fillText(ch, 15, 8 + i * 17));
    // 中央：皇冠 + 星形
    const cx = CARD_W / 2 + 10, cy = CARD_H / 2 + 14;
    const grad = g.createRadialGradient(cx, cy, 4, cx, cy, 44);
    grad.addColorStop(0, big ? '#ffe9a8' : '#e8e8e8');
    grad.addColorStop(1, big ? 'rgba(255,190,60,0)' : 'rgba(120,120,120,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, 46, 0, Math.PI * 2);
    g.fill();
    drawCrown(g, cx, cy - 16, 52, big ? '#e0a21b' : '#5b5b5b');
    g.fillStyle = color;
    g.font = `900 22px ${FONT_UI}`;
    g.fillText(big ? '大王' : '小王', cx, cy + 16);
    return c;
  }
  const color = card.suit === 'H' || card.suit === 'D' ? RED : BLACK;
  const label = rankLabel(card.rank);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.font = `900 ${label === '10' ? 30 : 34}px ${FONT_RANK}`;
  if (label === '10') {
    g.save();
    g.translate(21, 6);
    g.scale(0.78, 1);
    g.fillText('10', 0, 0);
    g.restore();
  } else g.fillText(label, 21, 5);
  drawSuit(g, card.suit, 21, 56, 24);

  if (card.rank >= 11 && card.rank <= 13) {
    drawCourt(g, card.rank, card.suit, color, label);
  } else if (card.rank === 14) {
    // A：花色外加一圈金色装饰环
    const cx = CARD_W / 2 + 10, cy = CARD_H / 2 + 18;
    g.strokeStyle = 'rgba(201,162,74,0.7)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, 40, 0, Math.PI * 2); g.stroke();
    g.setLineDash([3, 4]);
    g.beginPath(); g.arc(cx, cy, 45, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    drawSuit(g, card.suit, cx, cy, 58);
  } else {
    drawSuit(g, card.suit, CARD_W / 2 + 12, CARD_H / 2 + 22, 50);
  }
  return c;
}

/** 人头牌：双层金框 + 菱格底纹 + 皇冠 + 渐变大字母 */
function drawCourt(g: CanvasRenderingContext2D, rank: number, suit: Suit, color: string, label: string) {
  const x = 38, y = 28, w = CARD_W - 46, h = CARD_H - 38;
  const theme = rank === 13 ? ['#c9302c', '#7a1410'] : rank === 12 ? ['#8a4cc4', '#4a1f75'] : ['#2e6db5', '#163c70'];
  const bg = g.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, '#fff8e4');
  bg.addColorStop(1, '#f1d9a4');
  roundRect(g, x, y, w, h, 7);
  g.fillStyle = bg;
  g.fill();
  // 菱格底纹
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(190,140,50,0.18)';
  g.lineWidth = 1;
  for (let i = -h; i < w + h; i += 9) {
    g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i + h, y + h); g.stroke();
    g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + h, y); g.stroke();
  }
  // 下半部分的主题色衣襟
  const robe = g.createLinearGradient(0, y + h * 0.62, 0, y + h);
  robe.addColorStop(0, theme[0]);
  robe.addColorStop(1, theme[1]);
  g.fillStyle = robe;
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x, y + h * 0.78);
  g.quadraticCurveTo(x + w / 2, y + h * 0.58, x + w, y + h * 0.78);
  g.lineTo(x + w, y + h);
  g.closePath();
  g.fill();
  g.fillStyle = '#f6d27a';
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.arc(x + w * (0.18 + i * 0.16), y + h * 0.84 + (i % 2) * 6, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // 双层金框
  roundRect(g, x, y, w, h, 7);
  g.lineWidth = 2.5;
  g.strokeStyle = '#c9a24a';
  g.stroke();
  roundRect(g, x + 4, y + 4, w - 8, h - 8, 5);
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(160,110,30,0.6)';
  g.stroke();
  drawCrown(g, x + w / 2, y + 24, 36, theme[0]);
  // 渐变大字母
  const lg = g.createLinearGradient(0, y + 40, 0, y + 92);
  lg.addColorStop(0, color === RED ? '#ff4a3a' : '#3a3a3a');
  lg.addColorStop(1, color === RED ? '#9a0f0a' : '#000000');
  g.font = `900 52px Georgia,"Times New Roman",serif`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.lineWidth = 4;
  g.strokeStyle = '#fff6dc';
  g.strokeText(label, x + w / 2, y + 38);
  g.fillStyle = lg;
  g.fillText(label, x + w / 2, y + 38);
  g.fillStyle = '#fff8e4';
  g.beginPath();
  g.arc(x + w / 2, y + h - 17, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  drawSuit(g, suit, x + w / 2, y + h - 17, 16);
}

/** 牌的投影（放在牌下方） */
export function shadowTexture(): Texture {
  return (shadowTex ??= Texture.from((() => {
    const P = 14;
    const { c, g } = canvas(CARD_W + P * 2, CARD_H + P * 2);
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 10;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(g, P, P, CARD_W, CARD_H, 10);
    g.fill();
    return c;
  })()));
}
let shadowTex: Texture | null = null;
export const SHADOW_PAD = 14;

function drawBack(): HTMLCanvasElement {
  const { c, g } = canvas(CARD_W, CARD_H);
  roundRect(g, 1, 1, CARD_W - 2, CARD_H - 2, 10);
  g.fillStyle = '#fbf6ea';
  g.fill();
  roundRect(g, 6, 6, CARD_W - 12, CARD_H - 12, 7);
  const grad = g.createLinearGradient(0, 0, CARD_W, CARD_H);
  grad.addColorStop(0, '#b3202a');
  grad.addColorStop(1, '#7c0f18');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(255,214,120,0.35)';
  g.lineWidth = 1;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 10) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + CARD_H, CARD_H); g.stroke();
    g.beginPath(); g.moveTo(i, CARD_H); g.lineTo(i + CARD_H, 0); g.stroke();
  }
  g.restore();
  g.fillStyle = '#f6d27a';
  g.beginPath();
  g.arc(CARD_W / 2, CARD_H / 2, 24, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#8c1520';
  g.font = `900 28px ${FONT_UI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('掼', CARD_W / 2, CARD_H / 2 + 1);
  return c;
}

function drawBadge(text: string, bg: string): HTMLCanvasElement {
  const { c, g } = canvas(34, 34);
  const grad = g.createLinearGradient(0, 0, 0, 34);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, '#b26a00');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(17, 17, 15, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#fff3c4';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#fff';
  g.font = `900 17px ${FONT_UI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 17, 18);
  return c;
}

export function drawTable(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(w / 2, h * 0.42, 40, w / 2, h / 2, Math.max(w, h) * 0.7);
  grad.addColorStop(0, '#2f9a62');
  grad.addColorStop(0.55, '#1c7547');
  grad.addColorStop(1, '#0b3d23');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // 绒面噪点
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // 桌面装饰：双椭圆金线
  const cx = w / 2, cy = h * 0.44;
  g.strokeStyle = 'rgba(255,230,160,0.18)';
  g.lineWidth = 3;
  g.beginPath(); g.ellipse(cx, cy, w * 0.34, h * 0.3, 0, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.5;
  g.setLineDash([2, 7]);
  g.beginPath(); g.ellipse(cx, cy, w * 0.34 - 12, h * 0.3 - 12, 0, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  // 中心徽章：圆环 + 花瓣边 + 字样
  const R = h * 0.15;
  g.fillStyle = 'rgba(0,40,20,0.18)';
  g.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const r = R + 8 + Math.sin(a * 16) * 5;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.fill();
  g.strokeStyle = 'rgba(255,230,160,0.2)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(cx, cy, R - 8, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,240,190,0.13)';
  g.font = `900 ${Math.round(R * 0.62)}px ${FONT_UI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('掼蛋', cx, cy + 2);
  // 四角祥云纹
  const cloud = (x: number, y: number, s: number, flip: number) => {
    g.save();
    g.translate(x, y);
    g.scale(s * flip, s);
    g.strokeStyle = 'rgba(255,230,160,0.13)';
    g.lineWidth = 3 / s;
    g.beginPath();
    g.arc(0, 0, 20, Math.PI * 0.9, Math.PI * 2.2);
    g.arc(30, -8, 14, Math.PI, Math.PI * 2.3);
    g.arc(52, 4, 10, Math.PI * 1.1, Math.PI * 2.5);
    g.stroke();
    g.beginPath(); g.arc(4, 2, 8, 0, Math.PI * 1.5); g.stroke();
    g.restore();
  };
  cloud(w * 0.08, h * 0.12, 2, 1);
  cloud(w * 0.92, h * 0.12, 2, -1);
  cloud(w * 0.06, h * 0.9, 1.6, 1);
  cloud(w * 0.94, h * 0.9, 1.6, -1);
  // 暗角
  const v = g.createRadialGradient(cx, h / 2, Math.min(w, h) * 0.4, cx, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  return c;
}

const AVATAR_COLORS = [['#ffb547', '#e2702b'], ['#6ec6ff', '#2f6fd1'], ['#9be08a', '#3f9a3a'], ['#f59ac6', '#c4467e'], ['#c6a2ff', '#6e48c9'], ['#ffd56b', '#c9962b']];

export function avatarTexture(name: string, idx: number): Texture {
  const S = 96;
  const { c, g } = canvas(S, S);
  const [a, b] = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  g.fill();
  // 简单的人像剪影
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.beginPath();
  g.arc(S / 2, S * 0.4, S * 0.17, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(S / 2, S * 0.86, S * 0.3, S * 0.22, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `900 ${S * 0.36}px ${FONT_UI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 4;
  g.fillText(name.slice(0, 1), S / 2, S * 0.54);
  return Texture.from(c);
}

let faces: Texture[] | null = null;
let back: Texture | null = null;
let wildBadge: Texture | null = null;

export function cardTexture(id: number): Texture {
  // 两副牌 id 顺序相同，共用 54 张贴图
  faces ??= DECK.slice(0, 54).map((c) => Texture.from(drawFace(c.id)));
  return faces[id % 54];
}

export function backTexture(): Texture {
  return (back ??= Texture.from(drawBack()));
}

export function wildBadgeTexture(): Texture {
  return (wildBadge ??= Texture.from(drawBadge('配', '#ffbf2e')));
}
