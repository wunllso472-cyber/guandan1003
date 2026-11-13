// 记牌训练的牌桌界面：右上角的记牌器面板（当前段位要记的格子显示成“?”），左上角的随局快问题卡。
// 用画布而不是网页浮层：竖屏时整个牌桌旋转 90°，画布上的内容跟着一起转。
import { Container, Graphics, Text, Ticker } from 'pixi.js';
import type { CardTracker } from '@shared/tracker';
import {
  bombsLine, makeQuestion, panelCells, progressText, quizDue, record, voidLine,
  MAX_TIER, PROMOTE_WINDOW, QUIZ_GAP_TRICKS, QUIZ_SECONDS, TIER_NAMES, type Question,
} from '@shared/training';
import { FONT_UI } from '../gfx/textures';
import { tween } from '../gfx/tween';
import { Button } from '../ui/Button';
import { sound } from '../audio/Sound';
import { train, saveTrain } from '../game/train';

/** 随复盘日志上传的本局训练统计 */
export interface TrainReport { tier: number; asked: number; correct: number; timeouts: number; panelOpen: boolean; quizOn: boolean }

export interface TrainHost {
  tracker: CardTracker;
  me: number;
  /** 记牌器的输入：自己的手牌、级牌、看得到的对家手牌（自己出完后） */
  input(): { hand: number[]; level: number; partnerHand: number[] | null };
  /** 现在能不能出题：出牌阶段、没托管、没出完、没暂停 */
  canAsk(): boolean;
  paused(): boolean;
  /** 升到了 tier 段 */
  promoted(tier: number): void;
  report(r: TrainReport): void;
}

/** 局末结算弹窗里的记牌成绩 */
export interface TrainSummary { asked: number; correct: number; tier: number; recent: number[]; progress: string }

const PANEL_W = 470;
const COLS = 9;
const CELL_H = 40;
/** 标题栏高度（格子从这里开始） */
const HEAD = 32;
const GAP = 5;
const PAD = 10;

const txt = (size: number, fill: number, weight: '700' | '900' = '700') =>
  new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: size, fontWeight: weight, fill } });

/** 记牌器面板 */
class Panel extends Container {
  private bg = new Graphics();
  private title = txt(16, 0xffe08a, '900');
  private tierText = txt(15, 0xffffff, '900');
  private quizBtn: Button;
  private prevBtn: Button;
  private cellsBox = new Container();
  private cellKey = '';
  private cellViews: { bg: Graphics; label: Text; num: Text }[] = [];
  private bombText = txt(14, 0xd5d9cf);
  private voidText = txt(14, 0xd5d9cf);

  constructor(onTier: (step: number) => void, onQuiz: () => void) {
    super();
    this.eventMode = 'static';
    this.on('pointerdown', (e) => e.stopPropagation());
    this.title.position.set(PAD, 7);
    this.prevBtn = new Button('<', 'gray', 30, 26, () => onTier(-1));
    const next = new Button('>', 'gray', 30, 26, () => onTier(1));
    this.quizBtn = new Button('', 'green', 82, 26, onQuiz);
    this.quizBtn.position.set(PANEL_W - PAD - 41, 18);
    next.position.set(PANEL_W - PAD - 82 - 8 - 15, 18);
    this.tierText.anchor.set(1, 0.5);
    this.tierText.position.set(next.x - 21, 18);
    this.prevBtn.y = 18; // x 在 update 里按段位文字的宽度定
    this.addChild(this.bg, this.title, this.tierText, this.prevBtn, next, this.quizBtn, this.cellsBox, this.bombText, this.voidText);
  }

  update(host: TrainHost, broken: boolean) {
    const tier = train.progress.tier;
    const inp = { tracker: host.tracker, ...host.input() };
    this.title.text = broken ? '记牌器 · 本局记录不完整' : '记牌器 · 外面还剩';
    this.tierText.text = `段位 ${tier} ${TIER_NAMES[tier]}`;
    this.prevBtn.x = this.tierText.x - this.tierText.width - 19;
    this.quizBtn.text = train.quizOn ? '快问 开' : '快问 关';
    this.quizBtn.setStyle(train.quizOn ? 'green' : 'gray');

    const cells = panelCells(inp, tier);
    const key = cells.map((c) => c.label).join(',');
    if (key !== this.cellKey) this.buildCells(cells.map((c) => c.label), key);
    const cw = (PANEL_W - PAD * 2 - GAP * (COLS - 1)) / COLS;
    cells.forEach((c, i) => {
      const v = this.cellViews[i];
      const hide = c.hidden && !broken;
      v.bg.clear().roundRect(0, 0, cw, CELL_H, 6)
        .fill(hide ? { color: 0xe0a530, alpha: 0.22 } : { color: 0xffffff, alpha: 0.1 });
      if (hide) v.bg.stroke({ color: 0xe0a530, width: 1.5 });
      const n = hide ? '?' : String(c.left);
      if (v.num.text !== n) v.num.text = n;
      v.num.style.fill = hide ? 0xffd75e : c.left ? 0xffffff : 0x7f9488;
    });

    const rows = Math.ceil(cells.length / COLS);
    const y = HEAD + rows * (CELL_H + GAP);
    this.bombText.text = `炸弹　${tier >= 4 && !broken ? '?（自己记）' : bombsLine(host.tracker, host.me)}`;
    this.voidText.text = `空门　${tier >= 6 && !broken ? '?（自己记）' : voidLine(host.tracker, host.me)}`;
    this.bombText.position.set(PAD, y);
    this.voidText.position.set(PAD, y + 18);
    const h = y + 18 + 21;
    this.bg.clear().roundRect(0, 0, PANEL_W, h, 12).fill({ color: 0x081c14, alpha: 0.9 }).stroke({ color: 0xffe08a, alpha: 0.45, width: 1.5 });
  }

  private buildCells(labels: string[], key: string) {
    this.cellKey = key;
    this.cellsBox.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.cellViews = [];
    const cw = (PANEL_W - PAD * 2 - GAP * (COLS - 1)) / COLS;
    labels.forEach((l, i) => {
      const c = new Container();
      c.position.set(PAD + (i % COLS) * (cw + GAP), HEAD + Math.floor(i / COLS) * (CELL_H + GAP));
      const bg = new Graphics();
      const label = txt(13, 0xd5d9cf);
      label.text = l;
      label.anchor.set(0.5, 0);
      label.position.set(cw / 2, 1);
      const num = txt(20, 0xffffff, '900');
      num.anchor.set(0.5, 0);
      num.position.set(cw / 2, 14);
      c.addChild(bg, label, num);
      this.cellsBox.addChild(c);
      this.cellViews.push({ bg, label, num });
    });
  }
}

type OptState = 'idle' | 'ok' | 'no' | 'dim';
const OPT_COLOR: Record<OptState, number> = { idle: 0x2f7ee0, ok: 0x2fa457, no: 0xd0412c, dim: 0x9fb4cc };
const OPT_H = 40;

/** 题卡上的一个选项 */
class OptionBox extends Container {
  private g = new Graphics();
  private t: Text;

  constructor(private caption: string, private w: number, onTap: () => void) {
    super();
    this.t = new Text({ text: caption, style: { fontFamily: FONT_UI, fontSize: caption.length > 2 ? 20 : 24, fontWeight: '900', fill: 0xffffff } });
    this.t.anchor.set(0.5);
    this.t.position.set(w / 2, OPT_H / 2);
    this.addChild(this.g, this.t);
    this.paint('idle');
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }

  paint(s: OptState) {
    this.g.clear().roundRect(0, 0, this.w, OPT_H, 12).fill({ color: OPT_COLOR[s] }).stroke({ color: 0xffffff, alpha: 0.5, width: 2 });
    this.alpha = s === 'dim' ? 0.45 : 1;
    this.t.text = s === 'ok' ? `${this.caption} ✓` : s === 'no' ? `${this.caption} ✗` : this.caption;
    if (s !== 'idle') this.eventMode = 'none';
  }
}

/** 快问题卡 */
class QuizCard extends Container {
  static readonly W = 360;
  private bg = new Graphics();
  private head = txt(15, 0x9a6b2a);
  private count = txt(15, 0x9a6b2a);
  private question = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: 20, fontWeight: '900', fill: 0x4a2a0c, wordWrap: true, wordWrapWidth: QuizCard.W - 28, breakWords: true } });
  private opts = new Container<OptionBox>();
  private bar = new Graphics();
  private explain = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: 15, fontWeight: '700', fill: 0x6b4a2b, wordWrap: true, wordWrapWidth: QuizCard.W - 28, breakWords: true } });
  private optY = 0;

  constructor() {
    super();
    this.eventMode = 'static';
    this.on('pointerdown', (e) => e.stopPropagation());
    this.head.position.set(14, 8);
    this.count.anchor.set(1, 0);
    this.count.position.set(QuizCard.W - 14, 8);
    this.question.position.set(14, 30);
    this.addChild(this.bg, this.head, this.count, this.question, this.opts, this.bar, this.explain);
    this.visible = false;
  }

  show(q: Question, n: number, onPick: (i: number) => void) {
    this.head.text = `记牌快问 · 段位 ${train.progress.tier}${q.tier < train.progress.tier ? '（复习）' : ''}`;
    this.count.text = `第 ${n} 题 · ${QUIZ_SECONDS} 秒`;
    this.question.text = q.text;
    this.optY = 30 + this.question.height + 6;
    this.opts.removeChildren().forEach((c) => c.destroy({ children: true }));
    const k = q.options.length;
    const ow = (QuizCard.W - 28 - (k - 1) * 10) / k;
    q.options.forEach((o, i) => {
      const b = new OptionBox(o, ow, () => onPick(i));
      b.position.set(14 + i * (ow + 10), this.optY);
      this.opts.addChild(b);
    });
    this.explain.text = '';
    this.setBar(1);
    this.visible = true;
    // 只做淡入：缩放由牌桌按屏幕宽度设定
    this.alpha = 0;
    tween(this, { alpha: 1 }, 180);
  }

  setBar(frac: number) {
    const y = this.optY + OPT_H + 8;
    this.bar.clear().roundRect(14, y, QuizCard.W - 28, 8, 4).fill({ color: 0xead3a6 });
    if (frac > 0) this.bar.roundRect(14, y, (QuizCard.W - 28) * frac, 8, 4).fill({ color: frac < 0.3 ? 0xd0412c : 0xe0762a });
    this.drawBg(y + 8 + 10);
  }

  /** 揭晓答案：picked 为 -1 表示超时 */
  reveal(q: Question, picked: number) {
    this.opts.children.forEach((b, i) => b.paint(i === q.answer ? 'ok' : i === picked ? 'no' : 'dim'));
    this.bar.clear();
    const lead = picked === q.answer ? '答对了！' : `${picked < 0 ? '时间到' : '答错了'}，答案是 ${q.options[q.answer]}`;
    this.explain.text = `${lead}
${q.explain}`;
    this.explain.position.set(14, this.optY + OPT_H + 6);
    this.drawBg(this.optY + OPT_H + 6 + this.explain.height + 10);
  }

  private drawBg(h: number) {
    this.bg.clear()
      .roundRect(0, 4, QuizCard.W, h, 16).fill({ color: 0x000000, alpha: 0.3 })
      .roundRect(0, 0, QuizCard.W, h, 16).fill({ color: 0xfff4dc }).stroke({ color: 0x8a4b12, width: 4 });
  }
}

export class TrainLayer extends Container {
  readonly button: Button;
  private panel: Panel;
  private quiz = new QuizCard();
  private suppressed = false;
  /** 本局重连过：出牌记录不完整，不出题，记牌器不隐藏 */
  private broken = false;
  private stats = { asked: 0, correct: 0, timeouts: 0 };
  private tricksSinceAsk = QUIZ_GAP_TRICKS;
  private current: Question | null = null;
  private elapsed = 0;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private host: TrainHost) {
    super();
    this.button = new Button('记牌', train.panelOpen ? 'orange' : 'gray', 96, 46, () => this.togglePanel());
    this.panel = new Panel((step) => {
      const t = Math.min(MAX_TIER, Math.max(1, train.progress.tier + step));
      if (t === train.progress.tier) return;
      train.progress.tier = t;
      saveTrain();
      this.refresh();
    }, () => {
      train.quizOn = !train.quizOn;
      saveTrain();
      if (!train.quizOn) this.cancelQuiz();
      this.refresh();
      this.report();
    });
    this.addChild(this.panel, this.quiz);
    this.applyVisible();
    Ticker.shared.add(this.tick, this);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    Ticker.shared.remove(this.tick, this);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.button.destroy();
    super.destroy(options);
  }

  /**
   * 手机横屏时整体缩放约一半，设计坐标更宽（约 1600）：放大一档便于看清，
   * 记牌器左移让开右侧的下家头像和出牌区；窄屏（1280）时贴右，不挡对家出的牌。
   */
  layout(DW: number, _DH: number, pad: number) {
    const wide = DW >= 1500;
    this.panel.scale.set(wide ? 1.15 : 1);
    this.panel.position.set(wide ? DW - pad - 110 - PANEL_W * 1.15 : DW - pad - PANEL_W, 60);
    this.quiz.scale.set(wide ? 1.1 : 1);
    this.quiz.position.set(pad + 8, 92);
  }

  /** 决策面板（网页浮层，在右上角）打开时让开 */
  setSuppressed(on: boolean) {
    this.suppressed = on;
    this.applyVisible();
  }

  private togglePanel() {
    train.panelOpen = !train.panelOpen;
    saveTrain();
    this.button.setStyle(train.panelOpen ? 'orange' : 'gray');
    this.applyVisible();
    this.refresh();
    this.report();
  }

  private applyVisible() {
    this.panel.visible = train.panelOpen && !this.suppressed;
  }

  /** 牌局有变化时更新记牌器 */
  refresh() {
    if (!this.panel.visible) return;
    try { this.panel.update(this.host, this.broken); } catch (err) { console.warn('记牌器更新失败', err); }
  }

  onRoundStart() {
    this.cancelQuiz();
    this.broken = false;
    this.stats = { asked: 0, correct: 0, timeouts: 0 };
    this.tricksSinceAsk = QUIZ_GAP_TRICKS;
    this.report();
  }

  /** 断线重连：本局的出牌记录不完整 */
  onSync() {
    this.broken = true;
    this.cancelQuiz();
  }

  onRoundEnd() { this.cancelQuiz(); }

  /** 一轮结束：符合条件时出一道题（下一轮由自己领牌时不问，免得占用出牌时间） */
  onTrickEnd(leader: number) {
    this.tricksSinceAsk++;
    if (!train.quizOn || this.broken || this.current || leader === this.host.me || !this.host.canAsk()) return;
    const played = this.host.tracker.played.size;
    if (!quizDue({ tricksSinceAsk: this.tricksSinceAsk, played, askedThisRound: this.stats.asked })) return;
    let q: Question | null = null;
    try { q = makeQuestion({ tracker: this.host.tracker, ...this.host.input() }, this.host.me, train.progress.tier); } catch (err) { console.warn('出题失败', err); }
    if (!q) return;
    this.tricksSinceAsk = 0;
    this.current = q;
    this.elapsed = 0;
    this.stats.asked++;
    this.quiz.show(q, this.stats.asked, (i) => this.answer(i));
  }

  private tick(t: Ticker) {
    const q = this.current;
    if (!q || this.closeTimer) return;
    if (this.host.paused()) return;
    this.elapsed += t.deltaMS;
    const left = 1 - this.elapsed / (QUIZ_SECONDS * 1000);
    if (left <= 0) { this.answer(-1); return; }
    this.quiz.setBar(left);
  }

  private answer(i: number) {
    const q = this.current;
    if (!q || this.closeTimer) return;
    const ok = i === q.answer;
    sound.play(ok ? 'select' : 'warn');
    this.quiz.reveal(q, i);
    if (ok) this.stats.correct++;
    if (i < 0) this.stats.timeouts++;
    const { promoted } = record(train.progress, q, ok);
    saveTrain();
    if (promoted) this.host.promoted(train.progress.tier);
    this.refresh();
    this.report();
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      if (this.destroyed) return;
      void tween(this.quiz, { alpha: 0 }, 250).then(() => { if (!this.destroyed && !this.current) this.quiz.visible = false; });
      this.current = null;
    }, ok ? 1800 : 3600);
  }

  /** 收起题卡；没答完的题不计分（局末、重连、关掉快问） */
  private cancelQuiz() {
    // 还在等作答（没有揭晓答案）的题不计入本局题数
    if (this.current && !this.closeTimer) this.stats.asked--;
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
    this.current = null;
    this.quiz.visible = false;
  }

  private report() {
    this.host.report({ tier: train.progress.tier, ...this.stats, panelOpen: train.panelOpen, quizOn: train.quizOn });
  }

  /** 本局的记牌成绩（没出过题时为 null） */
  summary(): TrainSummary | null {
    if (!this.stats.asked) return null;
    const p = train.progress;
    return { asked: this.stats.asked, correct: this.stats.correct, tier: p.tier, recent: (p.recent[p.tier] ?? []).slice(-PROMOTE_WINDOW), progress: progressText(p) };
  }
}
