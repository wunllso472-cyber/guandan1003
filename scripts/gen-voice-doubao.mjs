// 用豆包语音（seed-audio-1.0）按台词表批量生成语音。
//
// 用法：
//   node scripts/gen-voice-doubao.mjs                 生成全部（已生成的跳过）
//   node scripts/gen-voice-doubao.mjs --only bomb,pass_1   只（重新）生成指定台词
//   node scripts/gen-voice-doubao.mjs --speaker male  只生成某个音色
//   node scripts/gen-voice-doubao.mjs --force         忽略缓存全部重新生成
//   node scripts/gen-voice-doubao.mjs --check         不调用接口，列出已生成语音里时长偏长（可能拖音）的短台词
//   node scripts/gen-voice-doubao.mjs --only pair_3 --tries 3
//       每句生成 3 个版本，挑时长最接近“字数 × 0.28 秒”的（干脆、不拖音）
//
// 密钥从环境变量 DOUBAO_API_KEY 或 .env.local 读取（不要提交到仓库）。
// 原始 wav 缓存在 voice-raw/（已加入 .gitignore），处理后的 mp3 输出到 client/public/voice/<音色>/<key>.mp3。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Mp3Encoder } from '@breezystack/lamejs';

const API = 'https://openspeech.bytedance.com/api/v3/tts/create';
const RAW_DIR = 'voice-raw';
const OUT_DIR = 'client/public/voice';
const CONCURRENCY = 4;

// ---------- 参数与密钥 ----------
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
const onlySpeaker = opt('--speaker');
const force = args.includes('--force');
const tries = Math.max(1, Number(opt('--tries') ?? 1));

function apiKey() {
  if (process.env.DOUBAO_API_KEY) return process.env.DOUBAO_API_KEY;
  try {
    const m = readFileSync('.env.local', 'utf8').match(/^DOUBAO_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* 没有 .env.local */ }
  throw new Error('缺少 DOUBAO_API_KEY（设置环境变量或写入 .env.local）');
}

// ---------- 人设与语气 ----------
const PERSONA = {
  male: { zh: '一位二十多岁的年轻男性，标准普通话，嗓音清亮、有活力', ne: '一位二十多岁的东北年轻男性，地道东北口音，豪爽热情', yue: '一位二十多岁的广东年轻男性，说地道粤语（广东话），语气爽朗' },
  female: { zh: '一位二十多岁的年轻女性，标准普通话，嗓音甜美、清脆', ne: '一位二十多岁的东北年轻女性，地道东北口音，爽快泼辣', yue: '一位二十多岁的广东年轻女性，说地道粤语（广东话），语气活泼' },
  narrator: { zh: '一位专业的女性游戏播报员，标准普通话，吐字清晰' },
};

/** 各类台词的语气描述与相对音量（1 = 最响） */
const STYLE = {
  '出牌·单张': ['语速稍快、短促干脆地说（不要拖长音）', 0.8],
  '出牌·对子': ['语速稍快、短促干脆地说（不要拖长音）', 0.8],
  '出牌·三张': ['语速稍快、短促干脆地说（不要拖长音）', 0.8],
  '出牌·牌型': ['干脆利落、略带得意地说', 0.85],
  压牌: ['自信、带点得意地说', 0.85],
  不出: ['随意、略带无奈地轻声说', 0.65],
  炸弹惊呼: ['兴奋激动地大声喊', 1],
  报牌: ['用提醒大家的语气、略带得意地说', 0.85],
  快捷语: ['自然地说', 0.8],
  系统播报: ['平稳清晰地播报', 0.75],
};

/** 个别台词单独指定语气 */
const LINE_STYLE = {
  bomb: ['激动兴奋地大声喊', 1],
  bomb_big: ['非常激动、气势十足地大声喊', 1],
  straightflush: ['激动兴奋地大声喊', 1],
  jokerbomb: ['极其激动、霸气十足地大声喊', 1],
  anti_tribute: ['语气上扬、略带惊喜地播报', 0.8],
  double_win: ['兴奋地播报', 0.85],
  pass_a: ['热烈欢快地播报', 0.9],
  a_fail: ['略带遗憾地播报', 0.7],
  game_open: ['非常兴奋、热情洋溢地大声喊', 1],
  phrase_0: ['不耐烦地催促', 0.8],
  phrase_1: ['由衷赞叹地说', 0.8],
  phrase_2: ['自信满满地说', 0.85],
  phrase_3: ['得意又客气地说', 0.8],
  phrase_4: ['豪迈地说', 0.85],
  phrase_5: ['开心地说', 0.8],
  phrase_6: ['沮丧地叹气说', 0.7],
  phrase_7: ['热情友好地打招呼', 0.8],
  phrase_8: ['起哄、调侃地大声说', 0.9],
  phrase_9: ['调侃、开玩笑地说', 0.85],
  phrase_10: ['前半句文绉绉地拖长腔朗诵，后半句自豪地自我介绍', 0.85],
  phrase_11: ['俏皮、自嘲地说', 0.85],
  phrase_ne_0: ['不耐烦地催促', 0.8],
  phrase_ne_1: ['得意地说', 0.85],
  phrase_ne_2: ['惊喜地感叹', 0.85],
  phrase_ne_3: ['豪爽地说', 0.85],
  phrase_yue_0: ['不耐烦地催促', 0.8],
  phrase_yue_1: ['开心地称赞', 0.8],
  phrase_yue_2: ['豪爽地说', 0.85],
  phrase_yue_3: ['无奈地叹气说', 0.7],
};

function buildPrompt(line, speaker) {
  const persona = PERSONA[speaker][line.lang] ?? PERSONA[speaker].zh;
  const [style] = LINE_STYLE[line.key] ?? STYLE[line.category] ?? ['自然地说', 0.8];
  return `纯人声录音，只有一个人说话，没有任何背景音乐、环境音和音效。${persona}${style}：“${line.text}”`;
}

function gainOf(line) {
  return (LINE_STYLE[line.key] ?? STYLE[line.category] ?? [null, 0.8])[1];
}

// ---------- 调用接口 ----------
async function synth(prompt, key) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
        body: JSON.stringify({
          model: 'seed-audio-1.0',
          text_prompt: prompt,
          audio_config: { format: 'wav', sample_rate: 24000, pitch_rate: 0, speech_rate: 0, loudness_rate: 0 },
          watermark: {},
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.headers.get('x-tt-logid') ?? ''} ${text.slice(0, 200)}`);
      const j = JSON.parse(text);
      if (!j.audio) throw new Error('返回中没有 audio：' + text.slice(0, 200));
      return Buffer.from(j.audio, 'base64');
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// ---------- 音频处理 ----------
function readWav(buf) {
  let off = 12, fmt = null, data = null;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + Math.min(size, buf.length - off - 8));
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error('不支持的 wav 格式');
  const n = Math.floor(data.length / 2 / fmt.channels);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2);
    mono[i] = s / fmt.channels;
  }
  return { rate: fmt.rate, mono };
}

/** 去掉首尾静音：连续两个 20ms 窗口都超过峰值的 8% 才算开始说话（忽略零星杂音、呼吸声），两端保留 40ms */
function trim(s, rate) {
  const win = Math.round(rate * 0.02);
  let peak = 1;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const th = peak * 0.08;
  const loud1 = (i) => { let m = 0; for (let j = Math.max(0, i); j < Math.min(s.length, i + win); j++) m = Math.max(m, Math.abs(s[j])); return m > th; };
  const loud = (i, dir) => loud1(i) && loud1(i + dir * win);
  let a = 0, b = s.length - win;
  while (a < s.length && !loud(a, 1)) a += win;
  while (b > a && !loud(b, -1)) b -= win;
  const pad = Math.round(rate * 0.04);
  return s.subarray(Math.max(0, a - pad), Math.min(s.length, b + win + pad));
}

/** 峰值归一到 gain × 满幅的 90%，两端 10ms 淡入淡出 */
function finish(s, rate, gain) {
  let peak = 1;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const g = (32767 * 0.9 * gain) / peak;
  const fade = Math.round(rate * 0.01);
  const out = new Int16Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const f = Math.min(1, i / fade, (s.length - 1 - i) / fade);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s[i] * g * f)));
  }
  return out;
}

function encodeMp3(pcm, rate) {
  const enc = new Mp3Encoder(1, rate, 40);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) parts.push(enc.encodeBuffer(pcm.subarray(i, i + 1152)));
  parts.push(enc.flush());
  return Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length)));
}

// ---------- 主流程 ----------
const script = JSON.parse(readFileSync('shared/voice-script.json', 'utf8'));
const jobs = [];
for (const line of script.lines) {
  const speakers = line.speaker === 'narrator' ? ['narrator'] : ['male', 'female'];
  for (const sp of speakers) {
    if (onlySpeaker && sp !== onlySpeaker) continue;
    if (only && !only.includes(line.key)) continue;
    jobs.push({ line, speaker: sp });
  }
}

if (args.includes('--check')) {
  const slow = [];
  for (const { line, speaker } of jobs) {
    const rawPath = join(RAW_DIR, speaker, `${line.key}.wav`);
    if (!existsSync(rawPath)) { slow.push(`${speaker}/${line.key} 未生成`); continue; }
    const { rate, mono } = readWav(readFileSync(rawPath));
    const n = [...line.text.replace(/[，！？。、…\s]/g, '')].length;
    const sec = trim(mono, rate).length / rate;
    if (n <= 4 && sec / n > 0.42) slow.push(`${speaker}/${line.key}「${line.text}」 ${sec.toFixed(2)}s`);
  }
  console.log(slow.length ? `时长偏长 ${slow.length} 条：\n` + slow.join('\n') : '没有时长偏长的短台词');
  console.log('需要重做的 key：' + [...new Set(slow.map((x) => x.split(/[/「 ]/)[1]))].join(','));
  process.exit(0);
}

const key = apiKey();
let done = 0, failed = 0, cached = 0;
const t0 = Date.now();
async function worker() {
  for (;;) {
    const job = jobs.shift();
    if (!job) return;
    const { line, speaker } = job;
    const rawPath = join(RAW_DIR, speaker, `${line.key}.wav`);
    try {
      let raw;
      if (!force && !only && existsSync(rawPath)) { raw = readFileSync(rawPath); cached++; }
      else {
        // 多次生成时挑时长最接近理想值的版本
        const ideal = [...line.text.replace(/[，！？。、…\s]/g, '')].length * 0.28;
        let bestDiff = Infinity;
        for (let t = 0; t < tries; t++) {
          const cand = await synth(buildPrompt(line, speaker), key);
          const { rate: r, mono: m } = readWav(cand);
          const diff = Math.abs(trim(m, r).length / r - ideal);
          if (diff < bestDiff) { bestDiff = diff; raw = cand; }
        }
        mkdirSync(join(RAW_DIR, speaker), { recursive: true });
        writeFileSync(rawPath, raw);
      }
      const { rate, mono } = readWav(raw);
      const pcm = finish(trim(mono, rate), rate, gainOf(line));
      mkdirSync(join(OUT_DIR, speaker), { recursive: true });
      writeFileSync(join(OUT_DIR, speaker, `${line.key}.mp3`), encodeMp3(pcm, rate));
      done++;
      console.log(`[${done + failed}/${total}] ${speaker}/${line.key}「${line.text}」 ${(pcm.length / rate).toFixed(2)}s`);
    } catch (e) {
      failed++;
      console.error(`[${done + failed}/${total}] 失败 ${speaker}/${line.key}：${e.message}`);
    }
  }
}
const total = jobs.length;
console.log(`共 ${total} 条，并发 ${CONCURRENCY}`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`完成 ${done} 条（其中使用缓存 ${cached} 条），失败 ${failed} 条，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
if (failed) process.exitCode = 1;
