// 复盘页面：读取本机保存的复盘日志，按“我的每一次出牌”展示当时的局面——
// 另外三家已出的牌、我的手牌、前一手是谁出的什么、触发的规则、推荐的出法与实际出法。
import { loadAll, type Entry, type RoundRecord } from '../game/reviewLog';
import type { DecisionLog } from '@shared/autoplay';
import { RULES } from '@shared/strategy';
import { BOOK_RULES } from '@shared/rulebook';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** 规则编号 → 中文名称 */
function ruleName(id: string): string {
  return RULES[id]?.name ?? BOOK_RULES[id]?.title ?? id;
}

// ---------- 牌的显示 ----------

function cardHtml(label: string, opts: { sm?: boolean; hl?: boolean } = {}): string {
  const wild = label.endsWith('(配)');
  const text = label.replace('(配)', '');
  const joker = text === '大王' || text === '小王';
  const red = joker ? text === '大王' : /^[♥♦]/.test(text);
  const cls = ['c', red ? 'red' : '', joker ? 'joker' : '', wild ? 'wild' : '', opts.sm ? 'sm' : '', opts.hl ? 'hl' : ''].filter(Boolean).join(' ');
  return `<span class="${cls}">${esc(text)}</span>`;
}

const cardsHtml = (labels: string[], sm = false) => `<span class="cards">${labels.map((l) => cardHtml(l, { sm })).join('')}</span>`;
const split = (cards?: string) => (cards ? cards.split(' ').filter(Boolean) : []);

// ---------- 从日志重建每一步的局面 ----------

interface Step {
  /** 在 log 中的下标 */
  idx: number;
  entry: Entry;
  trick: number;
  /** 各座位到这一步之前出过的牌（按出牌顺序） */
  played: { label: string; cards: string[] }[][];
  /** 各座位到这一步之前剩余张数 */
  left: number[];
  /** 本轮前一手（我首出时为 null） */
  prev: { seat: number; label: string; cards: string[] } | null;
  /** 本轮已经不出的人 */
  passes: number[];
}

function buildSteps(r: RoundRecord): Step[] {
  const played: Step['played'] = [[], [], [], []];
  const left = [27, 27, 27, 27];
  let prev: Step['prev'] = null;
  let passes: number[] = [];
  let trick = 1;
  const steps: Step[] = [];
  r.log.forEach((x, idx) => {
    if (x.t === 'trick') { trick++; prev = null; passes = []; return; }
    if (x.t !== 'play' && x.t !== 'pass') return;
    if (x.s === r.me) {
      steps.push({ idx, entry: x, trick, played: played.map((p) => [...p]), left: [...left], prev, passes: [...passes] });
    }
    if (x.t === 'play' && x.s !== undefined) {
      played[x.s].push({ label: x.c ?? '', cards: split(x.cards) });
      if (x.left !== undefined) left[x.s] = x.left;
      prev = { seat: x.s, label: x.c ?? '', cards: split(x.cards) };
      passes = [];
    } else if (x.t === 'pass' && x.s !== undefined) {
      passes.push(x.s);
    }
  });
  return steps;
}

// ---------- 渲染 ----------

const REL = ['我', '下家', '对家', '上家'];
const POS = ['', 'right', 'top', 'left'];
const STAGE: Record<string, string> = { opening: '开局', middle: '中局', endgame: '残局' };
const METHOD: Record<DecisionLog['method'], string> = { advisor: '顾问首选', mc: '模拟后保留首选', 'mc-override': '模拟推翻首选', jev: 'Jev 推荐' };

const nameOf = (r: RoundRecord, s: number) => r.players[s]?.split('（')[0] ?? `座位${s}`;
const rel = (r: RoundRecord, s: number) => REL[(s - r.me + 4) % 4];

function seatHtml(r: RoundRecord, st: Step, s: number): string {
  const relIdx = (s - r.me + 4) % 4;
  const plays = st.played[s];
  const rows = plays.length
    ? plays.map((p, i) => `<div class="play-row"><span class="tag">${i + 1}</span>${cardsHtml(p.cards, true)}</div>`).join('')
    : '<span class="none">还没出过牌</span>';
  const passed = st.passes.includes(s) ? ' · 本轮不出' : '';
  return `<div class="seat ${POS[relIdx]} ${relIdx === 2 ? 'partner' : ''}">
    <h3><span>${esc(nameOf(r, s))}（${rel(r, s)}）${passed}</span><span class="left-n">剩 ${st.left[s]} 张</span></h3>
    <div class="plays">${rows}</div>
  </div>`;
}

/** 选中的决策：优先“提示”，其次托管的依据，再次手动出牌时策略的建议 */
function decisionOf(e: Entry): { d: DecisionLog; kind: string } | null {
  if (e.hint) return { d: e.hint, kind: '点了提示' };
  if (e.why) return { d: e.why, kind: e.why.source === 'timeout' ? '超时代打' : '托管' };
  if (e.sug) return { d: e.sug, kind: '手动出牌' };
  return null;
}

function rulesHtml(d: DecisionLog): string {
  const c = d.candidates.find((x) => x.label === d.chosen) ?? d.candidates[0];
  if (!c) return '<span class="none">没有记录</span>';
  const rules = c.rules.map((s) => {
    const m = s.match(/^([A-Z_0-9]+?)([+-][\d.]+)$/);
    const id = m?.[1] ?? s, w = Number(m?.[2] ?? 0);
    return `<div class="rule ${w > 0 ? 'oppose' : ''}"><span class="w">${w > 0 ? '反对' : '支持'} ${Math.abs(w)}</span><b>${esc(id)}</b>${esc(ruleName(id))}</div>`;
  }).join('');
  const reasons = c.reasons.length ? `<ul class="reasons">${c.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  return (rules || '<span class="none">这手没有触发规则，按牌型结构评分</span>') + reasons;
}

function candidatesHtml(d: DecisionLog): string {
  const hasMc = d.candidates.some((c) => c.mc !== undefined);
  const rows = d.candidates.map((c) => `<tr class="${c.label === d.chosen ? 'chosen' : ''}">
    <td>${esc(c.label)}</td><td class="num">${c.score}</td>${hasMc ? `<td class="num">${c.mc ?? '—'}</td>` : ''}
    <td>${c.rules.map((s) => esc(ruleName(s.replace(/[+-][\d.]+$/, '')))).join('、') || ''}</td></tr>`).join('');
  return `<div class="scroll-x"><table><thead><tr><th>候选</th><th class="num">评分↓</th>${hasMc ? '<th class="num">模拟</th>' : ''}<th>规则</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="summary" style="margin-top:6px">评分越小越推荐；模拟是推演出的团队平均升级数，越大越好。</div>`;
}

function stepHtml(r: RoundRecord, st: Step): string {
  const e = st.entry;
  const actual = e.t === 'pass' ? '不出' : e.c ?? '';
  const myCards = split(e.cards);
  // 高亮手牌中出掉的牌（同名牌按张数匹配）
  const toMark = new Map<string, number>();
  for (const c of myCards) toMark.set(c, (toMark.get(c) ?? 0) + 1);
  const hand = (e.hand ?? []).map((l) => {
    const n = toMark.get(l) ?? 0;
    if (n > 0) toMark.set(l, n - 1);
    return cardHtml(l, { hl: n > 0 });
  }).join('');
  const dec = decisionOf(e);
  const prev = st.prev
    ? `<div>前一手：<span class="who">${esc(nameOf(r, st.prev.seat))}（${rel(r, st.prev.seat)}）</span></div><div>${esc(st.prev.label)}</div>${cardsHtml(st.prev.cards)}`
    : '<div class="who">轮到我首出</div><div class="none">这一轮还没人出牌</div>';
  const same = dec && dec.d.chosen === actual;
  const others = [1, 2, 3].map((k) => (r.me + k) % 4);

  return `<div class="step">
    <div class="badges">
      <span class="badge gold">第 ${st.trick} 轮</span>
      ${dec?.d.stage ? `<span class="badge">${STAGE[dec.d.stage] ?? dec.d.stage}</span>` : ''}
      ${dec ? `<span class="badge">${dec.kind}</span><span class="badge">${METHOD[dec.d.method]}${dec.d.mc ? ` · 模拟 ${dec.d.mc.samples} 次` : ''}</span>` : ''}
    </div>
    <div class="table">
      ${others.map((s) => seatHtml(r, st, s)).join('')}
      <div class="center">${prev}</div>
    </div>
    <div class="hand"><h3>我的手牌（${e.hand?.length ?? 0} 张，金框为这次出的牌）</h3><div class="cards">${hand || '<span class="none">没有记录</span>'}</div></div>
    <div class="decide">
      <div class="box">
        <h3>推荐与实际</h3>
        <div>推荐：<b>${esc(dec?.d.chosen ?? '—')}</b></div>
        <div>实际：<b>${esc(actual)}</b> ${myCards.length ? cardsHtml(myCards, true) : ''}</div>
        <div class="verdict ${dec ? (same ? 'same' : 'diff') : ''}" style="margin-top:6px">${dec ? (same ? '✓ 与推荐一致' : '≠ 与推荐不同') : ''}</div>
        <h3 style="margin-top:12px">触发的规则（推荐的这手）</h3>
        <div class="rules">${dec ? rulesHtml(dec.d) : '<span class="none">没有记录</span>'}</div>
      </div>
      <div class="box"><h3>候选出法</h3>${dec ? candidatesHtml(dec.d) : '<span class="none">没有记录</span>'}</div>
    </div>
  </div>`;
}

// ---------- 页面状态 ----------

const rounds = loadAll().reverse();
let cur = 0;
let stepIdx = 0;
let steps: Step[] = [];

function roundTitle(r: RoundRecord): string {
  const d = new Date(r.at);
  const t = `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const res = r.result ? `${r.result.winTeam === r.me % 2 ? '胜' : '负'} ${r.result.up} 级` : '未完';
  return `${t} · 打${r.level} · ${r.mode === 'local' ? '单机' : '联机'} · ${res}`;
}

function render() {
  const app = $('app');
  if (!rounds.length) {
    app.innerHTML = '<div class="empty">还没有复盘记录。打完一局后会自动保存在这台设备上。</div>';
    $('round').style.display = 'none';
    return;
  }
  const r = rounds[cur];
  if (!steps.length) {
    app.innerHTML = `<div class="summary">${esc(r.players.join('　'))}</div><div class="empty">这一局没有轮到我出牌的记录。</div>`;
    return;
  }
  const st = steps[stepIdx];
  const agree = steps.filter((s) => { const d = decisionOf(s.entry); return d && d.d.chosen === (s.entry.t === 'pass' ? '不出' : s.entry.c); }).length;
  app.innerHTML = `
    <div class="summary">${esc(r.players.join('　'))}</div>
    <div class="summary">本局我出牌 ${steps.length} 次，与推荐一致 ${agree} 次${r.result ? `；结果：${r.result.winTeam === r.me % 2 ? '我方胜' : '对方胜'}，升 ${r.result.up} 级` : ''}</div>
    <div class="nav">
      <button id="prev" ${stepIdx === 0 ? 'disabled' : ''}>‹ 上一手</button>
      <input id="slider" type="range" min="0" max="${steps.length - 1}" value="${stepIdx}" aria-label="选择第几手" />
      <span class="pos">第 ${stepIdx + 1} / ${steps.length} 手</span>
      <button id="next" ${stepIdx === steps.length - 1 ? 'disabled' : ''}>下一手 ›</button>
    </div>
    ${stepHtml(r, st)}`;
  $('prev').onclick = () => go(stepIdx - 1);
  $('next').onclick = () => go(stepIdx + 1);
  ($('slider') as HTMLInputElement).oninput = (ev) => go(Number((ev.target as HTMLInputElement).value));
}

function go(i: number) {
  stepIdx = Math.max(0, Math.min(steps.length - 1, i));
  render();
  history.replaceState(null, '', `#r=${cur}&s=${stepIdx + 1}`);
}

function selectRound(i: number) {
  cur = i;
  steps = rounds[i] ? buildSteps(rounds[i]) : [];
  stepIdx = 0;
  render();
}

const sel = $<HTMLSelectElement>('round');
sel.innerHTML = rounds.map((r, i) => `<option value="${i}">${esc(roundTitle(r))}</option>`).join('');
sel.onchange = () => selectRound(Number(sel.value));
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') go(stepIdx - 1);
  if (e.key === 'ArrowRight') go(stepIdx + 1);
});
// 链接里的 #r=第几局（0 为最新）&s=第几手，可直接打开某一手
const hash = new URLSearchParams(location.hash.slice(1));
selectRound(Math.min(Number(hash.get('r') ?? 0) || 0, Math.max(0, rounds.length - 1)));
sel.value = String(cur);
if (hash.get('s')) go(Number(hash.get('s')) - 1);
