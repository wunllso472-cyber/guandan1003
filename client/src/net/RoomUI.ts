// 等待房间（HTML）：座位、准备、添加电脑、开始游戏、邀请链接。
import type { ClientMsg, RoomInfo } from '@shared/protocol';

const AVATAR_BG = ['#e2702b', '#2f6fd1', '#3f9a3a', '#c4467e', '#6e48c9', '#c9962b'];

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export class RoomUI {
  private room: RoomInfo | null = null;
  private seat = -1;

  constructor(private el: HTMLElement, private send: (m: ClientMsg) => void, private onLeave: () => void, private toast: (s: string) => void) {
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b) return;
      const act = b.dataset.act!;
      const seat = Number(b.dataset.seat);
      switch (act) {
        case 'sit': this.send({ t: 'sit', seat }); break;
        case 'ai': this.send({ t: 'addAI', seat }); break;
        case 'rm': this.send({ t: 'removeAI', seat }); break;
        case 'ready': this.send({ t: 'ready', on: b.dataset.on === '1' }); break;
        case 'start': this.send({ t: 'start' }); break;
        case 'fill': this.fillAI(); break;
        case 'leave': this.onLeave(); break;
        case 'invite': void this.invite(); break;
      }
    });
  }

  show(room: RoomInfo, seat: number) {
    this.room = room;
    this.seat = seat;
    this.el.classList.remove('hidden');
    this.render();
  }

  hide() { this.el.classList.add('hidden'); }

  private fillAI() {
    this.room?.seats.forEach((s, i) => { if (!s) this.send({ t: 'addAI', seat: i }); });
  }

  private async invite() {
    if (!this.room) return;
    const url = `${location.origin}${location.pathname}?room=${this.room.code}`;
    const text = `来打掼蛋！房间号 ${this.room.code}，点击加入：${url}`;
    try {
      if (navigator.share) { await navigator.share({ title: '掼蛋', text, url }); return; }
    } catch { /* 用户取消分享时退回复制 */ }
    try {
      await navigator.clipboard.writeText(text);
      this.toast('邀请链接已复制，发给好友吧');
    } catch {
      window.prompt('复制下面的邀请链接发给好友', url);
    }
  }

  private render() {
    const room = this.room!;
    const me = this.seat;
    const isHost = room.host === me;
    const posName = ['bottom', 'right', 'top', 'left'];
    const seatsHtml = room.seats.map((s, i) => {
      const rel = (i - me + 4) % 4;
      const ally = i % 2 === me % 2;
      const cls = `seat pos-${posName[rel]} ${ally ? 'ally' : 'opp'} ${i === me ? 'me' : ''}`;
      if (!s) {
        return `<div class="${cls} empty">
          <button data-act="sit" data-seat="${i}">坐这里</button>
          ${isHost ? `<button class="ai" data-act="ai" data-seat="${i}">+ 电脑</button>` : ''}
        </div>`;
      }
      let st: string;
      if (s.isAI) st = '<span class="st ok">电脑</span>';
      else if (!s.online) st = '<span class="st off">离线</span>';
      else if (i === room.host) st = '<span class="st ok">房主</span>';
      else st = s.ready ? '<span class="st ok">已准备</span>' : '<span class="st wait">未准备</span>';
      return `<div class="${cls}">
        <div class="av" style="background:${AVATAR_BG[s.avatar % AVATAR_BG.length]}">${esc(s.name.slice(0, 1))}</div>
        <div class="meta"><div class="nm">${esc(s.name)}${i === me ? '<span class="tag">我</span>' : ''}</div>${st}</div>
        ${s.isAI && isHost ? `<button class="rm" data-act="rm" data-seat="${i}">移除</button>` : ''}
      </div>`;
    }).join('');

    const full = room.seats.every(Boolean);
    const mine = room.seats[me];
    let main: string;
    if (isHost) {
      main = full
        ? `<button class="btn primary" data-act="start">开始游戏</button>`
        : `<button class="btn" data-act="fill">空位都加电脑</button>`;
    } else {
      main = mine?.ready
        ? `<button class="btn" data-act="ready" data-on="0">取消准备</button>`
        : `<button class="btn primary" data-act="ready" data-on="1">准备</button>`;
    }
    const hint = isHost
      ? (full ? '所有玩家准备后即可开始' : '邀请好友加入，或点空位添加电脑')
      : '等待房主开始游戏';

    this.el.innerHTML = `<div class="room-card">
      <div class="room-head">
        <div class="code">房间号 <b>${room.code}</b></div>
        <button class="btn primary" data-act="invite">邀请好友</button>
      </div>
      <div class="room-table">${seatsHtml}<div class="center">对面是队友<br/>金框我方 · 蓝框对方</div></div>
      <div class="room-foot">
        <button class="btn leave" data-act="leave">离开</button>
        ${main}
      </div>
      <div class="room-hint">${hint}</div>
    </div>`;
  }
}
