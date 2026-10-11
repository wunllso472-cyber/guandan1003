// 决策面板：托管时自动显示每手牌的决策依据；双击“提示”时也会打开，显示那手提示的依据（最上面是牌力评估和打法，然后是阶段与要点、三家出牌、自己的手牌、命中的规则、候选对比）。
// 用 DOM 浮层而不是画布文字：内容多，需要滚动和换行。
import type { DecisionLog } from '@shared/autoplay';

const METHOD_CN: Record<DecisionLog['method'], string> = {
  advisor: '顾问首选', mc: '模拟推演后保留首选', 'mc-override': '模拟推演推翻首选', jev: 'AI 排序',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const li = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="dp-none">无</div>');

export class DecisionPanel {
  private root = document.createElement('div');
  private body = document.createElement('div');
  private title = document.createElement('span');
  private list: DecisionLog[] = [];
  private idx = -1;
  private open = true;
  private shown = false;
  /** 托管中 */
  private auto = false;
  /** 双击提示手动打开（点“关闭”前一直显示） */
  private manual = false;
  private closeBtn: HTMLButtonElement;
  /** 最后一条记录是哪一手的实时内容（同一手的更新替换它，不新增记录）；null 表示不是实时内容 */
  private liveKey: string | null = null;

  constructor() {
    this.root.className = 'dp';
    const head = document.createElement('div');
    head.className = 'dp-head';
    const prev = this.btn('◀', () => this.go(-1));
    const next = this.btn('▶', () => this.go(1));
    const fold = this.btn('收起', () => {
      this.open = !this.open;
      fold.textContent = this.open ? '收起' : '展开';
      this.body.style.display = this.open ? '' : 'none';
    });
    this.closeBtn = this.btn('关闭', () => { this.manual = false; this.apply(); });
    head.append(this.title, prev, next, fold, this.closeBtn);
    this.body.className = 'dp-body';
    this.root.append(head, this.body);
    this.root.style.display = 'none';
    // 画布上禁止了选择和触摸滚动，面板里要恢复，并且不让事件传到牌桌
    for (const t of ['pointerdown', 'pointerup', 'wheel', 'touchstart', 'touchmove']) this.root.addEventListener(t, (e) => e.stopPropagation());
    document.body.appendChild(this.root);
    this.render();
  }

  private btn(text: string, fn: () => void) {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = fn;
    return b;
  }

  /** 新的一局清空记录 */
  reset() { this.list = []; this.idx = -1; this.liveKey = null; this.render(); }

  push(d: DecisionLog) {
    // “等待别人出牌”的实时内容只是过渡，不留在记录里
    if (this.list[this.list.length - 1]?.waiting) this.list.pop();
    this.liveKey = null;
    this.list.push(d);
    if (this.list.length > 40) this.list.shift();
    this.idx = this.list.length - 1;
    this.render();
  }

  /** 手动打开着（双击提示后、点“关闭”前），内容要跟着牌局更新 */
  get live() { return this.manual && !this.auto; }

  /**
   * 跟着牌局更新：同一手（key 相同）或上一条是“等待别人出牌”时替换最后一条，否则新增一条。
   * 正在翻看前面的记录时不跳走；内容原地替换时保留滚动位置。
   */
  setLive(d: DecisionLog, key: string) {
    const last = this.list.length - 1;
    const atEnd = this.idx === last;
    const replace = last >= 0 && (this.liveKey === key || !!this.list[last].waiting);
    if (replace) this.list[last] = d;
    else {
      this.list.push(d);
      if (this.list.length > 40) this.list.shift();
    }
    this.liveKey = key;
    if (atEnd || last < 0) this.idx = this.list.length - 1;
    else if (!replace && this.list.length === 40) this.idx = Math.max(0, this.idx - 1);
    this.render(replace && atEnd);
  }

  /** 托管开关（托管时自动显示） */
  setVisible(auto: boolean) {
    this.auto = auto;
    this.apply();
  }

  /** 手动打开（双击提示）；内容由 setLive 填入并跟着牌局更新 */
  showManual() {
    this.manual = true;
    if (!this.open) { this.open = true; this.body.style.display = ''; }
    this.apply();
  }

  private apply() {
    const on = this.auto || this.manual;
    // 托管中不需要“关闭”（托管时一直显示，可以收起）
    this.closeBtn.style.display = this.manual && !this.auto ? '' : 'none';
    if (on === this.shown) return;
    this.shown = on;
    this.root.style.display = on ? '' : 'none';
  }

  destroy() { this.root.remove(); }

  private go(step: number) {
    if (!this.list.length) return;
    this.idx = Math.max(0, Math.min(this.list.length - 1, this.idx + step));
    this.render();
  }

  private render(keepScroll = false) {
    const d = this.list[this.idx];
    const scroll = keepScroll ? this.body.scrollTop : 0;
    this.title.textContent = d ? `${d.source === 'hint' ? '提示依据' : '决策依据'} ${this.idx + 1}/${this.list.length}` : '决策依据';
    if (!d) { this.body.innerHTML = '<div class="dp-none">托管出牌后，这里会显示每手牌的决策依据</div>'; return; }
    const c = d.ctx;
    const mc = d.mc ? `（${d.mc.mode === 'full' ? '模拟到整局结束' : '模拟到本轮结束'}，${d.mc.samples} 局${d.method === 'mc-override' ? `，多赢 ${d.mc.gain} 级` : ''}）` : '';
    const parts: string[] = [];
    const pw = c?.power;
    if (pw) {
      parts.push(`<div class="dp-power"><div><b>牌力</b>${esc(pw.level)}（${pw.points} 分）　<b>打法</b><em>${esc(pw.role)}</em></div>`
        + `<div class="dp-why">${esc(pw.why)}</div><div class="dp-plan">${esc(pw.detail)}</div>`
        + (c?.outside ? `<div class="dp-out"><b>外面</b>${c.outside.map((o) => `<span class="${o.left ? '' : 'dp-zero'}">${esc(o.name)} <em>${o.left}</em>${o.note ? `（${esc(o.note)}）` : ''}</span>`).join('')}</div>` : '')
        + '</div>');
    }
    if (d.waiting) parts.push(`<div class="dp-pick"><b>${esc(d.waiting)}</b><span>轮到我时这里会给出建议的出法</span></div>`);
    else parts.push(`<div class="dp-pick">出：<b>${esc(d.chosen)}</b><span>${esc(METHOD_CN[d.method] + mc)}</span></div>`);
    if (c) {
      parts.push(`<div class="dp-row"><b>阶段</b>${esc(c.stage)}　<b>目标</b>${esc(c.goal)}</div>`);
      parts.push(`<div class="dp-row"><b>本手</b>${esc(c.trick)}</div>`);
      parts.push(`<h4>${esc(c.stage)}要点</h4>${li(c.focus)}`);
      parts.push(`<h4>我的手牌（${c.hand.cards.split(' ').filter(Boolean).length} 张，拆成 ${c.hand.hands} 手${c.hand.bombs ? ` + ${c.hand.bombs} 个炸弹` : ''}）</h4>`
        + `<div class="dp-cards">${esc(c.hand.cards)}</div><div class="dp-plan">${esc(c.hand.plan.join(' ｜ '))}</div>`);
      parts.push('<h4>其他三家</h4>' + c.seats.map((s) => {
        const status = s.place ? `已出完（第 ${s.place} 名）` : `剩 ${s.left} 张`;
        const lines = [`出过 ${s.plays} 手${s.recent.length ? `，最近：${s.recent.join('、')}` : ''}`];
        if (s.passes.length) lines.push(`面对对手的${s.passes.join('、')}不出过`);
        if (s.known.length) lines.push(`确定有：${s.known.join('、')}`);
        return `<div class="dp-seat"><b>${esc(s.who)}</b> ${esc(status)}<div>${lines.map(esc).join('<br>')}</div></div>`;
      }).join(''));
      parts.push(`<h4>场面事实</h4>${li(c.facts)}`);
    }
    if (d.beliefs?.length) parts.push(`<h4>推断（只是倾向）</h4>${li(d.beliefs)}`);
    const pick = d.candidates.find((x) => x.label === d.chosen);
    if (pick) parts.push(`<h4>选这手的理由</h4>${li(pick.reasons)}`);
    if (c?.five?.length) parts.push(`<h4>这手牌的五问</h4><ul>${c.five.map((x) => `<li><b>${esc(x.q)}</b>${esc(x.a)}</li>`).join('')}</ul>`);
    if (c?.book.length) parts.push(`<h4>命中的规则（${esc(c.stage)}）</h4>${li(c.book)}`);
    if (d.candidates.length) parts.push('<h4>候选对比（评分越小越好）</h4><table><tr><th>出法</th><th>评分</th><th>模拟</th><th>规则</th></tr>'
      + d.candidates.map((x) => `<tr class="${x.label === d.chosen ? 'dp-on' : ''}"><td>${esc(x.label)}</td><td>${x.score}</td><td>${x.mc ?? ''}</td><td>${esc(x.rules.join(' '))}</td></tr>`).join('')
      + '</table>');
    this.body.innerHTML = parts.join('');
    this.body.scrollTop = scroll;
  }
}
