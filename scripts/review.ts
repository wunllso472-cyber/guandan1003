// 读取复盘日志（服务端 /logs），按局、按轮打印出牌和决策依据，供复盘策略时使用。
//
// 用法：npx tsx scripts/review.ts [最近几局，默认 5] [--json 文件]   （密钥读自 .env.local 的 GD_LOG_KEY）
//       npx tsx scripts/review.ts --file 本地日志.json               （读取导出的文件）
// 环境变量 GD_LOG_URL 可指定服务端地址，默认线上 Render。
import { readFileSync, writeFileSync } from 'node:fs';
import type { RoundRecord } from '../client/src/game/reviewLog';
import type { DecisionLog } from '../shared/autoplay';

const URL_BASE = process.env.GD_LOG_URL ?? 'https://guandan-server-lc5w.onrender.com/logs';
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function load(): Promise<RoundRecord[]> {
  const file = opt('--file');
  if (file) {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(d) ? d : d.rounds;
  }
  const key = process.env.GD_LOG_KEY ?? readFileSync('.env.local', 'utf8').match(/^GD_LOG_KEY=(.+)$/m)?.[1].trim();
  if (!key) throw new Error('缺少 GD_LOG_KEY（.env.local）');
  const res = await fetch(`${URL_BASE}?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`读取失败 HTTP ${res.status}`);
  return ((await res.json()) as { rounds: RoundRecord[] }).rounds;
}

function decision(tag: string, d: DecisionLog): string[] {
  const how = { advisor: '顾问首选', mc: '模拟后保留首选', 'mc-override': '模拟推翻首选', jev: 'Jev' }[d.method];
  const mc = d.mc ? `，${d.mc.mode === 'full' ? '残局' : '浅层'}模拟 ${d.mc.samples} 次，最优比首选多 ${d.mc.gain}` : '';
  const lines = [`      ${tag}：选「${d.chosen}」（${how}${mc}；阶段 ${d.stage ?? '?'}）`];
  for (const c of d.candidates.slice(0, 5)) {
    lines.push(`        · ${c.label.padEnd(10)} 分 ${String(c.score).padStart(6)}${c.mc !== undefined ? ` 模拟 ${c.mc}` : ''}  ${c.reasons.join('；')}${c.rules.length ? `  [${c.rules.join(' ')}]` : ''}`);
  }
  return lines;
}

function print(r: RoundRecord) {
  const name = (s?: number) => (s === undefined ? '' : r.players[s]?.split('（')[0] ?? `座位${s}`);
  const out: string[] = [];
  out.push(`=== ${r.at}  ${r.mode === 'local' ? '单机' : '联机'}  打 ${r.level}（双方 ${r.levels.join(' : ')}）  编号 ${r.id}${r.live ? `  【进行中，更新于 ${r.upd ?? '?'}】` : ''}`);
  out.push(`玩家：${r.players.map((p, s) => `${s}=${p}`).join('  ')}`);
  for (const [s, h] of Object.entries(r.hands)) out.push(`起手 ${name(Number(s))}（${h.length}）：${h.join(' ')}`);
  let trick = 1;
  out.push(`--- 第 1 轮`);
  for (const x of r.log) {
    if (x.t === 'trick') { if (x.note) out.push(`    ${x.note}`); out.push(`--- 第 ${++trick} 轮`); continue; }
    if (x.t === 'tribute' || x.t === 'finish') { out.push(`    ${x.t === 'finish' ? name(x.s) + ' ' : ''}${x.note}`); continue; }
    const who = name(x.s) + (x.s === r.me ? '（我）' : '');
    out.push(x.t === 'pass' ? `  ${who}：不出` : `  ${who}：${x.lead ? '首出 ' : ''}${x.c}  [${x.cards}]  剩 ${x.left}`);
    if (x.hand) out.push(`      出牌前手牌：${x.hand.join(' ')}`);
    if (x.why) out.push(...decision(x.why.source === 'timeout' ? '超时代打' : '托管', x.why));
    if (x.sug) out.push(...decision('手动出牌，策略当时建议', x.sug));
    if (x.hint) out.push(...decision('点了提示', x.hint));
  }
  if (r.pending) {
    const c = r.pending.ctx;
    out.push(...decision(`还没执行的托管决策${c ? `（${c.trick}；我的手牌 ${c.hand.cards}）` : ''}`, r.pending));
  }
  if (r.result) out.push(`结果：名次 ${r.result.order.map(name).join(' > ')}，${r.result.winTeam === r.me % 2 ? '我方' : '对方'}升 ${r.result.up} 级${r.result.note ? '，' + r.result.note : ''}，级数 ${r.result.levelsAfter.join(' : ')}`);
  console.log(out.join('\n') + '\n');
}

const rounds = await load();
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 5);
const json = opt('--json');
if (json) writeFileSync(json, JSON.stringify(rounds, null, 1));
console.log(`共 ${rounds.length} 局，显示最近 ${Math.min(n, rounds.length)} 局\n`);
for (const r of rounds.slice(-n)) print(r);
