// 小红书小工具版入口（构建模式 minitool，见 minitool/build.mjs）：单机对电脑，打包成离线 zip。
// 顺序：先补 Chrome 61 缺的运行时 API → PixiJS 不用 new Function 的着色器实现（容器 CSP 禁止动态执行代码）
// → 从容器 Storage JS API 读入本机设置 → 再启动游戏。
import './platform/polyfills';
import 'pixi.js/unsafe-eval';
import './style.css';
import { initKv, KV_KEYS } from './platform/kv';

void initKv(KV_KEYS)
  .catch(() => undefined)
  .then(() => import('./main'));
