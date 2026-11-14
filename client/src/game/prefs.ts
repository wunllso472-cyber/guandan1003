// 本机的玩法偏好（保存在浏览器里）
import { kv } from '../platform/kv';
const KEY = 'gd_prefs';

export interface Prefs {
  /** 跟牌时点一张牌，自动选中能压过上家的一组 */
  autoPick: boolean;
  /** 单机电脑难度：normal 普通（原电脑）；hard 困难（与托管相同的策略：记牌 + 模拟） */
  aiLevel: 'normal' | 'hard';
}

function load(): Prefs {
  const def: Prefs = { autoPick: true, aiLevel: 'hard' };
  try { return { ...def, ...JSON.parse(kv.get(KEY) ?? '{}') }; } catch { return def; }
}

export const prefs: Prefs = load();

export function savePrefs(p: Partial<Prefs>) {
  Object.assign(prefs, p);
  kv.set(KEY, JSON.stringify(prefs));
}
