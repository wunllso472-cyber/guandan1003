// 掀桌子：把当前桌面拍成贴图，贴到透视网格上当作一块 3D 桌板——抬起、腾空翻转、倒扣砸下，停一下再翻回来归位。
// 翻转期间真实桌面先藏起来（手牌、按钮不在桌面层里，照常可以操作），归位时重新拍一张，显示的就是最新的桌面。
import { Container, PerspectiveMesh, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js';
import { ease, frames, wait } from '../gfx/tween';
import { sound } from '../audio/Sound';

let renderer: Renderer | null = null;
/** 由 main 在渲染引擎初始化后调用一次 */
export function setFlipRenderer(r: Renderer) { renderer = r; }

const PI = Math.PI;
/** 相机高度（设计坐标）：越小透视越夸张 */
const CAM = 1600;
/** 掀桌的人在屏幕哪一边（0 下 1 右 2 上 3 左）→ 指向那一边的单位向量 */
const SIDE = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }];

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  return Texture.from(c);
}

let backTex: Texture | null = null;
/** 桌底：木板、一圈围框、四个角上朝着镜头的桌腿 */
function undersideTexture() {
  return (backTex ??= canvasTexture(640, 375, (g) => {
    const W = 640, H = 375;
    const base = g.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, '#7a4a24'); base.addColorStop(1, '#4e2d12');
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    // 木板缝和木纹
    for (let x = 0; x <= W; x += 64) {
      g.fillStyle = `rgba(255,220,170,${0.04 + ((x / 64) % 3) * 0.03})`; g.fillRect(x, 0, 64, H);
      g.fillStyle = 'rgba(30,14,4,0.6)'; g.fillRect(x - 1.5, 0, 3, H);
    }
    g.strokeStyle = 'rgba(40,18,4,0.35)'; g.lineWidth = 1.5;
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % W, y = (i * 53) % H;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 10, y + 40, x - 8, y + 80, x + 4, y + 120); g.stroke();
    }
    // 围框
    g.strokeStyle = '#3a1e08'; g.lineWidth = 22;
    g.strokeRect(34, 34, W - 68, H - 68);
    g.strokeStyle = 'rgba(255,210,150,0.25)'; g.lineWidth = 3;
    g.strokeRect(24, 24, W - 48, H - 48);
    // 四条腿（从下往上看是一个个圆柱截面）
    for (const [x, y] of [[62, 62], [W - 62, 62], [W - 62, H - 62], [62, H - 62]]) {
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(x + 6, y + 8, 34, 0, PI * 2); g.fill();
      const leg = g.createRadialGradient(x - 10, y - 10, 4, x, y, 32);
      leg.addColorStop(0, '#c98a4e'); leg.addColorStop(1, '#6a3a16');
      g.fillStyle = leg; g.beginPath(); g.arc(x, y, 30, 0, PI * 2); g.fill();
      g.strokeStyle = '#2a1404'; g.lineWidth = 3; g.stroke();
      g.strokeStyle = 'rgba(60,25,5,0.6)'; g.lineWidth = 1.5;
      for (const r of [10, 18, 24]) { g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.stroke(); }
    }
    // 粘在桌底的一块口香糖
    g.fillStyle = '#ff8fb8'; g.beginPath(); g.ellipse(W * 0.62, H * 0.4, 14, 10, 0.4, 0, PI * 2); g.fill();
  }));
}

let floorTex: Texture | null = null;
/** 桌子下面的地板（深色木地板 + 暗角） */
function floorTexture() {
  return (floorTex ??= canvasTexture(320, 188, (g) => {
    g.fillStyle = '#2a1b10'; g.fillRect(0, 0, 320, 188);
    for (let y = 0; y < 188; y += 16) {
      g.fillStyle = `rgba(255,200,140,${0.03 + ((y / 16) % 2) * 0.03})`; g.fillRect(0, y, 320, 16);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, y, 320, 1);
    }
    const v = g.createRadialGradient(160, 94, 30, 160, 94, 190);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
    g.fillStyle = v; g.fillRect(0, 0, 320, 188);
  }));
}

let shadowTex: Texture | null = null;
function shadowTexture() {
  return (shadowTex ??= canvasTexture(128, 75, (g) => {
    const s = g.createRadialGradient(64, 37, 10, 64, 37, 64);
    s.addColorStop(0, 'rgba(0,0,0,0.85)'); s.addColorStop(0.7, 'rgba(0,0,0,0.5)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = s; g.fillRect(0, 0, 128, 75);
  }));
}

export class TableFlip {
  private busy = false;
  private cancelled = false;

  /** layer：要掀的桌面层；size：设计尺寸 */
  constructor(private layer: Container, private size: () => { w: number; h: number }) {}

  get flipping() { return this.busy; }

  /** 布局变化或离开牌桌时立即结束，桌面归位 */
  cancel() { if (this.busy) this.cancelled = true; }

  /**
   * 掀桌：side 是掀桌的人在屏幕哪一边（0 下 1 右 2 上 3 左），桌子朝远离他的方向翻；onLand 在倒扣砸下时调用。
   * 正在掀或无法截图时返回 false（调用方改用普通道具效果）。
   */
  async run(side: number, onLand: () => void): Promise<boolean> {
    const parent = this.layer.parent;
    if (this.busy || !renderer || !parent || this.layer.destroyed) return false;
    this.busy = true;
    this.cancelled = false;
    const r = renderer;
    const { w: W, h: H } = this.size();
    const snap = () => {
      const was = this.layer.visible;
      this.layer.visible = true;
      const t = r.generateTexture({ target: this.layer, frame: new Rectangle(0, 0, W, H), resolution: Math.min(r.resolution, 1.5), antialias: true });
      this.layer.visible = was;
      return t;
    };
    let front = snap();
    const group = new Container();
    group.eventMode = 'none';
    const floor = new Sprite(floorTexture());
    floor.width = W; floor.height = H;
    const shadow = new Sprite(shadowTexture());
    shadow.anchor.set(0.5);
    const meshF = new PerspectiveMesh({ texture: front, verticesX: 16, verticesY: 16 });
    const meshB = new PerspectiveMesh({ texture: undersideTexture(), verticesX: 10, verticesY: 10 });
    group.addChild(floor, shadow, meshB, meshF);
    parent.addChildAt(group, parent.getChildIndex(this.layer) + 1);
    this.layer.visible = false;

    const d = SIDE[side] ?? SIDE[0];
    const ax = { x: -d.y, y: d.x };
    const cx = W / 2, cy = H / 2;
    const corners = [[0, 0], [W, 0], [W, H], [0, H]];
    /**
     * theta：绕桌子中线翻过的角度（0 正面朝上，π 倒扣）；lift：整块桌子抬离桌面的高度；
     * zoom：镜头拉远的比例——桌面和屏幕一样大，不拉远的话翻到半空只看到满屏木纹，看不出是一张桌子
     */
    const pose = (theta: number, lift: number, zoom = 1) => {
      const pts: number[] = [];
      for (const [x, y] of corners) {
        const px = x - cx, py = y - cy;
        const s = px * d.x + py * d.y, t = px * ax.x + py * ax.y;
        const z = s * Math.sin(theta) + lift;
        const s2 = s * Math.cos(theta);
        const k = (CAM / (CAM - z)) * zoom;
        pts.push(cx + (ax.x * t + d.x * s2) * k, cy + (ax.y * t + d.y * s2) * k);
      }
      const facing = Math.cos(theta) >= 0;
      meshF.visible = facing;
      meshB.visible = !facing;
      (facing ? meshF : meshB).setCorners(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
      // 影子：桌子抬得越高越淡越大，往光源反方向偏
      const h = Math.max(0, lift);
      shadow.position.set(cx + h * 0.15 * zoom, cy + h * 0.25 * zoom);
      const flat = Math.max(0.35, Math.abs(Math.cos(theta)));
      shadow.width = W * zoom * (0.95 + h / 900) * (d.x ? flat : 1);
      shadow.height = H * zoom * (0.95 + h / 900) * (d.y ? flat : 1);
      shadow.alpha = (zoom < 0.99 ? 0.55 : Math.min(0.8, h / 120)) * Math.max(0.3, 1 - h / 700);
    };
    const alive = () => !this.cancelled && !group.destroyed;

    const done = () => {
      if (!group.destroyed) group.destroy({ children: true });
      if (!front.destroyed) front.destroy(true);
      if (!this.layer.destroyed) this.layer.visible = true;
      this.busy = false;
    };
    try {
      pose(0, 0);
      // 1. 蓄力：掀桌那一边先翘起来一点
      sound.play('thump');
      const Z = 0.7;
      await frames(300, (t) => pose(0.2 * ease.outCubic(t), 40 * t, 1 - (1 - Z) * ease.outCubic(t)), alive);
      if (!alive()) return true;
      // 2. 腾空翻转：越抬越高、越近越大，翻过 180°
      sound.play('whoosh');
      await frames(640, (t) => {
        const e = ease.inOutCubic(t);
        pose(0.2 + (PI - 0.2) * e, 40 * (1 - t) + 420 * Math.sin(PI * t), Z);
      }, alive);
      if (!alive()) return true;
      // 3. 倒扣砸下，弹一下
      onLand();
      await frames(280, (t) => pose(PI, 28 * Math.sin(PI * t) * (1 - t), Z), alive);
      if (!alive()) return true;
      await wait(650);
      if (!alive()) return true;
      // 4. 翻回来：先重新拍一张最新的桌面
      const fresh = snap();
      front.destroy(true);
      front = fresh;
      meshF.texture = front;
      sound.play('whoosh');
      await frames(560, (t) => pose(PI + PI * ease.inOutCubic(t), 280 * Math.sin(PI * t), Z), alive);
      if (!alive()) return true;
      sound.play('thump');
      // 落定，镜头推回原位
      await frames(320, (t) => pose(PI * 2, 14 * Math.sin(PI * t) * (1 - t), Z + (1 - Z) * ease.inOutCubic(t)), alive);
      return true;
    } finally {
      done();
    }
  }
}
