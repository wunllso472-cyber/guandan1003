// 本机键值存储：调用方同步读写，网页版直接用 localStorage。
// 小红书小工具版（构建模式 minitool）启动时先用 initKv() 从容器的 Storage JS API 读入内存，
// 之后读内存、写入时同步落到容器存储；容器不支持时退回 localStorage（容器不保证其持久，读写都可能失败）。

type MiniTool = {
  getLaunchOptions?: () => Promise<{ miniToolEnv?: { buildVersion?: string | number } }>;
  setStorage?: (o: { key: string; data: string }) => Promise<unknown>;
  getStorage?: (o: { key: string }) => Promise<{ data: string | null }>;
  removeStorage?: (o: { key: string }) => Promise<unknown>;
};
type Xhs = { miniTool?: MiniTool; launchOptions?: { miniToolEnv?: { buildVersion?: string | number } } };

/** 客户端 9.46.0 起支持 Storage JS API */
const STORAGE_MIN_CLIENT_VERSION = 9460;

const mem = new Map<string, string | null>();
let mini: MiniTool | null = null;

function xhs(): Xhs | undefined {
  return (window as unknown as { xhs?: Xhs }).xhs;
}

function readBuildVersion(o: { miniToolEnv?: { buildVersion?: string | number } } | undefined): number {
  const env = o && o.miniToolEnv;
  return Number(env && env.buildVersion) || 0;
}

async function getBuildVersion(): Promise<number> {
  const x = xhs();
  const v = readBuildVersion(x && x.launchOptions);
  if (v) return v;
  const mt = x && x.miniTool;
  if (!mt || typeof mt.getLaunchOptions !== 'function') return 0;
  try { return readBuildVersion(await mt.getLaunchOptions()); } catch { return 0; }
}

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 隐私模式 / 被清理 */ }
}

/** 小工具启动时调用：容器支持 Storage JS API 时把这些 key 读进内存；失败不影响启动 */
export async function initKv(keys: string[]): Promise<void> {
  const x = xhs();
  const mt = x && x.miniTool;
  if (!mt || typeof mt.getStorage !== 'function' || typeof mt.setStorage !== 'function') return;
  const ver = await getBuildVersion();
  if (Math.floor(ver / 1000) < STORAGE_MIN_CLIENT_VERSION) return;
  mini = mt;
  await Promise.all(keys.map(async (k) => {
    let v: string | null = null;
    try {
      const r = await mt.getStorage!({ key: k });
      // 容器要求 data 是 JSON 字符串：写入时整体 JSON.stringify，这里解回原字符串
      const parsed: unknown = r && typeof r.data === 'string' ? JSON.parse(r.data) : null;
      v = typeof parsed === 'string' ? parsed : null;
    } catch { v = null; }
    if (v === null) {
      // 低版本客户端曾写在浏览器存储里：升级后迁移过来
      const old = lsGet(k);
      if (old !== null) { v = old; void mt.setStorage!({ key: k, data: JSON.stringify(old) }).catch(() => undefined); }
    }
    mem.set(k, v);
  }));
}

export const kv = {
  get(k: string): string | null {
    if (mini) return mem.has(k) ? mem.get(k)! : null;
    return lsGet(k);
  },
  set(k: string, v: string | null) {
    if (!mini) { lsSet(k, v); return; }
    mem.set(k, v);
    const mt = mini;
    // 写入失败（超过单个 key 1MB 等）时本次运行仍以内存为准
    if (v === null) void Promise.resolve(mt.removeStorage && mt.removeStorage({ key: k })).catch(() => undefined);
    else void mt.setStorage!({ key: k, data: JSON.stringify(v) }).catch(() => undefined);
  },
};

/** 需要在启动时读入的 key（与各模块使用的一致） */
export const KV_KEYS = ['gd_nick', 'gd_skin', 'gd_audio', 'gd_prefs', 'gd_train', 'gd_rank'];
