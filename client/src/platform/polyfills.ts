// 小红书小工具的最低内核是 Android 8.1 出厂 Chrome / WebView 61。
// 构建时语法已转译到 ES2017，这里只补本项目（含 PixiJS）实际用到、而 Chrome 61 没有的运行时 API。
// 只在缺失时补，已有原生实现的内核不受影响。网页版不引入这个文件。

/* eslint-disable no-extend-native */
const g = (typeof self !== 'undefined' ? self : window) as unknown as Record<string, unknown>;

if (typeof g.globalThis === 'undefined') g.globalThis = g;

function define(obj: object, name: string, value: unknown) {
  if (!(name in obj)) Object.defineProperty(obj, name, { value, configurable: true, writable: true });
}

function flatten(arr: unknown[], depth: number, out: unknown[]): unknown[] {
  for (let i = 0; i < arr.length; i++) {
    if (!(i in arr)) continue;
    const v = arr[i];
    if (depth > 0 && Array.isArray(v)) flatten(v, depth - 1, out);
    else out.push(v);
  }
  return out;
}

define(Array.prototype, 'flat', function flat(this: unknown[], depth?: number) {
  return flatten(this, depth === undefined ? 1 : Number(depth) || 0, []);
});
define(Array.prototype, 'flatMap', function flatMap(this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => unknown, thisArg?: unknown) {
  return flatten(this.map(fn, thisArg), 1, []);
});
define(Object, 'fromEntries', function fromEntries(it: Iterable<[PropertyKey, unknown]>) {
  const o: Record<PropertyKey, unknown> = {};
  for (const [k, v] of it) o[k as string] = v;
  return o;
});
define(Object, 'hasOwn', function hasOwn(o: object, k: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(o, k);
});
define(String.prototype, 'matchAll', function* matchAll(this: string, re: RegExp) {
  const r = new RegExp(re.source, re.flags.indexOf('g') >= 0 ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(this)) !== null) {
    yield m;
    if (m[0] === '') r.lastIndex++;
  }
});
if (typeof g.queueMicrotask !== 'function') {
  g.queueMicrotask = (cb: () => void) => { Promise.resolve().then(cb).catch((e) => setTimeout(() => { throw e; })); };
}
if (typeof Promise.allSettled !== 'function') {
  define(Promise, 'allSettled', (ps: Iterable<unknown>) => Promise.all(Array.from(ps, (p) => Promise.resolve(p).then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  ))));
}

export {};
