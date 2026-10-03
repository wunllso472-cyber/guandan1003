import { Container, Graphics, Sprite, Text, Texture, Point, Ticker } from 'pixi.js';
import { rankName } from '@shared/cards';
import { comboName, resolvePlay, type Combo } from '@shared/combo';
import { partnerOf, teamOf, type RoundResult } from '@shared/game';
import { CARD_W, CARD_H, FONT_UI, cardTexture, drawTable } from '../gfx/textures';
import { tween, ease, wait } from '../gfx/tween';
import { Button } from '../ui/Button';
import { HandView } from './HandView';
import { PlayerHud, PlayedView } from './Hud';
import type { ClientEvent, GameClient } from '../game/types';
import { Effects } from './Effects';
import { ChatLayer } from './ChatLayer';
import { sound } from '../audio/Sound';
import { prefs, savePrefs } from '../game/prefs';
import { autoPickFor } from '../game/autopick';

const PAD = 28; // 刘海屏安全边距

export class TableScene extends Container {
  private bg: Sprite;
  private info = new Container();
  private infoLevel: Text;
  private infoRank: Text;
  private infoTeams: Text;
  private huds: PlayerHud[] = [];
  private played: PlayedView[] = [];
  private hand = new HandView();
  private actionBar = new Container();
  private passBtn: Button;
  private hintBtn: Button;
  private playBtn: Button;
  private sortBtn: Button;
  private autoBtn: Button;
  private menuBtn: Button;
  private autoBar = new Container();
  private returnBar = new Container();
  private returnBtn: Button;
  private fx: Effects;
  private chat: ChatLayer;
  private chatBtn: Button;
  private lastTick = -1;
  private myDeadline = 0;
  private warned = new Set<number>();
  private overlay = new Container();
  private toastBox = new Container();
  private toastText: Text;
  private DW = 1280;
  private DH = 750;
  private hintList: Combo[] = [];
  private hintIdx = 0;
  private myTurn = false;
  /** 自己出完后查看对家手牌（只读） */
  private watching = -1;
  private watchTag: Text;

  constructor(private client: GameClient, private onExit: () => void) {
    super();
    this.bg = new Sprite(Texture.from(drawTable(1800, 900)));
    this.eventMode = 'static';
    this.on('pointerdown', () => {
      if (this.chat.isOpen) { this.chat.closeAll(); return; }
      if (this.hand.selected.size) this.hand.clearSelection();
    });
    this.fx = new Effects(this);
    this.chat = new ChatLayer({
      client,
      fx: this.fx,
      seatPos: (seat) => this.huds[seat].position.clone(),
      rel: (seat) => (seat - client.mySeat + 4) % 4,
      toast: (t) => this.toast(t),
      shakeHud: (seat) => this.shakeHud(seat),
    });

    // 左上角级牌信息
    const infoBg = new Graphics()
      .roundRect(0, 0, 270, 80, 16).fill({ color: 0x1a0f05, alpha: 0.55 }).stroke({ color: 0xf5c34a, alpha: 0.75, width: 2 })
      .roundRect(4, 4, 262, 72, 13).stroke({ color: 0xf5c34a, alpha: 0.25, width: 1 });
    // 级牌小牌面
    const mini = new Graphics()
      .roundRect(12, 10, 46, 60, 7).fill({ color: 0xfffaf0 }).stroke({ color: 0xc99a52, width: 2 })
      .roundRect(16, 14, 38, 52, 5).stroke({ color: 0xd4231c, alpha: 0.35, width: 1 });
    this.infoRank = new Text({ text: '', style: { fontFamily: '"Arial Black",Arial,sans-serif', fontSize: 30, fontWeight: '900', fill: 0xd4231c } });
    this.infoRank.anchor.set(0.5);
    this.infoRank.position.set(35, 41);
    this.infoLevel = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: 24, fontWeight: '900', fill: 0xffd75e, stroke: { color: 0x5a3600, width: 4 } } });
    this.infoLevel.position.set(70, 8);
    this.infoTeams = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: 17, fontWeight: '700', fill: 0xffffff } });
    this.infoTeams.position.set(70, 46);
    this.info.addChild(infoBg, mini, this.infoRank, this.infoLevel, this.infoTeams);

    const me = client.mySeat;
    for (let r = 0; r < 4; r++) {
      const seat = (me + r) % 4;
      const p = client.players[seat];
      const hud = new PlayerHud(p.name, p.avatar, teamOf(seat) === teamOf(me), r !== 0, r === 1 ? -1 : 1);
      hud.setAuto(client.isAuto(seat));
      if (r !== 0) hud.on('pointertap', (e) => { e.stopPropagation(); sound.play('click'); this.chat.openPicker(seat); });
      this.huds[seat] = hud;
      this.played[seat] = new PlayedView(r === 1 ? 1 : r === 3 ? 0 : 0.5);
    }

    this.passBtn = new Button('不出', 'gray', 150, 64, () => this.doPass());
    this.hintBtn = new Button('提示', 'blue', 150, 64, () => this.doHint());
    this.playBtn = new Button('出牌', 'orange', 150, 64, () => this.doPlay());
    this.passBtn.x = -190; this.playBtn.x = 190;
    this.actionBar.addChild(this.passBtn, this.hintBtn, this.playBtn);
    this.actionBar.visible = false;

    this.sortBtn = new Button('理牌', 'green', 104, 50, () => this.toast(this.hand.sortAction()));
    this.autoBtn = new Button('托管', 'blue', 96, 46, () => this.client.setAuto(true));
    this.menuBtn = new Button('菜单', 'gray', 96, 46, () => this.showMenu());
    this.chatBtn = new Button('聊天', 'blue', 104, 50, () => this.chat.togglePanel());

    const autoBg = new Graphics().roundRect(-220, -34, 440, 68, 34).fill({ color: 0x000000, alpha: 0.55 });
    const autoText = new Text({ text: '托管中…', style: { fontFamily: FONT_UI, fontSize: 26, fontWeight: '900', fill: 0xffffff } });
    autoText.anchor.set(0.5);
    autoText.x = -80;
    const cancelAuto = new Button('取消托管', 'orange', 150, 50, () => this.client.setAuto(false));
    cancelAuto.x = 120;
    this.autoBar.addChild(autoBg, autoText, cancelAuto);
    this.autoBar.visible = false;

    const rText = new Text({ text: '请选择一张 10 及以下的牌还贡', style: { fontFamily: FONT_UI, fontSize: 26, fontWeight: '900', fill: 0xffffff, stroke: { color: 0x000000, width: 5 } } });
    rText.anchor.set(0.5);
    rText.y = -56;
    this.returnBtn = new Button('还贡', 'orange', 150, 64, () => this.doReturn());
    this.returnBar.addChild(rText, this.returnBtn);
    this.returnBar.visible = false;

    const tbg = new Graphics();
    this.toastText = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: 24, fontWeight: '700', fill: 0xffffff } });
    this.toastText.anchor.set(0.5);
    this.toastBox.addChild(tbg, this.toastText);
    this.toastBox.alpha = 0;

    this.addChild(this.bg, this.info);
    for (const pv of this.played) this.addChild(pv);
    for (const h of this.huds) this.addChild(h);
    this.addChild(this.sortBtn, this.chatBtn, this.autoBtn, this.menuBtn, this.hand, this.actionBar, this.returnBar, this.autoBar, this.fx, this.chat, this.toastBox, this.overlay);

    this.watchTag = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: 24, fontWeight: '900', fill: 0xffe08a, stroke: { color: 0x2a1600, width: 5 } } });
    this.watchTag.anchor.set(0.5);
    this.watchTag.visible = false;
    this.addChild(this.watchTag);

    this.hand.onChange = () => this.refreshButtons();
    this.hand.autoPick = (id) => {
      const g = this.client.game;
      if (!prefs.autoPick || !this.myTurn || g.phase !== 'play' || !g.lastPlay || this.watching >= 0) return null;
      return autoPickFor(id, g.hands[this.client.mySeat], g.level, g.lastPlay.combo);
    };
    client.on((e) => this.onEvent(e));
    Ticker.shared.add(this.tickTimer, this);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    Ticker.shared.remove(this.tickTimer, this);
    super.destroy(options);
  }

  /** 自己回合最后 5 秒的滴答声 */
  private tickTimer() {
    const until = this.myDeadline;
    if (!until || !this.myTurn) return;
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 5 && left > 0 && left !== this.lastTick) {
      this.lastTick = left;
      sound.play('tick');
    }
  }

  private shakeHud(seat: number) {
    const h = this.huds[seat];
    const x = h.x;
    void tween(h, { x: x - 8 }, 50).then(() => tween(h, { x: x + 8 }, 80)).then(() => tween(h, { x }, 60));
  }

  /** 由 main 在舞台上调用一次，用于滑动选牌 */
  bindStage(stage: Container) { this.hand.bindStage(stage); }

  layout(DW: number, DH: number) {
    this.DW = DW; this.DH = DH;
    const s = Math.max(DW / 1800, DH / 900);
    this.bg.scale.set(s);
    this.bg.position.set((DW - 1800 * s) / 2, (DH - 900 * s) / 2);
    this.info.position.set(PAD + 8, 10);
    this.hitArea = { contains: (x: number, y: number) => x >= 0 && y >= 0 && x <= DW && y <= DH };

    const me = this.client.mySeat;
    const pos = (r: number) => (me + r) % 4;
    this.huds[pos(0)].position.set(PAD + 56, DH - 92);
    this.huds[pos(1)].position.set(DW - PAD - 56, DH * 0.38);
    this.huds[pos(2)].position.set(DW / 2 - 200, 66);
    this.huds[pos(3)].position.set(PAD + 56, DH * 0.38);
    this.played[pos(0)].position.set(DW / 2, DH - 392);
    this.played[pos(1)].position.set(DW - PAD - 180, DH * 0.38);
    this.played[pos(2)].position.set(DW / 2, 190);
    this.played[pos(3)].position.set(PAD + 180, DH * 0.38);

    this.hand.area = { left: PAD + 108, right: DW - PAD - 118, bottom: DH - 8, maxStack: 332 };
    this.hand.layout(false);
    this.actionBar.position.set(DW / 2, DH - 392);
    this.returnBar.position.set(DW / 2, DH - 392);
    this.autoBar.position.set(DW / 2, DH - 392);
    this.sortBtn.position.set(DW - PAD - 56, DH - 60);
    this.chatBtn.position.set(DW - PAD - 56, DH - 124);
    this.fx.layout(DW, DH);
    this.chat.layout(DW, DH);
    this.menuBtn.position.set(DW - PAD - 54, 34);
    this.autoBtn.position.set(DW - PAD - 160, 34);
    this.toastBox.position.set(DW / 2, DH - 470);
    this.watchTag.position.set(DW / 2, DH - 380);
    this.overlay.position.set(0, 0);
    for (const c of this.overlay.children) (c as any).relayout?.(DW, DH);
  }

  // ---------- 事件 ----------

  private onEvent(e: ClientEvent) {
    const g = this.client.game;
    const me = this.client.mySeat;
    switch (e.type) {
      case 'roundStart': {
        this.clearOverlay();
        for (const pv of this.played) pv.clear();
        this.huds.forEach((h) => { h.setPlace(0); h.setCount(27); h.setDeadline(0); });
        this.updateInfo();
        this.stopWatching();
        this.hand.setHand(e.hands[me], e.level, true);
        this.actionBar.visible = false;
        this.returnBar.visible = false;
        this.warned.clear();
        this.fx.bigText(`本局打 ${rankName(e.level)}`, [0xfff3b0, 0xf0a020]);
        break;
      }
      case 'antiTribute':
        this.fx.bigText('抗贡！', [0xffd0a0, 0xff5a2a]);
        sound.play('shine');
        break;
      case 'tribute':
        for (const t of e.list) {
          this.flyCard(t.card, t.from, t.to);
          if (t.from === me) this.hand.removeCards([t.card]);
        }
        void wait(700).then(() => {
          if (this.destroyed) return;
          for (const t of e.list) if (t.to === me && this.hand.hand().indexOf(t.card) < 0) this.hand.addCards([t.card]);
        });
        this.toast(e.list.length > 1 ? '双下，两人进贡' : '进贡');
        sound.play('tribute');
        this.refreshReturnBar();
        break;
      case 'returnTribute':
        sound.play('tribute');
        this.flyCard(e.card, e.from, e.to);
        if (e.from === me) this.hand.removeCards([e.card]);
        if (e.to === me) void wait(700).then(() => { if (!this.destroyed) this.hand.addCards([e.card]); });
        this.refreshReturnBar();
        break;
      case 'turn': {
        this.clearStale();
        this.played[e.seat].clear();
        this.returnBar.visible = false;
        this.myTurn = e.seat === me;
        this.lastTick = -1;
        if (this.myTurn && !this.client.isAuto(me) && this.watching < 0) sound.play('turn');
        this.hintList = [];
        this.hintIdx = 0;
        this.refreshButtons();
        break;
      }
      case 'deadline':
        this.huds.forEach((h, s) => h.setDeadline(s === e.seat ? e.until : 0));
        this.myDeadline = e.seat === me ? e.until : 0;
        break;
      case 'play': {
        this.clearStale();
        this.huds[e.seat].setDeadline(0);
        const pv = this.played[e.seat];
        let from: Point | null = null;
        if (e.seat === me || e.seat === this.watching) {
          const pos = [...this.hand.removeCards(e.combo.cards).values()];
          if (pos.length) {
            const avg = pos.reduce((a, p) => new Point(a.x + p.x / pos.length, a.y + p.y / pos.length), new Point());
            from = pv.toLocal(avg);
          }
        } else {
          from = pv.toLocal(this.huds[e.seat].getGlobalPosition());
        }
        pv.showCards(e.combo.cards, g.level, from);
        this.huds[e.seat].setCount(e.left);
        if (e.seat === me) {
          this.myTurn = false;
          this.refreshButtons();
        }
        this.playFx(e.seat, e.combo, e.left, g.level);
        break;
      }
      case 'pass':
        this.clearStale();
        this.huds[e.seat].setDeadline(0);
        this.played[e.seat].showText('不出');
        sound.play('pass');
        sound.say(this.client.players[e.seat].voice, `pass_${1 + Math.floor(Math.random() * 3)}`);
        if (e.seat === me) { this.myTurn = false; this.refreshButtons(); }
        break;
      case 'trickEnd': {
        for (const pv of this.played) pv.stale = true;
        setTimeout(() => { if (!this.destroyed) this.clearStale(); }, 900);
        if (e.jiefeng) this.toast(`${this.client.players[e.leader].name} 接风`);
        break;
      }
      case 'finish': {
        this.huds[e.seat].setPlace(e.place);
        if (e.place === 1) sound.play('shine');
        this.huds[e.seat].setCount(0);
        const partner = partnerOf(me);
        if (e.seat === me && g.isActive(partner)) this.startWatching(partner);
        else if (e.seat === this.watching) this.stopWatching();
        break;
      }
      case 'roundEnd':
        this.myTurn = false;
        this.refreshButtons();
        this.huds.forEach((h) => h.setDeadline(0));
        void wait(1400).then(() => {
          if (this.destroyed) return;
          const win = e.result.winTeam === teamOf(me);
          sound.play(win ? 'win' : 'lose');
          if (win) this.fx.confetti();
          this.showRoundEnd(e.result);
        });
        break;
      case 'auto':
        this.huds[e.seat].setAuto(e.on);
        if (e.seat === me) {
          this.refreshButtons();
          this.refreshReturnBar();
        }
        break;
      case 'presence':
        this.huds[e.seat].setOffline(!e.online);
        if (e.seat !== me) this.toast(`${this.client.players[e.seat].name} ${e.online ? '已重新连接' : '断线了，由电脑代打'}`);
        break;
      case 'error':
        this.toast(e.msg);
        break;
      case 'nextWait':
        if (e.waiting.length && !e.waiting.includes(me) && !this.overlay.children.length) {
          this.toast(`等待 ${e.waiting.map((s) => this.client.players[s].name).join('、')} 继续…`);
        }
        break;
      case 'sync':
        this.loadState();
        break;
      case 'reveal':
        break;
      case 'chat':
        this.chat.onChat(e);
        break;
    }
  }

  /** 断线重连后根据完整状态重建界面 */
  private loadState() {
    const g = this.client.game;
    const me = this.client.mySeat;
    this.clearOverlay();
    for (const pv of this.played) pv.clear();
    this.stopWatching();
    const counts = g.handCounts();
    this.huds.forEach((h, s) => {
      h.setPlace(g.finishOrder.indexOf(s) + 1);
      h.setCount(counts[s]);
      h.setDeadline(0);
      h.setAuto(this.client.isAuto(s));
      h.setOffline(!this.client.isOnline(s));
    });
    this.updateInfo();
    const partner = partnerOf(me);
    if (!g.isActive(me) && g.isActive(partner) && g.hands[partner].length) this.startWatching(partner);
    else this.hand.setHand(g.hands[me], g.level);
    if (g.lastPlay) this.played[g.lastPlay.seat].showCards(g.lastPlay.combo.cards, g.level);
    this.myTurn = g.phase === 'play' && g.turn === me;
    this.hintList = [];
    this.refreshButtons();
    this.refreshReturnBar();
  }

  private startWatching(seat: number) {
    const g = this.client.game;
    this.watching = seat;
    this.hand.enabled = false;
    this.hand.setHand(g.hands[seat], g.level);
    this.sortBtn.visible = false;
    this.watchTag.text = `对家 ${this.client.players[seat].name} 的手牌（仅可查看）`;
    this.watchTag.visible = true;
    this.refreshButtons();
  }

  private stopWatching() {
    this.watching = -1;
    this.hand.enabled = true;
    this.sortBtn.visible = true;
    this.watchTag.visible = false;
    this.refreshButtons();
  }

  /** 出牌音效、语音、牌型特效 */
  private playFx(seat: number, combo: Combo, left: number, level: number) {
    const voice = this.client.players[seat].voice;
    sound.play('play');
    sound.say(voice, sound.comboKey(combo, level));
    const pv = this.played[seat];
    const c = pv.center(combo.cards.length);
    const at = this.toLocal(pv.toGlobal(new Point(c.x, c.y)));
    switch (combo.type) {
      case 'bomb':
        sound.play(combo.cards.length >= 6 ? 'bigbomb' : 'bomb');
        this.fx.bomb(at.x, at.y, combo.cards.length >= 6);
        this.fx.bigText(comboName(combo) + '!', [0xffe58a, 0xff4a1a]);
        break;
      case 'straightflush':
        sound.play('shine');
        sound.play('bomb');
        this.fx.straightFlush(at.x, at.y);
        this.fx.bigText('同花顺!', [0xfff3a0, 0xff7a2a]);
        break;
      case 'jokerbomb':
        sound.play('bigbomb');
        void this.fx.jokerBomb();
        this.fx.bigText('天王炸!', [0xfff6c0, 0xffb020], 88);
        break;
      case 'straight': case 'tube': case 'plate': case 'fullhouse':
        this.fx.comboLabel(comboName(combo), at.x, at.y + 62);
        break;
    }
    if (left > 0 && left <= 2) {
      setTimeout(() => { sound.play('warn'); sound.say(voice, `warn_${left}`); }, 900);
    }
    if (left > 0 && left <= 10 && !this.warned.has(seat)) {
      this.warned.add(seat);
      if (left > 2) sound.play('warn');
      this.toast(`${this.client.players[seat].name} 只剩 ${left} 张牌`);
    }
  }

  private clearStale() {
    for (const pv of this.played) if (pv.stale) pv.clear();
  }

  private updateInfo() {
    const g = this.client.game;
    const myTeam = teamOf(this.client.mySeat);
    this.infoRank.text = rankName(g.level);
    this.infoRank.scale.x = g.level === 10 ? 0.75 : 1;
    this.infoLevel.text = `本局打 ${rankName(g.level)}${g.levelTeam === myTeam ? '·我方' : '·对方'}`;
    this.infoTeams.text = `我方 ${rankName(g.levels[myTeam])}   对方 ${rankName(g.levels[1 - myTeam])}`;
  }

  private refreshButtons() {
    const g = this.client.game;
    const auto = this.client.isAuto(this.client.mySeat);
    const show = this.myTurn && !auto && g.phase === 'play';
    this.actionBar.visible = show;
    this.autoBar.visible = auto;
    this.autoBtn.visible = !auto && this.watching < 0;
    if (show) {
      this.passBtn.enabled = !!g.lastPlay;
      this.playBtn.enabled = this.hand.selected.size > 0;
    }
    this.returnBtn.enabled = this.hand.selected.size === 1;
  }

  private refreshReturnBar() {
    const g = this.client.game;
    const me = this.client.mySeat;
    this.returnBar.visible = g.phase === 'return' && g.pendingReturns.some((p) => p.from === me) && !this.client.isAuto(me);
    this.refreshButtons();
  }

  // ---------- 操作 ----------

  private doPass() {
    const err = this.client.pass();
    if (err) this.toast(err);
    else this.hand.clearSelection();
  }

  private doHint() {
    if (!this.hintList.length) {
      this.hintList = this.client.hints();
      this.hintIdx = 0;
    }
    if (!this.hintList.length) {
      this.toast('没有能大过上家的牌');
      return;
    }
    const c = this.hintList[this.hintIdx % this.hintList.length];
    this.hintIdx++;
    this.hand.select(c.cards);
  }

  private doPlay() {
    const ids = [...this.hand.selected];
    const g = this.client.game;
    const opts = resolvePlay(ids, g.level, g.lastPlay?.combo ?? null);
    const types = [...new Set(opts.map((o) => o.type))];
    if (types.length > 1) {
      this.showChooser(ids, types.map((t) => opts.find((o) => o.type === t)!));
      return;
    }
    const err = this.client.play(ids, opts[0]);
    if (err) this.toast(err);
  }

  private doReturn() {
    const ids = [...this.hand.selected];
    if (ids.length !== 1) { this.toast('请选择一张牌'); return; }
    const err = this.client.returnTribute(ids[0]);
    if (err) this.toast(err);
  }

  // ---------- 弹出层 ----------

  private clearOverlay() {
    this.overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  private panel(w: number, h: number, title: string): Container {
    this.clearOverlay();
    const root = new Container();
    const mask = new Graphics();
    root.addChild(mask);
    const box = new Container();
    const bg = new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, 22).fill({ color: 0x5a2e10 })
      .roundRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 18).fill({ color: 0xfff4dc })
      .roundRect(-w / 2 + 6, -h / 2 + 6, w - 12, 64, 18).fill({ color: 0xe39a2c });
    const t = new Text({ text: title, style: { fontFamily: FONT_UI, fontSize: 32, fontWeight: '900', fill: 0xffffff, stroke: { color: 0x7a3b00, width: 5 } } });
    t.anchor.set(0.5);
    t.y = -h / 2 + 38;
    box.addChild(bg, t);
    root.addChild(box);
    (root as any).relayout = (DW: number, DH: number) => {
      mask.clear().rect(0, 0, DW, DH).fill({ color: 0x000000, alpha: 0.45 });
      box.position.set(DW / 2, DH / 2);
    };
    (root as any).relayout(this.DW, this.DH);
    mask.eventMode = 'static';
    box.eventMode = 'static';
    this.overlay.addChild(root);
    box.scale.set(0.7);
    tween(box, { scale: 1 }, 260, { ease: ease.outBack });
    return box;
  }

  private addLabel(parent: Container, text: string, x: number, y: number, size = 24, color = 0x5a2e10, anchor = 0.5) {
    const t = new Text({ text, style: { fontFamily: FONT_UI, fontSize: size, fontWeight: '700', fill: color } });
    t.anchor.set(anchor, 0.5);
    t.position.set(x, y);
    parent.addChild(t);
    return t;
  }

  private showChooser(ids: number[], opts: Combo[]) {
    const box = this.panel(420, 160 + opts.length * 80, '选择牌型');
    opts.forEach((o, i) => {
      const b = new Button(comboName(o), i === 0 ? 'orange' : 'blue', 260, 60, () => {
        this.clearOverlay();
        const err = this.client.play(ids, o);
        if (err) this.toast(err);
      });
      b.y = -((opts.length - 1) * 80) / 2 + i * 80 + 20;
      box.addChild(b);
    });
  }

  private showMenu() {
    const box = this.panel(420, this.client.canRestart ? 410 : 330, '菜单');
    const items: [string, 'orange' | 'blue' | 'gray', () => void][] = this.client.canRestart
      ? [
        ['继续游戏', 'orange', () => this.clearOverlay()],
        ['重新开始', 'blue', () => { this.clearOverlay(); this.client.restart(); }],
        ['返回大厅', 'gray', () => this.onExit()],
      ]
      : [
        ['继续游戏', 'orange', () => this.clearOverlay()],
        ['离开房间', 'gray', () => this.onExit()],
      ];
    items.splice(1, 0, ['设置', 'blue', () => this.showSettings()]);
    items.forEach(([t, st, fn], i) => {
      const b = new Button(t, st, 260, 60, fn);
      b.y = (this.client.canRestart ? -90 : -50) + i * 80;
      box.addChild(b);
    });
  }

  private showSettings() {
    const box = this.panel(480, 520, '设置');
    const rows: [string, () => string, () => void][] = [
      ['音效', () => (sound.settings.sfx ? '开' : '关'), () => sound.save({ sfx: !sound.settings.sfx })],
      ['背景音乐', () => (sound.settings.music ? '开' : '关'), () => sound.save({ music: !sound.settings.music })],
      ['出牌语音', () => (sound.settings.voice ? '开' : '关'), () => sound.save({ voice: !sound.settings.voice })],
      ['我的声音', () => (sound.settings.myVoice === 'male' ? '男声' : '女声'), () => sound.save({ myVoice: sound.settings.myVoice === 'male' ? 'female' : 'male' })],
      ['智能选牌', () => (prefs.autoPick ? '开' : '关'), () => savePrefs({ autoPick: !prefs.autoPick })],
    ];
    rows.forEach(([label, value, toggle], i) => {
      const y = -150 + i * 64;
      this.addLabel(box, label, -170, y, 26, 0x5a2e10, 0);
      const btn = new Button(value(), 'green', 130, 50, () => {
        toggle();
        btn.text = value();
        sound.play('click');
      });
      btn.position.set(140, y);
      box.addChild(btn);
    });
    this.addLabel(box, '“我的声音”从下一盘开始生效', 0, 150, 18, 0x9a6b2a);
    const ok = new Button('完成', 'orange', 160, 54, () => this.clearOverlay());
    ok.y = 205;
    box.addChild(ok);
  }

  private showRoundEnd(r: RoundResult) {
    const me = this.client.mySeat;
    const myTeam = teamOf(me);
    const win = r.winTeam === myTeam;
    const title = r.gameOver ? (win ? '恭喜过 A，赢得整盘！' : '对方过 A，本盘结束') : win ? '本局胜利' : '本局失利';
    const box = this.panel(620, 470, title);
    const places = ['头游', '二游', '三游', '末游'];
    r.order.forEach((seat, i) => {
      const y = -130 + i * 50;
      const ally = teamOf(seat) === myTeam;
      this.addLabel(box, places[i], -200, y, 26, 0xc2410c);
      this.addLabel(box, this.client.players[seat].name + (seat === me ? '（我）' : ''), -110, y, 26, ally ? 0x8a5a00 : 0x2f5fa8, 0);
      this.addLabel(box, ally ? '我方' : '对方', 200, y, 22, 0x666666);
    });
    const up = r.up;
    const lvl = (t: number) => `${rankName(r.levelsBefore[t])} → ${rankName(r.levelsAfter[t])}`;
    this.addLabel(box, `我方 ${lvl(myTeam)}　　对方 ${lvl(1 - myTeam)}`, 0, 80, 24, 0x5a2e10);
    this.addLabel(box, r.gameOver ? '' : `${r.winTeam === myTeam ? '我方' : '对方'}升 ${up} 级`, 0, 116, 22, 0x9a6b2a);
    if (r.note) this.addLabel(box, r.note, 0, 146, 20, 0xc0392b);
    const btn = new Button(r.gameOver ? '再来一盘' : '下一局', 'orange', 220, 64, () => {
      this.clearOverlay();
      if (r.gameOver && this.client.canRestart) this.client.restart(); else this.client.nextRound();
      if (!this.client.canRestart) this.toast('等待其他玩家…');
    });
    btn.y = 196;
    box.addChild(btn);
  }

  // ---------- 特效 ----------

  toast(text: string) {
    const bg = this.toastBox.getChildAt(0) as Graphics;
    this.toastText.text = text;
    const w = this.toastText.width + 60;
    bg.clear().roundRect(-w / 2, -26, w, 52, 26).fill({ color: 0x000000, alpha: 0.65 });
    this.toastBox.alpha = 1;
    tween(this.toastBox, { alpha: 0 }, 400, { delay: 1500 });
  }

  private seatPoint(seat: number): Point {
    return this.huds[seat].position.clone();
  }

  private flyCard(id: number, from: number, to: number) {
    const c = new Sprite(cardTexture(id));
    c.anchor.set(0.5);
    c.width = CARD_W; c.height = CARD_H;
    const a = this.seatPoint(from), b = this.seatPoint(to);
    c.position.copyFrom(a);
    c.scale.set(0.3);
    this.fx.addChild(c);
    const mid = new Point((a.x + b.x) / 2, (a.y + b.y) / 2);
    void tween(c, { x: mid.x, y: mid.y, scale: 0.7 }, 350)
      .then(() => tween(c, { x: b.x, y: b.y, scale: 0.3 }, 350, { delay: 250 }))
      .then(() => c.destroy());
  }
}

