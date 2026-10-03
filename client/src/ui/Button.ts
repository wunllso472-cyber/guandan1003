import { Container, Graphics, Text, FillGradient } from 'pixi.js';
import { FONT_UI } from '../gfx/textures';
import { sound } from '../audio/Sound';

export type ButtonStyle = 'orange' | 'blue' | 'gray' | 'green' | 'gold';

const PALETTE: Record<ButtonStyle, [number, number, number]> = {
  orange: [0xffc04a, 0xf07a12, 0x9a4a00],
  blue: [0x7cc8ff, 0x2f7ee0, 0x15438a],
  gray: [0xf2f2f2, 0xb9bec6, 0x6d737c],
  green: [0x8fe39a, 0x2fa457, 0x16602f],
  gold: [0xfff0b0, 0xe0b040, 0x8a6110],
};

export class Button extends Container {
  private bg = new Graphics();
  private caption: Text;
  private _enabled = true;

  constructor(text: string, private styleName: ButtonStyle, public w = 150, public h = 64, private onTap?: () => void) {
    super();
    this.caption = new Text({
      text,
      style: {
        fontFamily: FONT_UI, fontSize: Math.round(h * 0.42), fontWeight: '900', fill: 0xffffff,
        stroke: { color: PALETTE[styleName][2], width: 4 },
        dropShadow: { color: 0x000000, alpha: 0.25, blur: 2, distance: 2, angle: Math.PI / 2 },
      },
    });
    this.caption.anchor.set(0.5);
    this.addChild(this.bg, this.caption);
    this.draw();
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', (e) => {
      e.stopPropagation();
      if (!this._enabled) return;
      this.scale.set(0.94);
    });
    const release = () => this.scale.set(1);
    this.on('pointerupoutside', release);
    this.on('pointerup', (e) => {
      e.stopPropagation();
      release();
      if (this._enabled) { sound.play('click'); this.onTap?.(); }
    });
  }

  set text(t: string) { this.caption.text = t; }

  setOnTap(fn: () => void) { this.onTap = fn; }

  get enabled() { return this._enabled; }
  set enabled(v: boolean) {
    this._enabled = v;
    this.draw();
  }

  private draw() {
    const [top, bot, edge] = this._enabled ? PALETTE[this.styleName] : PALETTE.gray;
    const { w, h } = this;
    const fill = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bot }], textureSpace: 'local' });
    this.bg.clear();
    this.bg.roundRect(-w / 2, -h / 2 + 4, w, h, h / 2).fill({ color: edge });
    this.bg.roundRect(-w / 2, -h / 2, w, h, h / 2).fill(fill).stroke({ color: 0xffffff, alpha: 0.6, width: 2 });
    this.bg.roundRect(-w / 2 + 8, -h / 2 + 4, w - 16, h * 0.38, h * 0.2).fill({ color: 0xffffff, alpha: 0.22 });
    this.caption.style.stroke = { color: this._enabled ? PALETTE[this.styleName][2] : 0x6d737c, width: 4 };
    this.alpha = this._enabled ? 1 : 0.75;
  }
}
