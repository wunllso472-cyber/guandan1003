// 把 gen-voice.ps1 生成的 wav 去掉首尾静音、音量归一后编码成 mp3，输出到 client/public/voice/
// 用法：node scripts/encode-voice.mjs <wav目录>
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Mp3Encoder } from '@breezystack/lamejs';

const src = process.argv[2] ?? 'voice-wav';
const out = 'client/public/voice';

function readWav(buf) {
  let off = 12, fmt = null, data = null;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16 || fmt.channels !== 1) throw new Error('只支持 16 位单声道 wav');
  return { rate: fmt.rate, samples: new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length)) };
}

function trim(s, rate) {
  const th = 400;
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]) < th) a++;
  while (b > a && Math.abs(s[b]) < th) b--;
  const pad = Math.round(rate * 0.03);
  return s.slice(Math.max(0, a - pad), Math.min(s.length, b + pad));
}

function normalize(s) {
  let peak = 1;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const g = Math.min(4, 29000 / peak);
  return s.map((v) => Math.max(-32768, Math.min(32767, Math.round(v * g))));
}

let total = 0, count = 0;
for (const kind of ['male', 'female']) {
  mkdirSync(join(out, kind), { recursive: true });
  for (const f of readdirSync(join(src, kind)).filter((x) => x.endsWith('.wav'))) {
    const { rate, samples } = readWav(readFileSync(join(src, kind, f)));
    const pcm = normalize(trim(samples, rate));
    const enc = new Mp3Encoder(1, rate, 32);
    const parts = [];
    for (let i = 0; i < pcm.length; i += 1152) parts.push(enc.encodeBuffer(pcm.subarray(i, i + 1152)));
    parts.push(enc.flush());
    const mp3 = Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length)));
    writeFileSync(join(out, kind, f.replace('.wav', '.mp3')), mp3);
    total += mp3.length; count++;
  }
}
console.log(`编码完成：${count} 个文件，共 ${(total / 1024).toFixed(0)} KB`);
