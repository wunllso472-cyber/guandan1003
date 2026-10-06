# 项目说明（给 Claude）

- 分析线上版本的出牌问题时，用线上服务器的复盘日志：`npx tsx scripts/review.ts [局数]`（默认读线上 Render，密钥在 `.env.local`；`--json 文件` 导出原始数据）。进行中的局也会实时上传（带 `live`，未执行的托管决策在 `pending`）。不要只凭截图推测。
