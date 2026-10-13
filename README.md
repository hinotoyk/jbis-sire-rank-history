# JBIS-Sire-Rank-History

JBIS 种马排名（リーディングサイアー）每日历史记录。

记录 JBIS 排名（jbis.or.jp）5 类种马榜单的每日快照（全量收录），以纯文件（JSON）存储，可部署到 GitHub Pages 静态站点，回放排名变化（日/周/月/年：升/降/新登场/跌出榜）。

- **设计方案**：[docs/DESIGN.md](docs/DESIGN.md)（类型定义、数据契约、采集流程、GitHub Actions 调度与部署、图表方案）
- **数据**：`data/`（每日快照，随采集自动更新）
- **图表**：`site/vendor/echarts.min.js`（ECharts 5.6.1，本地自托管，Apache-2.0）
- **实现语言**：Node.js（零依赖，内置 `fetch`）

## 快速开始

```bash
npm start        # 采集当日快照 → 构建站点 → 启动 http://127.0.0.1:9090/ 并打开浏览器
npm run collect  # 仅采集（写入 data/）
npm run build    # 仅构建（生成 _site/）
npm run serve    # 仅启动本地服务（默认端口 9090）
```

## 自动运行与在线访问（GitHub）

推送到 GitHub 后无需本地参与：

- **自动更新数据**：`.github/workflows/collect.yml` 每日 06:17（北京时间，= 07:17 JST）定时采集 → 构建 → 将新快照提交回仓库 → 发布 Pages；也可在 Actions 页面手动触发（Run workflow）
- **在线访问**：仓库 Settings → Pages → Source 选 **GitHub Actions**（一次性设置），之后访问 `https://hinotoyk.github.io/jbis-sire-rank-history/`
- 补采历史年度（仅年度榜）：`node src/collect.js 2025` 本地执行后推送
