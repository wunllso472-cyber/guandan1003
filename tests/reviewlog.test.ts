import { it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { LocalGame } from '../client/src/game/LocalGame';
import { ReviewLogger, type RoundRecord } from '../client/src/game/reviewLog';
import { CardTracker } from '../shared/tracker';
import type { GameEvent } from '../shared/game';

it('托管打完一局：日志记录每手牌和决策依据，并上传', async () => {
  const sent: RoundRecord[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    sent.push(...(JSON.parse(init.body).rounds as RoundRecord[]));
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('location', { origin: 'http://test' });
  const game = new LocalGame('测试', 'male');
  game.speed = 0.001;
  const tracker = new CardTracker(0);
  const log = new ReviewLogger(game, tracker);
  let ended = false;
  game.on((e) => { tracker.apply(e as GameEvent); log.onEvent(e); if (e.type === 'roundEnd') ended = true; });
  game.setAuto(true);
  game.start();
  for (let i = 0; i < 2000 && !ended; i++) await new Promise((r) => setTimeout(r, 5));
  game.dispose();
  vi.unstubAllGlobals();

  expect(ended).toBe(true);
  expect(sent.length).toBe(1);
  const r = sent[0];
  // 调试：GD_DUMP_LOG=文件 把这一局的日志写出来，可用 scripts/review.ts --file 查看
  if (process.env.GD_DUMP_LOG) writeFileSync(process.env.GD_DUMP_LOG, JSON.stringify(sent));
  expect(Object.keys(r.hands).length).toBe(4); // 单机记录四家起手牌
  expect(r.result).toBeDefined();
  const mine = r.log.filter((x) => (x.t === 'play' || x.t === 'pass') && x.s === 0);
  expect(mine.length).toBeGreaterThan(0);
  // 自己的每手托管出牌都带决策依据和出牌前的手牌
  expect(mine.every((x) => x.hand && x.hand.length > 0)).toBe(true);
  expect(mine.filter((x) => x.why).length).toBeGreaterThan(mine.length * 0.8);
  const w = mine.find((x) => x.why)!.why!;
  expect(w.candidates.length).toBeGreaterThan(0);
}, 60000);
