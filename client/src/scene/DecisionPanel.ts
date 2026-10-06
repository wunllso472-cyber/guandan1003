// 托管决策面板：托管时显示每手牌的决策依据（最上面是牌力评估和打法，然后是阶段与要点、三家出牌、自己的手牌、命中的规则、候选对比）。
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
    head.append(this.title, prev, next, fold);
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
  reset() { this.list = []; this.idx = -1; this.render(); }

  push(d: DecisionLog) {
    this.list.push(d);
    if (this.list.length > 40) this.list.shift();
    this.idx = this.list.length - 1;
    this.render();
  }

  setVisible(on: boolean) {
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

  private render() {
    const d = this.list[this.idx];
    this.title.textContent = d ? `决策依据 ${this.idx + 1}/${this.list.length}` : '决策依据';
    if (!d) { this.body.innerHTML = '<div class="dp-none">托管出牌后，这里会显示每手牌的决策依据</div>'; return; }
    const c = d.ctx;
    const mc = d.mc ? `（${d.mc.mode === 'full' ? '模拟到整局结束' : '模拟到本轮结束'}，${d.mc.samples} 局${d.method === 'mc-override' ? `，多赢 ${d.mc.gain} 级` : ''}）` : '';
    const parts: string[] = [];
    const pw = c?.power;
    if (pw) {
      parts.push(`<div class="dp-power"><div><b>牌力</b>${esc(pw.level)}（${pw.points} 分）　<b>打法</b><em>${esc(pw.role)}</em></div>`
        + `<div class="dp-why">${esc(pw.why)}</div><div class="dp-plan">${esc(pw.detail)}</div></div>`);
    }
    parts.push(`<div class="dp-pick">出：<b>${esc(d.chosen)}</b><span>${esc(METHOD_CN[d.method] + mc)}</span></div>`);
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
    if (c?.book.length) parts.push(`<h4>命中的教材规则（${esc(c.stage)}）</h4>${li(c.book)}`);
    parts.push('<h4>候选对比（评分越小越好）</h4><table><tr><th>出法</th><th>评分</th><th>模拟</th><th>规则</th></tr>'
      + d.candidates.map((x) => `<tr class="${x.label === d.chosen ? 'dp-on' : ''}"><td>${esc(x.label)}</td><td>${x.score}</td><td>${x.mc ?? ''}</td><td>${esc(x.rules.join(' '))}</td></tr>`).join('')
      + '</table>');
    this.body.innerHTML = parts.join('');
    this.body.scrollTop = 0;
  }
}
