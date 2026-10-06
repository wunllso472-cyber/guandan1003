import { it, expect } from 'vitest';
import { pickByMC, mcLowSample, MC_END } from '../shared/autoplay';

const res = (samples: number, scores: number[]) => ({ samples, scores }) as Parameters<typeof pickByMC>[0];

it('模拟样本不足：至少一半样本且差距 3 倍门槛才采纳', () => {
  // 截图那一手：只跑了 8 局，单张9（首选）1.25，炸弹 2.0
  expect(pickByMC(res(8, [1.25, 2.0, 2.0]), MC_END)).toEqual({ best: 1, gain: 0.75 });
  // 差距不够大，不采纳
  expect(pickByMC(res(8, [1.25, 1.6]), MC_END)).toBeNull();
  // 样本太少（不到一半），不采纳
  expect(pickByMC(res(5, [0, 2]), MC_END)).toBeNull();
  // 样本够时按原规则
  expect(pickByMC(res(20, [1, 1.3]), MC_END)).toEqual({ best: 1, gain: 0.30000000000000004 });
  mcLowSample.enabled = false;
  expect(pickByMC(res(8, [1.25, 2.0]), MC_END)).toBeNull();
  mcLowSample.enabled = true;
});
