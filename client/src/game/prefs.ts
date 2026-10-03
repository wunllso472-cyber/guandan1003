// 本机的玩法偏好（保存在浏览器里）
const KEY = 'gd_prefs';

export interface Prefs {
  /** 跟牌时点一张牌，自动选中能压过上家的一组 */
  autoPick: boolean;
}

function load(): Prefs {
  const def: Prefs = { autoPick: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return def; }
}

export const prefs: Prefs = load();

export function savePrefs(p: Partial<Prefs>) {
  Object.assign(prefs, p);
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 隐私模式 */ }
}
