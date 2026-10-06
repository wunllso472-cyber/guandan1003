// 音频：Web Audio 合成音效与背景音乐 + 预录语音播报。
// 手机浏览器要求在用户手势里解锁 AudioContext，见 unlock()。
import { card } from '@shared/cards';
import type { Combo } from '@shared/combo';
import voiceScript from '@shared/voice-script.json';

export type VoiceKind = 'male' | 'female';
type Speaker = VoiceKind | 'narrator';
type Lang = 'zh' | 'ne' | 'yue';

export interface AudioSettings {
  sfx: boolean; music: boolean; voice: boolean; myVoice: VoiceKind;
  /** 方言彩蛋：不出、压牌、炸弹惊呼偶尔说东北话或粤语 */
  dialect: boolean;
}

/** 方言出现的概率（各自），压牌代替牌型播报的概率，炸弹后接惊呼的概率 */
const DIALECT_RATE = 0.1;
const BEAT_RATE = 0.3;
const BOOM_RATE = 0.5;

interface ScriptLine { category: string; key: string; lang: Lang; speaker: 'player' | 'narrator'; text: string }
const LINES = (voiceScript as { lines: ScriptLine[] }).lines;
const poolCache = new Map<string, string[]>();
/** 某类台词在某种语言下的全部 key */
function pool(category: string, lang: Lang): string[] {
  const id = category + '|' + lang;
  let p = poolCache.get(id);
  if (!p) { p = LINES.filter((l) => l.category === category && l.lang === lang).map((l) => l.key); poolCache.set(id, p); }
  return p;
}
const pickOne = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const KEY = 'gd_audio';
function loadSettings(): AudioSettings {
  const def: AudioSettings = { sfx: true, music: true, voice: true, myVoice: 'male', dialect: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return def; }
}

export type Sfx =
  | 'click' | 'deal' | 'play' | 'pass' | 'select' | 'tick' | 'warn' | 'bomb' | 'bigbomb' | 'shine'
  | 'win' | 'lose' | 'tribute' | 'chat' | 'flower' | 'heart' | 'beer' | 'egg' | 'boom' | 'turn'
  | 'whoosh' | 'fuse' | 'thump' | 'sparkle' | 'punch';

class SoundEngine {
  settings = loadSettings();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private voiceBus!: GainNode;
  private noise!: AudioBuffer;
  private voices = new Map<string, Promise<AudioBuffer | null>>();
  /** 正在播放的语音：优先级高的不会被低的打断 */
  private speaking: { src: AudioBufferSourceNode; prio: number; until: number } | null = null;
  private bgm: Bgm | null = null;

  /** 在用户点击时调用一次 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx: AudioContext = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor();
      comp.connect(this.master);
      this.sfxBus = this.bus(comp, 0.8);
      this.musicBus = this.bus(comp, 0.32);
      this.voiceBus = this.bus(comp, 1.0);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.applySettings();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void ctx.suspend();
        else void ctx.resume();
      });
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  private bus(to: AudioNode, gain: number) {
    const g = this.ctx!.createGain();
    g.gain.value = gain;
    g.connect(to);
    return g;
  }

  save(s: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...s };
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* 忽略 */ }
    this.applySettings();
  }

  private applySettings() {
    if (!this.ctx) return;
    this.sfxBus.gain.value = this.settings.sfx ? 0.8 : 0;
    this.voiceBus.gain.value = this.settings.voice ? 1 : 0;
    if (this.settings.music) this.startMusic(); else this.stopMusic();
  }

  // ---------- 背景音乐 ----------
  private wantMusic = false;
  setMusicWanted(on: boolean) {
    this.wantMusic = on;
    if (on && this.settings.music) this.startMusic(); else this.stopMusic();
  }
  private startMusic() {
    if (!this.ctx || !this.wantMusic || this.bgm) return;
    this.bgm = new Bgm(this.ctx, this.musicBus);
  }
  private stopMusic() {
    this.bgm?.stop();
    this.bgm = null;
  }

  // ---------- 语音 ----------
  private loadVoice(speaker: Speaker, key: string): Promise<AudioBuffer | null> {
    const id = `${speaker}/${key}`;
    let p = this.voices.get(id);
    if (!p) {
      const ctx = this.ctx!;
      p = fetch(`${import.meta.env.BASE_URL}voice/${id}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(b, res, rej)))
        .catch(() => null);
      this.voices.set(id, p);
    }
    return p;
  }

  /** 预加载常用语音（普通话的出牌、不出、压牌、报牌，以及系统播报），方言台词用到时再加载 */
  preloadVoices(kinds: VoiceKind[]) {
    if (!this.ctx) return;
    const common = new Set(['出牌·单张', '出牌·对子', '出牌·三张', '出牌·牌型', '压牌', '不出', '炸弹惊呼', '报牌']);
    for (const l of LINES) {
      if (l.lang !== 'zh') continue;
      if (l.speaker === 'narrator') void this.loadVoice('narrator', l.key);
      else if (common.has(l.category)) for (const k of kinds) void this.loadVoice(k, l.key);
    }
  }

  /**
   * 播放一句语音。prio：1 普通（出牌、不出、快捷语），2 重要（炸弹、报牌、系统播报）。
   * 正在播放更重要的语音时，普通语音直接跳过；否则打断当前语音。说话时背景音乐自动调低。
   */
  async say(speaker: Speaker, key: string, prio = 1, delay = 0) {
    if (!this.ctx || !this.settings.voice) return;
    const buf = await this.loadVoice(speaker, key);
    if (!buf || !this.ctx) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + delay;
    const cur = this.speaking;
    if (cur && cur.until > start) {
      if (cur.prio > prio) return;
      try { cur.src.stop(); } catch { /* 已结束 */ }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.voiceBus);
    src.start(start);
    const until = start + buf.duration;
    this.speaking = { src, prio, until };
    this.duckMusic(start, until);
  }

  /** 说话期间把背景音乐压低到 35% */
  private duckMusic(from: number, to: number) {
    if (!this.settings.music) return;
    const g = this.musicBus.gain;
    const base = 0.32;
    g.cancelScheduledValues(from);
    g.setTargetAtTime(base * 0.35, from, 0.05);
    g.setTargetAtTime(base, to + 0.15, 0.25);
  }

  /** 随机选语言：开启方言彩蛋时东北话、粤语各约 10% */
  private pickLang(): Lang {
    if (!this.settings.dialect) return 'zh';
    const r = Math.random();
    return r < DIALECT_RATE ? 'ne' : r < DIALECT_RATE * 2 ? 'yue' : 'zh';
  }

  /** 从某类台词里随机挑一句（按语言概率，没有该语言版本时用普通话） */
  private pickLine(category: string): string | null {
    const keys = pool(category, this.pickLang());
    const list = keys.length ? keys : pool(category, 'zh');
    return list.length ? pickOne(list) : null;
  }

  /** 出牌播报：beat 表示这手牌压过了上家（不是首出） */
  sayPlay(voice: VoiceKind, c: Combo, level: number, beat: boolean) {
    const bomb = c.type === 'bomb' || c.type === 'straightflush' || c.type === 'jokerbomb';
    if (beat && !bomb && Math.random() < BEAT_RATE) {
      const k = this.pickLine('压牌');
      if (k) { void this.say(voice, k, 1); return; }
    }
    void this.say(voice, this.comboKey(c, level), bomb ? 2 : 1);
    if (bomb && Math.random() < BOOM_RATE) {
      const k = this.pickLine('炸弹惊呼');
      if (k) setTimeout(() => void this.say(voice, k, 2), 750);
    }
  }

  sayPass(voice: VoiceKind) {
    const k = this.pickLine('不出');
    if (k) void this.say(voice, k, 1);
  }

  sayWarn(voice: VoiceKind, left: number) {
    if (left === 1 || left === 2) void this.say(voice, `warn_${left}`, 2);
  }

  /** 系统播报 */
  narrate(key: string) {
    void this.say('narrator', key, 2);
  }

  /** 出牌播报对应的语音 key */
  comboKey(c: Combo, level: number): string {
    const rank = (id: number) => card(id).rank;
    const r = c.cards.length ? rank(c.cards[0]) : level;
    // 逢人配单出时按级牌报
    const isWildOnly = c.cards.every((id) => card(id).suit === 'H' && card(id).rank === level);
    const rr = isWildOnly ? level : r;
    switch (c.type) {
      case 'single': return `single_${rr}`;
      case 'pair': return `pair_${rr}`;
      case 'triple': return `triple_${rr}`;
      case 'bomb': return c.cards.length >= 6 ? 'bomb_big' : 'bomb';
      default: return c.type;
    }
  }

  // ---------- 音效 ----------
  play(name: Sfx) {
    if (!this.ctx || !this.settings.sfx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    switch (name) {
      case 'click': this.tone(880, 0.06, 'triangle', 0.25, t, 1200); break;
      case 'select': this.tone(1300, 0.03, 'sine', 0.12, t); break;
      case 'turn': this.tone(660, 0.12, 'sine', 0.2, t); this.tone(990, 0.15, 'sine', 0.16, t + 0.08); break;
      case 'deal': this.noiseHit(t, 0.05, 3500, 0.25, 'bandpass'); break;
      case 'play':
        this.noiseHit(t, 0.09, 2200, 0.5, 'bandpass');
        this.tone(180, 0.06, 'sine', 0.25, t, 90);
        break;
      case 'pass': this.tone(320, 0.08, 'triangle', 0.18, t, 260); break;
      case 'tick': this.tone(1500, 0.04, 'square', 0.08, t); break;
      case 'warn': this.tone(1046, 0.12, 'triangle', 0.3, t); this.tone(1318, 0.18, 'triangle', 0.3, t + 0.12); break;
      case 'tribute': this.arp([523, 659, 784], 0.07, 'triangle', 0.22, t); break;
      case 'chat': this.tone(1200, 0.06, 'sine', 0.15, t); this.tone(1600, 0.08, 'sine', 0.12, t + 0.05); break;
      case 'shine': this.arp([784, 988, 1175, 1568, 1976], 0.06, 'triangle', 0.22, t); break;
      case 'bomb': this.explosion(t, 0.9, 1); break;
      case 'bigbomb':
        this.explosion(t, 1.4, 1.3);
        this.explosion(t + 0.25, 1.1, 0.9);
        this.arp([1046, 1318, 1568, 2093], 0.09, 'triangle', 0.18, t + 0.4);
        break;
      case 'boom': this.explosion(t, 0.6, 0.6); break;
      case 'win': this.arp([523, 659, 784, 1046, 784, 1046], 0.12, 'triangle', 0.3, t); break;
      case 'lose': this.arp([659, 587, 523, 392], 0.18, 'triangle', 0.26, t); break;
      case 'flower': this.arp([1318, 1568, 1976, 2637], 0.07, 'sine', 0.2, t); break;
      case 'heart': this.tone(520, 0.15, 'sine', 0.3, t, 780); this.tone(780, 0.2, 'sine', 0.2, t + 0.12, 1040); break;
      case 'beer':
        for (const f of [2600, 3900, 5200]) this.tone(f, 0.35, 'sine', 0.08, t);
        this.noiseHit(t + 0.05, 0.3, 6000, 0.08, 'highpass');
        break;
      // 道具：扔出去的呼啸、炸弹引线嗞嗞声、心跳、闪光
      case 'whoosh': this.sweep(t, 0.38, 500, 2600, 0.16); break;
      case 'fuse':
        for (let i = 0; i < 12; i++) this.noiseHit(t + i * 0.06 + Math.random() * 0.03, 0.025, 5500 + Math.random() * 2500, 0.1, 'highpass');
        break;
      case 'thump': this.tone(90, 0.12, 'sine', 0.45, t, 55); this.tone(80, 0.14, 'sine', 0.35, t + 0.2, 50); break;
      case 'sparkle': this.arp([2093, 2637, 3136, 4186], 0.045, 'sine', 0.07, t); break;
      case 'punch':
        // 闷响 + 拍击声
        this.noiseHit(t, 0.09, 900, 0.4, 'lowpass');
        this.noiseHit(t, 0.03, 2800, 0.14, 'bandpass');
        this.tone(150 + Math.random() * 40, 0.09, 'sine', 0.35, t, 60);
        break;
      case 'egg':
        this.noiseHit(t, 0.06, 1800, 0.4, 'bandpass');
        this.noiseHit(t + 0.05, 0.25, 600, 0.35, 'lowpass');
        this.tone(140, 0.2, 'sine', 0.3, t + 0.03, 60);
        break;
    }
  }

  private env(g: GainNode, t: number, vol: number, dur: number, attack = 0.005) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, t: number, toFreq?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    this.env(g, t, vol, dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private arp(freqs: number[], step: number, type: OscillatorType, vol: number, t: number) {
    freqs.forEach((f, i) => this.tone(f, step * 2.2, type, vol, t + i * step));
  }

  private noiseHit(t: number, dur: number, freq: number, vol: number, type: BiquadFilterType) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, vol, dur, 0.002);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** 带通噪声扫频（呼啸声） */
  private sweep(t: number, dur: number, f0: number, f1: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, vol, dur, dur * 0.6);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private explosion(t: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = ctx.createGain();
    this.env(g, t, vol, dur, 0.004);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.1);
    this.tone(110, dur * 0.8, 'sine', vol * 0.9, t, 35);
  }
}

/** 程序生成的五声音阶背景音乐（古筝风格拨弦 + 低音 + 木鱼） */
class Bgm {
  private timer: ReturnType<typeof setInterval>;
  private next = 0;
  private step = 0;
  private out: GainNode;
  private melody: number[] = [];
  private stopped = false;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2);
    this.out.connect(dest);
    this.compose();
    this.next = ctx.currentTime + 0.2;
    this.timer = setInterval(() => this.schedule(), 100);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value || 0.0001, t);
    this.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    setTimeout(() => this.out.disconnect(), 1000);
  }

  /** 随机生成 8 小节旋律（每小节 8 个八分音符位，-1 为休止） */
  private compose() {
    // D 宫五声音阶：D E F# A B
    const scale = [0, 2, 4, 7, 9];
    const notes: number[] = [];
    for (let o = 0; o < 2; o++) for (const s of scale) notes.push(62 + o * 12 + s);
    let idx = 4;
    const m: number[] = [];
    for (let bar = 0; bar < 8; bar++) {
      for (let i = 0; i < 8; i++) {
        const rest = Math.random() < (i % 2 ? 0.45 : 0.15);
        if (rest) { m.push(-1); continue; }
        idx = Math.max(0, Math.min(notes.length - 1, idx + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
        // 每两小节结尾落在主音
        if (bar % 2 === 1 && i === 6) idx = bar === 7 ? 0 : 5;
        m.push(notes[idx]);
      }
    }
    this.melody = m;
  }

  private schedule() {
    const beat = 60 / 88 / 2; // 八分音符
    while (this.next < this.ctx.currentTime + 0.4) {
      const i = this.step % this.melody.length;
      const t = this.next;
      const n = this.melody[i];
      if (n > 0) this.pluck(n, t, 0.16);
      if (i % 8 === 0) {
        const root = [50, 45, 47, 43][Math.floor(i / 16) % 4];
        this.bass(root, t, beat * 7.5);
      }
      if (i % 4 === 2) this.wood(t);
      this.next += beat;
      this.step++;
      if (this.step % (this.melody.length * 2) === 0) this.compose();
    }
  }

  private freq(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }

  private pluck(m: number, t: number, vol: number) {
    const ctx = this.ctx;
    const f = this.freq(m);
    for (const [mult, v, type] of [[1, 1, 'triangle'], [2, 0.35, 'sine'], [3, 0.12, 'sine']] as [number, number, OscillatorType][]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f * mult * 1.012, t);
      o.frequency.exponentialRampToValueAtTime(f * mult, t + 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1 / mult);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + 1.2);
    }
  }

  private bass(m: number, t: number, dur: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = this.freq(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  private wood(t: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1050, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.1);
  }
}

export const sound = new SoundEngine();
