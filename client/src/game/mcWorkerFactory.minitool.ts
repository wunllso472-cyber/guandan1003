// 小红书小工具（客户端 9.53+）只支持包内经典脚本 Worker、每页最多一个：
// mc-worker.js 由 minitool/build.mjs 从 mcWorkerClassic.ts 打包。低版本客户端创建会抛错，调用方按“不做模拟”处理。
export function createMcWorker(): Worker {
  return new Worker('./mc-worker.js');
}
