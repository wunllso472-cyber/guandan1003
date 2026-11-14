#!/usr/bin/env node
// 构建小红书小工具离线包：node minitool/build.mjs
// 1. Vite（--mode minitool）把单机版打成一个 IIFE 经典脚本 app.js + style.css，语法转译到 ES2017 / Chrome 61
// 2. esbuild 把模拟线程打成包内经典脚本 mc-worker.js
// 3. 由 client/index.html 生成小工具的 index.html：内联脚本外置到 boot.js、去掉联机入口、加载页 CSS 降到 Chrome 61
// 4. 按小工具规范做静态校验（文件类型、CSP、外链、被禁能力、语法），失败即退出
// 5. 打成 dist/guandan-minitool.zip（index.html 在 zip 根目录）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { transform as cssTransform } from 'lightningcss';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'minitool');
const zipPath = path.join(root, 'dist', 'guandan-minitool.zip');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

const errors = [];
const notes = [];
const fail = (m) => errors.push(m);

// ---------- 1. 主包 ----------
const vite = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'minitool/vite.config.ts', '--mode', 'minitool'], { cwd: root, stdio: 'inherit' });
if (vite.status !== 0) process.exit(vite.status ?? 1);

// ---------- 2. 模拟线程 ----------
await esbuild({
  entryPoints: [path.join(root, 'client/src/game/mcWorkerClassic.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2017', 'chrome61'],
  minify: true,
  alias: { '@shared': path.join(root, 'shared') },
  define: { 'import.meta.env.MODE': '"minitool"', 'process.env.NODE_ENV': '"production"' },
  outfile: path.join(out, 'mc-worker.js'),
  logLevel: 'warning',
});

// ---------- 3. index.html + boot.js ----------
let html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
function cut(re, what) {
  const m = html.match(re);
  if (!m) throw new Error(`client/index.html 里找不到${what}，请同步更新 minitool/build.mjs`);
  html = html.replace(re, '');
  return m;
}
function swap(from, to, what) {
  if (!html.includes(from)) throw new Error(`client/index.html 里找不到${what}，请同步更新 minitool/build.mjs`);
  html = html.replace(from, to);
}

// 内联脚本（容器 CSP 禁止）→ boot.js；第一个在 <head> 里提前套用界面风格，第二个是加载进度条
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 2) throw new Error(`client/index.html 预期 2 段内联脚本，实际 ${scripts.length} 段`);
const boot = `// 由 minitool/build.mjs 从 client/index.html 的内联脚本生成（小工具 CSP 不允许内联脚本）\n`
  + `(function () {\n${scripts[0][1].trim()}\n})();\n`
  + `// 不支持 Flex gap 的内核（如 Chrome 61）给 html 加 no-flexgap，style.css 里用外边距代替\n`
  + `(function () {\n  try {\n    var d = document.createElement('div');\n    d.style.display = 'flex'; d.style.flexDirection = 'column'; d.style.rowGap = '1px';\n    d.appendChild(document.createElement('div')); d.appendChild(document.createElement('div'));\n    document.body.appendChild(d);\n    var ok = d.scrollHeight === 1;\n    d.parentNode.removeChild(d);\n    if (!ok) document.documentElement.className += ' no-flexgap';\n  } catch (e) { /* 检测失败按支持处理 */ }\n})();\n`
  + `${scripts[1][1].trim()}\n`;
html = html.replace(scripts[0][0], '');
html = html.replace(scripts[1][0], '<script src="./boot.js"></script>');

swap('<script type="module" src="./src/main.ts"></script>', '<script src="./app.js"></script>', '入口脚本');
swap('<link rel="stylesheet" href="./src/style.css" />', '<link rel="stylesheet" href="./style.css" />', '样式表');
// 只有单机：去掉联机相关的入口和容器
cut(/\s*<div id="join-invite"[\s\S]*?<\/button>\s*<\/div>/, '邀请加入按钮');
swap('<button id="btn-create" class="btn primary">创建房间</button>', '', '创建房间按钮');
swap('<button id="btn-solo" class="btn">单机练习</button>', '<button id="btn-solo" class="btn primary">开始游戏（对战电脑）</button>', '单机按钮');
cut(/\s*<div class="join-row">[\s\S]*?<\/div>/, '房间号输入行');
cut(/\s*<div id="room" class="hidden"><\/div>/, '房间容器');
cut(/\s*<div id="net-status" class="hidden">[^<]*<\/div>/, '联网状态条');
// 加载页 CSS：Chrome 61 没有 min()、Flex gap；inset 等由 lightningcss 按 Chrome 61 展开
swap('width: min(86vw, 760px);', 'width: 86vw; max-width: 760px;', '加载页宽度');
swap('justify-content: center; gap: 1px;', 'justify-content: center;', '加载页气泡间距');
const styleM = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleM) throw new Error('client/index.html 里找不到加载页 <style>');
const lowered = cssTransform({ filename: 'loader.css', code: Buffer.from(styleM[1]), minify: true, targets: { chrome: 61 << 16 } }).code.toString();
html = html.replace(styleM[0], `<style>${lowered}</style>`);

fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'boot.js'), boot);

// ---------- 4. 静态校验 ----------
// Vite 的 lib 模式不会产生其他文件；有多余文件（如误打包的 module Worker）就是配置出了问题
const ALLOWED = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  }
})(out);
const names = files.map((f) => path.relative(out, f).split(path.sep).join('/')).sort();
if (!names.includes('index.html')) fail('index.html 不在包根目录');
if (names.filter((n) => n.endsWith('.html')).length !== 1) fail('包内必须有且只有一个 HTML（index.html）');
for (const n of names) {
  if (!ALLOWED.has(path.extname(n).toLowerCase())) fail(`${n}：文件类型不在小工具白名单内`);
  if (/(^|\/)(node_modules|\.git|\.DS_Store)|\.map$|config\./.test(n)) fail(`${n}：开发文件不应进包`);
}
const expected = ['app.js', 'boot.js', 'index.html', 'mc-worker.js', 'style.css'];
for (const n of names) if (!expected.includes(n)) fail(`${n}：预期外的产物文件`);

const outHtml = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
if (!/^<!doctype html>/i.test(outHtml.trim())) fail('index.html 缺少 <!DOCTYPE html>');
if (!/<html lang="zh-CN"/.test(outHtml)) fail('index.html 缺少 lang="zh-CN"');
if (!/<meta charset="utf-8"/i.test(outHtml)) fail('index.html 缺少 charset=UTF-8');
const vp = outHtml.match(/<meta name="viewport" content="([^"]+)"/);
if (!vp || !/width=device-width/.test(vp[1]) || !/initial-scale=1/.test(vp[1]) || !/viewport-fit=cover/.test(vp[1])) fail('viewport 需含 width=device-width、initial-scale=1、viewport-fit=cover');
if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(outHtml)) fail('index.html 含内联脚本');
if (/type="module"/i.test(outHtml)) fail('index.html 含 module 脚本');
if (/\son[a-z]+\s*=/i.test(outHtml.replace(/<style>[\s\S]*?<\/style>/, ''))) fail('index.html 含行内事件属性');
if (/javascript:/i.test(outHtml)) fail('index.html 含 javascript: URI');
if (/<(iframe|object|embed|base|form)\b/i.test(outHtml)) fail('index.html 含 iframe/object/base/form');
if (/http-equiv=["']?Content-Security-Policy/i.test(outHtml)) fail('index.html 不应自建 CSP');
if (/\b(src|href)=["'](https?:)?\/\//i.test(outHtml)) fail('index.html 引用了外部资源');
if (/\b(src|href)=["']\//.test(outHtml)) fail('index.html 用了绝对路径');
for (const m of outHtml.matchAll(/\b(?:src|href)="(\.\/[^"#]+)"/g)) if (!names.includes(m[1].slice(2))) fail(`index.html 引用的 ${m[1]} 不在包内`);

// JS：被禁能力扫描。PixiJS 库里的个别代码不会执行到，单独列出说明
const LIB_RESIDUAL = {
  'fetch(': 'PixiJS DOMAdapter 的资源加载封装；本项目牌面全部由代码绘制，不经 Pixi Assets 加载，不会调用',
};
const BANNED = ['new WebSocket(', 'new EventSource(', 'new RTCPeerConnection(', 'XMLHttpRequest', 'fetch(', 'new SharedWorker(', 'serviceWorker.register',
  'navigator.geolocation', 'navigator.clipboard', "execCommand('copy'", 'navigator.bluetooth', 'navigator.usb', 'navigator.hid', 'navigator.serial',
  'navigator.getBattery', 'navigator.credentials', 'navigator.locks', 'enumerateDevices', 'getDisplayMedia', 'storage.persist',
  'DeviceMotionEvent', 'DeviceOrientationEvent', 'devicemotion', 'deviceorientation', 'requestFullscreen', 'webkitRequestFullscreen',
  'eval(', 'new Function(', 'WebAssembly.', 'window.open(', 'window.prompt(', 'location.assign(', 'importScripts(', 'import(', 'import.meta', 'sourceMappingURL'];
for (const n of names.filter((x) => x.endsWith('.js'))) {
  const code = fs.readFileSync(path.join(out, n), 'utf8');
  for (const b of BANNED) {
    const c = code.split(b).length - 1;
    if (!c) continue;
    if (LIB_RESIDUAL[b]) notes.push(`${n}：含 ${c} 处 \`${b}\`（${LIB_RESIDUAL[b]}）`);
    else fail(`${n}：含被禁用的 \`${b}\`（${c} 处）`);
  }
  // Pixi 的 unsafe-eval 检测函数（内部 Function(...)）必须已被 pixi.js/unsafe-eval 覆盖掉调用点
  if (/[^.\w]Function\(`param1`/.test(code) && !/_systemCheck\(\)\{\}/.test(code)) fail(`${n}：PixiJS 会调用 Function() 检测 unsafe-eval，缺少 pixi.js/unsafe-eval`);
  if (/[^.\w]Function\(`param1`/.test(code)) notes.push(`${n}：PixiJS 的 unsafe-eval 检测函数仍在代码里，但调用点已被 pixi.js/unsafe-eval 覆盖为空，不会执行`);
  // ES2017 以后的语法（粗查：忽略字符串内容可能导致误报，出现时需人工确认）
  const stripped = code.replace(/`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""');
  const SYNTAX = [[/\?\?=?/, '空值合并 ??'], [/\?\.(?!\d)/, '可选链 ?.'], [/\|\|=|&&=/, '逻辑赋值'], [/\bstatic\s*\{/, 'static 块'], [/[^\w$]#[a-zA-Z_$][\w$]*\s*(?:[=(;]|in\b)/, '私有字段 #x'], [/\(\?<[=!]/, '正则后行断言'], [/\\p\{/, '正则 Unicode 属性'], [/\d+n\b(?![\w$])/, 'BigInt 字面量'], [/\bcatch\s*\{/, '省略 catch 绑定'], [/\.\.\.\s*\{|\{\s*\.\.\./, '对象展开 {...x}']];
  for (const [re, what] of SYNTAX) {
    const m = stripped.match(re);
    if (m) fail(`${n}：疑似 ES2017 以后的语法（${what}）：…${stripped.slice(Math.max(0, m.index - 40), m.index + 40)}…`);
  }
}

// CSS：Chrome 61 不可作为唯一实现的能力，必须有前置回退
const css = fs.readFileSync(path.join(out, 'style.css'), 'utf8') + '\n' + lowered;
const decls = css.split(/[{}]/).filter((_, i) => i % 2 === 1);
for (const block of decls) {
  const ds = block.split(';').map((d) => d.trim()).filter(Boolean);
  ds.forEach((d, i) => {
    const prop = d.slice(0, d.indexOf(':')).trim();
    if (/^(inset|aspect-ratio|margin-inline|padding-inline|margin-block|padding-block|inset-inline|inset-block)$/.test(prop)) fail(`style：Chrome 61 不支持 \`${d}\``);
    if (/\b(min|max|clamp)\(|\b[sdl]vh\b|color-mix\(|oklch\(/.test(d) && !ds.slice(0, i).some((x) => x.startsWith(prop + ':'))) fail(`style：\`${d}\` 没有 Chrome 61 可用的前置回退`);
  });
}
if (/@container|@layer|:has\(|@property/.test(css)) fail('style：含 Chrome 61 不支持的 @container/@layer/:has/@property');
if (/url\(\s*["']?(https?:)?\/\//.test(css)) fail('style：引用了外部资源');

// ---------- 5. 打包 ----------
function zip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  // 固定时间戳（2000-01-01），同样的输入产出同样的 zip
  const time = 0, date = ((2000 - 1980) << 9) | (1 << 5) | 1;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, deflated);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(deflated.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + deflated.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}

if (errors.length) {
  console.error('\n小工具校验未通过：');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
fs.rmSync(zipPath, { force: true });
fs.writeFileSync(zipPath, zip(names.map((n) => ({ name: n, data: fs.readFileSync(path.join(out, n)) }))));

console.log('\n小工具静态校验通过');
for (const n of names) console.log(`  ${n.padEnd(14)} ${(fs.statSync(path.join(out, n)).size / 1024).toFixed(1).padStart(8)} KiB`);
for (const m of notes) console.log('  说明：' + m);
console.log(`\n产物目录：${rel(out)}\n上传包：  ${rel(zipPath)}（${(fs.statSync(zipPath).size / 1024).toFixed(1)} KiB）`);
