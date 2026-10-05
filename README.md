# 掼蛋

手机网页版四人掼蛋（横屏），支持单机对 AI 和好友联机。

## 技术架构

全部代码用 **TypeScript** 编写。规则和 AI 放在 `shared/`，前端和服务端共用同一份，保证两边对出牌合法性的判断一致。

```
 手机浏览器（Netlify 静态网页）
 ┌────────────────────────────────┐
 │ PixiJS 绘制牌桌、动画、特效       │
 │ 提示：顾问 + 蒙特卡洛模拟         │──┐
 │      （Web Worker 后台线程）      │  │ WebSocket
 └────────────────────────────────┘  │
                                     ▼
 Render 上的 Node.js 服务（新加坡）
 ┌────────────────────────────────┐
 │ 房间管理、四人联机同步、电脑补位   │──── Jev 接口（TypeSafe，联机提示的备选）
 └────────────────────────────────┘
```

| 部分 | 技术 | 说明 |
|---|---|---|
| 前端 `client/` | Vite 8、PixiJS 8（WebGL） | 横屏适配刘海屏、全屏；一键理牌；Web Audio 合成音效；预生成语音；表情；单机和联机两种模式 |
| 服务端 `server/` | Node.js 20、`ws`、`undici` | 房间、入座、出牌同步、断线重连、电脑补位；代为请求 Jev（密钥只在服务端）；`/healthz` 健康检查、`/version` 返回线上提交号 |
| 共享核心 `shared/` | 纯 TypeScript，无依赖 | 规则引擎、AI、记牌器、提示顾问、蒙特卡洛模拟、联机协议 |
| 测试 `tests/` | Vitest | 规则、牌型、理牌、房间、AI、策略、模拟 |
| 评估 `scripts/` | tsx | 策略对打评估、局面评分拟合、语音生成 |

### 目录

- `shared/`
  - `cards.ts` / `combo.ts`：牌、级牌、逢人配；牌型识别与比大小
  - `game.ts` / `table.ts`：一局的流程（发牌、进贡还贡、出牌、升级）和整张牌桌的控制
  - `ai.ts` / `finder.ts`：电脑出牌（先拆手牌找最优组合，再决定出牌）
  - `tracker.ts`：记牌器，根据已出的牌推断其余三家的牌；进贡（进贡者没有比贡牌大的牌）和抗贡（大王在进贡方）作为硬约束，模拟推测手牌时使用
  - `strategy.ts`：策略规则库（9 条，整理自《掼蛋实战进阶手册》，另加玩家复盘提出的“小王抢出牌权”）
  - `guandan-ai/` + `rulebook.ts`：教材规则库（56 条，《江苏省掼蛋项目一线社会体育指导员再培训教材》）及接入层
  - `inference.ts`：从公开出牌推断三家主攻/助攻倾向和牌路（教材 I01–I08）
  - `tribute.ts`：进贡、还贡选牌（教材 R01、R02）
  - `advisor.ts`：提示顾问，给出候选出法和理由
  - `mc.ts`：蒙特卡洛模拟与局面评分
  - `autoplay.ts`：托管/超时代打（与提示相同的策略）和决策记录
  - `protocol.ts` / `chat.ts`：联机消息格式、快捷聊天
- `server/`：`index.ts` 是 HTTP/WebSocket 入口，`room.ts` 管理房间，`jev.ts` 调用 Jev 接口，`logs.ts` 复盘日志（`/logs`）
- `client/src/`：`scene/` 牌桌界面，`net/` 联机，`game/` 单机对局、理牌、模拟线程、复盘日志，`review/` 复盘页面（`review.html`），`gfx/` 动画特效，`audio/` 声音，`ui/` 按钮
- `tests/`：测试
- `scripts/`：开发启动、评估（`bench.ts`、`bench-tribute.ts`、`infer-accuracy.ts`）、拟合、复盘日志读取（`review.ts`）、语音生成

### 提示的决策流程

1. **顾问**（`advisor.ts`）根据手牌、记牌信息和策略规则给出候选出法。
2. **蒙特卡洛模拟**（`mc.ts`）对前 4 个候选：先按记牌信息随机推测其余三家的手牌，再把每种出法推演下去。
   - 残局（场上剩 40 张以内）：推演到整局结束，比顾问首选好 0.25 级以上才改首选。
   - 开局和中盘：推演到本轮结束，再用局面评分估计团队结果，好 0.4 级以上才改首选。
3. 如果手机算得太慢、模拟样本不够，联机时改为请 **Jev** 排序（最多等 2 秒，置信度不低于 0.6 才采用）。

托管和超时代打用同样的策略（每手模拟时间预算 300 毫秒，不够时用顾问首选）。
电脑座位有两档难度（单机在“设置 → 电脑难度”切换，默认困难；联机房间补位的电脑为普通）：
- 普通：原电脑出牌，不记牌；
- 困难：与托管相同的策略（记牌 + 顾问 + 模拟），单机时模拟放在后台线程，界面不卡。

评估结果（1002 局，同一副牌交换座位各打一次，对手为电脑）：提示每局净升级 +0.67，托管 +0.65～+0.75，胜局率约 65%，被双下率约 16%。
中盘局面评分第二版加入控制牌特征（有效手数 = 手数 − 对方同类压不住的手数等）后，600 局对打：对原电脑每局 +0.99（第一版 +0.69），对顾问 +0.75（第一版 +0.61）。

### 教材规则的覆盖

| 类别 | 规则 |
|---|---|
| 计分、影响决策 | T02 T03 H02 H04 H05 O02 O03 O04 M01–M05 M07 E01 E03–E08 E11，另有贡牌 R01 R02 |
| 与原有 9 条重合，只作依据 | T04（对家主攻时加重）H06 M06 E02 O01 E15 H03 |
| 推断（提示、Jev、复盘中显示） | I01–I08；T01 H01 H07 H08 T05 E09 E10 E12–E14 作为参考交给 Jev |
| 由引擎和记牌器保证 | L01–L07 |

### 复盘日志

每局结束时，浏览器把本局出牌过程和每次决策依据（候选、评分、模拟结果、命中规则、对三家的推断）保存在本机并上传服务端 `/logs`。
游戏菜单的“复盘记录”打开 `review.html` 逐手查看；开发者用 `npx tsx scripts/review.ts [局数]` 读取服务端日志（密钥 `GD_LOG_KEY` 在 `.env.local`，代码里只有其 SHA-256）。

### 策略评估

```bash
npx tsx scripts/bench.ts mc ai 334 500000   # 策略 A 对 策略 B，局数，随机种子
npx tsx scripts/fit-eval.ts 3000            # 重新拟合中盘局面评分权重（每 5 局留 1 局验证；GD_EVAL=v1 用第一版特征）
```

策略可选 `ai`、`advisor`、`jev`、`mc`、`auto`（托管）；常用环境变量：`GD_MC_MID=1`（中盘也模拟）、`GD_TRIBUTE=1`（每局先按随机名次进贡/抗贡）、`GD_DISABLE_RULES`（停用部分规则）、`GD_DUMP`（导出每局结果）。
评估看团队结果：每局净升级、胜局率、双上率和被双下率，不只看头游率。
对手用 `ai`（普通电脑）跑得快，适合初筛；改进策略最终要对 `auto`（与困难电脑相同）验证，避免只对弱电脑有效。

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

- Jev 提示需要在 Render 的环境变量里设置 `JEV_API_KEY`（本地放 `.env.local`，不要提交）。
- 提交信息里写 `[skip render]` / `[skip netlify]` 可以跳过对应平台的自动部署。

说明：
- Render 免费版闲置约 15 分钟后休眠，下次访问需要几十秒唤醒；网页打开时会自动发请求提前唤醒。
- 房间保存在服务端内存里，服务重启或休眠后进行中的房间会丢失。
- 不设置 `VITE_WS_URL` 时，前端连接同域名下的 `/ws`（单机部署时用）。

## 音频

- 音效和背景音乐：Web Audio 实时合成（`client/src/audio/Sound.ts`），没有外部素材。
- 语音：豆包语音（seed-audio-1.0）生成，台词总表在 `shared/voice-script.json`
  （普通话为主，少量东北话、粤语；玩家音色男女各一份，系统播报单独一个音色），
  文件在 `client/public/voice/{male,female,narrator}/<key>.mp3`。
  密钥放在本地 `.env.local`（`DOUBAO_API_KEY=...`，已被 .gitignore 忽略，不要提交）。

  ```bash
  node scripts/gen-voice-doubao.mjs                       # 生成全部（已生成的跳过）
  node scripts/gen-voice-doubao.mjs --only pair_3 --tries 3   # 重做指定台词，生成 3 版挑最干脆的
  node scripts/gen-voice-doubao.mjs --check               # 列出时长偏长（可能拖音）的短台词
  ```
