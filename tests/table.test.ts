import { describe, it, expect, vi } from 'vitest';
import { Table } from '../shared/table';
import type { DecisionLog, MCRunner } from '../shared/autoplay';

/** 等到条件成立（牌桌用 setTimeout 调度，speed 调小后等待都很短） */
async function until(cond: () => boolean, ms = 20000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('超时');
    await new Promise((r) => setTimeout(r, 1));
  }
}

describe('电脑难度', () => {
  it('困难电脑用异步模拟（这里返回 null，退回顾问首选）打完一局', async () => {
    const t = new Table([false, true, true, true]);
    t.speed = 0.001;
    t.autoBudgetMs = 0; // 玩家座位超时代打只用顾问
    t.aiLevel = 'hard';
    let calls = 0;
    t.mcRunner = async () => { calls++; return null; };
    t.start();
    await until(() => t.game.phase === 'roundEnd' || t.game.phase === 'gameEnd');
    expect(calls).toBeGreaterThan(0);
    t.dispose();
  }, 30000);

  it('模拟回来时已经不是这一手（重新开始），结果被丢弃', async () => {
    const t = new Table([true, true, true, true]);
    t.speed = 0.001;
    t.aiLevel = 'hard';
    const pending: (() => void)[] = [];
    // 第一局的模拟一直不返回，直到重新开始之后
    let hold = true;
    const runner: MCRunner = () => new Promise((res) => { if (hold) pending.push(() => res(null)); else res(null); });
    t.mcRunner = runner;
    t.start();
    await until(() => pending.length > 0);
    const errors = vi.spyOn(console, 'error');
    hold = false;
    t.mcRunner = async () => null;
    t.start(); // 重新开始：之前那一手作废
    for (const f of pending) f();
    await until(() => t.game.phase === 'roundEnd' || t.game.phase === 'gameEnd');
    // 过期的结果如果被用上，会在新的一局里出错（出牌错误日志）
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    t.dispose();
  }, 30000);
});

describe('托管决策依据', () => {
  it('托管出牌时发给本人的决策依据带局面信息', async () => {
    const t = new Table([false, true, true, true]);
    t.speed = 0.001;
    t.autoBudgetMs = 0;
    const ds: DecisionLog[] = [];
    t.on((e) => { if (e.type === 'decision') ds.push(e.d); });
    t.setAuto(0, true);
    t.start();
    await until(() => t.game.phase === 'roundEnd' || t.game.phase === 'gameEnd');
    t.dispose();
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) {
      expect(d.ctx).toBeDefined();
      expect(['开局', '中局', '残局']).toContain(d.ctx!.stage);
      expect(d.ctx!.seats.map((s) => s.who)).toEqual(['下家', '对家', '上家']);
    }
  }, 30000);
});
