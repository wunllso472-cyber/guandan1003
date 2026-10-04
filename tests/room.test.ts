import { it, expect } from 'vitest';
import { Room } from '../server/room';
import type { ServerMsg } from '../shared/protocol';

function fakeWs() {
  const msgs: ServerMsg[] = [];
  return { msgs, ws: { readyState: 1, OPEN: 1, send: (s: string) => msgs.push(JSON.parse(s)) } as any };
}

it('只下发自己的手牌，房间流程正确', () => {
  const tokens = new Map<string, Room>();
  let disposed = false;
  const room = new Room('123456', () => (disposed = true), tokens);
  const a = fakeWs(), b = fakeWs();
  expect(room.join('ta', '甲', a.ws)).toBeNull();
  expect(room.join('tb', '乙', b.ws)).toBeNull();
  expect(room.start('ta')).toMatch(/坐满/);
  expect(room.addAI('tb', 2)).toMatch(/房主/);
  room.addAI('ta', 2); room.addAI('ta', 3);
  expect(room.start('ta')).toMatch(/未准备/);
  room.setReady('tb', true);
  expect(room.start('tb')).toMatch(/房主/);
  expect(room.start('ta')).toBeNull();

  const rs = (m: { msgs: ServerMsg[] }) => m.msgs.find((x) => x.t === 'ev' && x.e.type === 'roundStart') as any;
  const ha = rs(a).e.hands, hb = rs(b).e.hands;
  expect(ha[0].length).toBe(27);
  expect(ha.filter((h: number[]) => h.length).length).toBe(1);
  expect(hb[1].length).toBe(27);
  expect(hb.filter((h: number[]) => h.length).length).toBe(1);
  expect(a.msgs.some((x) => x.t === 'ev' && x.e.type === 'reveal')).toBe(false);

  // 重连得到快照，只含自己的手牌
  const a2 = fakeWs();
  room.join('ta', '甲', a2.ws);
  const snap = a2.msgs.find((x) => x.t === 'snapshot') as any;
  expect(snap.s.myHand.length).toBe(27);
  expect(snap.s.reveal).toBeNull();

  // 游戏中两人都离开，房间解散
  room.leave('ta');
  room.leave('tb');
  expect(disposed).toBe(true);
  expect(tokens.size).toBe(0);
});

it('重复点击同一个座位不报错', () => {
  const room = new Room('654321', () => {}, new Map());
  const a = fakeWs();
  room.join('ta', '甲', a.ws);
  expect(room.sit('ta', 2)).toBeNull();
  expect(room.sit('ta', 2)).toBeNull();
  expect(room.info().seats[2]?.name).toBe('甲');
});
