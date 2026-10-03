// 同时启动服务端（8787）和 Vite 开发服务器（5173，/ws 代理到服务端）
import { spawn } from 'node:child_process';

const run = (cmd) => spawn(cmd, { stdio: 'inherit', shell: true });
const procs = [run('npx tsx watch server/index.ts'), run('npx vite --host')];
const stop = () => { for (const p of procs) p.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
