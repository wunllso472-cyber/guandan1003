import { Application, Container } from 'pixi.js';
import { TableScene } from './scene/TableScene';
import { LocalGame } from './game/LocalGame';
import type { GameClient } from './game/types';
import { Connection, wakeServer } from './net/Connection';
import { NetGame } from './net/NetGame';
import { RoomUI } from './net/RoomUI';
import { sound } from './audio/Sound';
import type { PlayerInfo, ServerMsg } from '@shared/protocol';

const BASE_W = 1280;
const BASE_H = 750;

const app = new Application();
await app.init({
  resizeTo: window,
  antialias: true,
  autoDensity: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  background: '#0b3d23',
});
document.getElementById('game')!.appendChild(app.canvas);

// world 承载横屏的设计坐标系；竖屏时整体旋转 90°，保证始终横屏显示
const world = new Container();
app.stage.addChild(world);
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;

let scene: TableScene | null = null;
let game: GameClient | null = null;

function relayout() {
  const W = window.innerWidth, H = window.innerHeight;
  app.renderer.resize(W, H);
  const portrait = H > W;
  const lw = portrait ? H : W;
  const lh = portrait ? W : H;
  const s = Math.min(lw / BASE_W, lh / BASE_H);
  world.scale.set(s);
  if (portrait) {
    world.rotation = Math.PI / 2;
    world.position.set(W, 0);
  } else {
    world.rotation = 0;
    world.position.set(0, 0);
  }
  scene?.layout(lw / s, lh / s);
}

window.addEventListener('resize', () => setTimeout(relayout, 50));
window.addEventListener('orientationchange', () => setTimeout(relayout, 300));

// ---------- 大厅 ----------
const $ = (id: string) => document.getElementById(id)!;
const lobby = $('lobby');
const nick = $('nick') as HTMLInputElement;
const codeInput = $('room-code') as HTMLInputElement;
const netStatus = $('net-status');
const toastEl = $('toast');

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 隐私模式 */ }
  },
};
nick.value = store.get('gd_nick') ?? '';

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
}

function nickname(): string {
  const name = nick.value.trim() || '玩家';
  store.set('gd_nick', name);
  return name;
}

async function enterLandscape() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    await (screen.orientation as any)?.lock?.('landscape');
  } catch { /* iOS 等不支持时由画面旋转兜底 */ }
}

function showScene(client: GameClient, onExit: () => void) {
  closeScene();
  sound.preloadVoices([...new Set(client.players.map((p) => p.voice))]);
  sound.setMusicWanted(true);
  game = client;
  scene = new TableScene(client, onExit);
  scene.bindStage(app.stage);
  world.addChild(scene);
  wakeServer();
relayout();
  if (import.meta.env.DEV) (window as any).__gd = { game, scene, app, conn };
}

function closeScene() {
  sound.setMusicWanted(false);
  game?.dispose();
  game = null;
  if (scene) {
    world.removeChild(scene);
    scene.destroy({ children: true });
    scene = null;
  }
  app.stage.removeAllListeners();
}

// ---------- 单机 ----------
function startSolo() {
  void enterLandscape();
  lobby.classList.add('hidden');
  const local = new LocalGame(nickname(), sound.settings.myVoice);
  if (import.meta.env.DEV && location.search.includes('fast')) local.speed = 0.05;
  showScene(local, () => { closeScene(); lobby.classList.remove('hidden'); });
  local.start();
}

// ---------- 联机 ----------
let conn: Connection | null = null;
let roomCode: string | null = null;
/** 连上后要做的事（加入/创建房间） */
let pendingJoin: string | null = null;

const urlRoom = new URLSearchParams(location.search).get('room');
const roomUI = new RoomUI($('room'), (m) => conn?.send(m), () => leaveRoom(), toast);

function ensureConn(): Connection {
  if (!conn) {
    conn = new Connection(nickname(), sound.settings.myVoice);
    conn.onMessage(onServer);
    conn.onStatus((s) => netStatus.classList.toggle('hidden', s === 'open' || !roomCode));
  } else {
    conn.name = nick.value.trim() || conn.name;
    conn.voice = sound.settings.myVoice;
  }
  conn.connect();
  return conn;
}

function onServer(m: ServerMsg) {
  switch (m.t) {
    case 'welcome':
      if (!m.room && pendingJoin) {
        conn!.send(pendingJoin === 'new' ? { t: 'create' } : { t: 'join', code: pendingJoin });
      }
      pendingJoin = null;
      break;
    case 'room':
      roomCode = m.room.code;
      store.set('gd_room', roomCode);
      history.replaceState(null, '', `${location.pathname}?room=${roomCode}`);
      if (!scene) {
        lobby.classList.add('hidden');
        roomUI.show(m.room, m.seat);
      }
      break;
    case 'start':
      roomUI.hide();
      lobby.classList.add('hidden');
      startNetGame(m.seat, m.players);
      break;
    case 'left':
      backToLobby();
      break;
    case 'error':
      if (!scene) toast(m.msg);
      if (!roomCode && !scene) store.set('gd_room', null);
      break;
  }
}

function startNetGame(seat: number, players: PlayerInfo[]) {
  void enterLandscape();
  const net = new NetGame(conn!, seat, players);
  showScene(net, () => leaveRoom());
}

/** 创建或加入房间（code 为 'new' 表示创建） */
function goRoom(code: string) {
  void enterLandscape();
  const c = ensureConn();
  // 服务器休眠唤醒需要时间，连接慢时给出提示
  setTimeout(() => {
    if (c.status !== 'open' && !roomCode) toast('正在连接服务器，首次连接可能需要约 1 分钟…');
  }, 1500);
  if (c.status === 'open') {
    c.send({ t: 'hello', token: c.token, name: c.name, voice: c.voice });
    c.send(code === 'new' ? { t: 'create' } : { t: 'join', code });
  } else {
    pendingJoin = code;
  }
}

function leaveRoom() {
  conn?.send({ t: 'leave' });
  backToLobby();
}

function backToLobby() {
  roomCode = null;
  store.set('gd_room', null);
  history.replaceState(null, '', location.pathname);
  closeScene();
  roomUI.hide();
  netStatus.classList.add('hidden');
  $('join-invite').classList.add('hidden');
  lobby.classList.remove('hidden');
}

// 手机浏览器需在用户手势中解锁音频
for (const ev of ['pointerdown', 'touchend', 'click']) document.addEventListener(ev, () => sound.unlock(), { capture: true });

$('btn-solo').addEventListener('click', startSolo);
$('btn-create').addEventListener('click', () => goRoom('new'));
$('btn-join').addEventListener('click', () => {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) { toast('请输入 6 位房间号'); return; }
  goRoom(code);
});
$('btn-invite').addEventListener('click', () => urlRoom && goRoom(urlRoom));

// 通过邀请链接打开：显示加入按钮；有昵称则直接加入
if (urlRoom && /^\d{6}$/.test(urlRoom)) {
  $('invite-code').textContent = urlRoom;
  $('join-invite').classList.remove('hidden');
  codeInput.value = urlRoom;
  if (store.get('gd_nick')) { pendingJoin = urlRoom; ensureConn(); }
} else if (store.get('gd_room')) {
  // 上次在房间里：连上后服务器会自动把我们带回去
  ensureConn();
}

relayout();
