// WebSocket 连接：自动重连、心跳、切回前台立即重连。
import type { ClientMsg, ServerMsg } from '@shared/protocol';

function makeToken(): string {
  try {
    const saved = localStorage.getItem('gd_token');
    if (saved) return saved;
  } catch { /* 隐私模式 */ }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const t = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem('gd_token', t); } catch { /* 忽略 */ }
  return t;
}

/** 联机服务地址：构建时可用 VITE_WS_URL 指定（前端和服务端分开部署时），默认同域名 /ws */
function wsUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export type ConnStatus = 'connecting' | 'open' | 'closed';

export class Connection {
  readonly token = makeToken();
  status: ConnStatus = 'closed';
  private ws: WebSocket | null = null;
  private handlers = new Set<(m: ServerMsg) => void>();
  private statusHandlers = new Set<(s: ConnStatus) => void>();
  private queue: ClientMsg[] = [];
  private retry = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private closedByUser = false;

  constructor(public name: string, public voice: 'male' | 'female' = 'male') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.status === 'closed' && !this.closedByUser) this.connect();
    });
  }

  onMessage(fn: (m: ServerMsg) => void) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  onStatus(fn: (s: ConnStatus) => void) { this.statusHandlers.add(fn); return () => this.statusHandlers.delete(fn); }

  private setStatus(s: ConnStatus) {
    this.status = s;
    for (const fn of this.statusHandlers) fn(s);
  }

  connect() {
    this.closedByUser = false;
    clearTimeout(this.retryTimer);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'hello', token: this.token, name: this.name, voice: this.voice } satisfies ClientMsg));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      this.setStatus('open');
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 15_000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      for (const fn of this.handlers) fn(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      this.setStatus('closed');
      if (!this.closedByUser) {
        const delay = Math.min(5000, 500 * 2 ** this.retry++);
        this.retryTimer = setTimeout(() => this.connect(), delay);
      }
    };
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'ping') { this.queue.push(msg); this.connect(); }
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }
}
