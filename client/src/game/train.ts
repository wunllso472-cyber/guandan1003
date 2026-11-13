// 记牌训练的本机进度和开关（保存在浏览器里；换设备或清缓存会从段位 1 重新开始）
import { MAX_TIER, newProgress, type TrainProgress } from '@shared/training';

const KEY = 'gd_train';

export interface TrainState {
  progress: TrainProgress;
  /** 记牌器面板展开 */
  panelOpen: boolean;
  /** 随局快问 */
  quizOn: boolean;
}

function load(): TrainState {
  const def: TrainState = { progress: newProgress(), panelOpen: false, quizOn: true };
  try {
    const s = { ...def, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as TrainState;
    const p = s.progress;
    if (!p || typeof p.tier !== 'number' || typeof p.recent !== 'object') s.progress = newProgress();
    else s.progress.tier = Math.min(MAX_TIER, Math.max(1, Math.round(p.tier)));
    return s;
  } catch { return def; }
}

export const train: TrainState = load();

export function saveTrain() {
  try { localStorage.setItem(KEY, JSON.stringify(train)); } catch { /* 隐私模式：本次有效，不保存 */ }
}
