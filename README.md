# 掼蛋

手机网页版四人掼蛋（横屏），支持单机对 AI 和好友联机。

## 开发

```bash
npm install
npm run dev      # 服务端 :8787 + 前端 :5173（/ws 代理到服务端），手机用局域网地址访问 5173
npm test         # 规则 / AI / 房间测试
```

## 部署

```bash
npm run build    # 产物：dist/client（网页）+ dist/server.mjs（服务端）
PORT=8787 npm start
```

一个 Node 进程同时提供网页和 WebSocket（`/ws`）。生产环境前面放 Nginx 做 HTTPS，并转发 WebSocket：

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 120s;
}
```

### 线上部署：Netlify（前端）+ Render（联机服务）

Netlify 只托管静态网页，联机用的 WebSocket 服务部署在 Render。

1. **Render**：New → Blueprint，选择本仓库，按 `render.yaml` 创建 `guandan-server`（免费版，新加坡）。
   部署完成后得到地址 `https://<名称>.onrender.com`，浏览器打开应显示“掼蛋联机服务运行中”。
2. **Netlify**：Add new site → Import from GitHub，选择本仓库（构建配置见 `netlify.toml`）。
   在 Site configuration → Environment variables 添加 `VITE_WS_URL = wss://<名称>.onrender.com/ws`，然后重新部署。

说明：
- Render 免费版闲置约 15 分钟后休眠，下次访问需要几十秒唤醒；网页打开时会自动发请求提前唤醒。
- 房间保存在服务端内存里，服务重启或休眠后进行中的房间会丢失。
- 不设置 `VITE_WS_URL` 时，前端连接同域名下的 `/ws`（单机部署时用）。

## 音频

- 音效和背景音乐：Web Audio 实时合成（`client/src/audio/Sound.ts`），没有外部素材。
- 出牌语音：`client/public/voice/{male,female}/*.mp3`，台词在 `scripts/voice-lines.json`。
  当前文件用 Windows 自带的中文语音（康康/慧慧）生成，作为开发占位。正式上线前建议换成有商用授权的录音或云端 TTS，文件名保持不变即可直接替换。
  重新生成：

  ```powershell
  powershell -File scripts/gen-voice.ps1 -OutDir voice-wav
  node scripts/encode-voice.mjs voice-wav
  ```

## 目录

- `shared/` 规则引擎、AI、牌桌控制器、联机协议（前后端共用）
- `server/` 房间与 WebSocket 服务
- `client/` PixiJS 前端（`net/` 联机，`scene/` 牌桌界面）
- `tests/` 测试
