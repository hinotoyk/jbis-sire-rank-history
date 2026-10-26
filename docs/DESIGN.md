# JBIS 種馬ランキング 每日记录方案（JBIS-Sire-Rank-History）

> 版本：v1.2　|　数据源验证日期：2026-10-10（实测）　|　目标部署：GitHub Pages 静态站点
>
> 修订记录：v1.8 — 世代別改为**出生年维度**（t4-gen-central / t5-gen-overall，采集窗口最近 3 个世代自动滑动），tab 不再硬编码"2023年生"；v1.7 — 年度分板统一到全部类型，年份默认最新；v1.6 — 年度滚动建模（板 = 类型 × 年份、UI 切换器、深链、历史补采，§8.3）。v1.5 — Δ 期间口径改为**周期桶对比**：本桶最新 vs 上一有数据桶最新（周对周/月对月/年末对年末，§7.1），与曲线 x 轴分桶统一。v1.4 — **全量收录**（翻页抓取，§5.2）；種牡馬名/代表産駒超链 JBIS；排名曲线默认 Top-3 + コントレイル、明细行点击增减（§10.3）。v1.3 — 简约低彩主题、纯白背景（§10.4）。v1.2 — 每类型仅记录前 100 名（单请求、不翻页）；新增本地 Chart 插件方案（ECharts 5.6.1，§10）。v1.1 — 变化对比泛化为 日/周/月/年 多期间（§7）；2歳 榜单采集窗口明确为每年约 6 月～12 月（§3、§8.1）。

---

## 1. 目标与范围

记录 JBIS（jbis.or.jp）リーディングサイアー系排名的**每日快照**，满足：

1. **排名类型**：种马排名（リーディングサイアー）中的 5 种具体榜单（见 §3）。
2. **历史粒度**：每日一个快照，可回放任意两日之间的排名变化（升/降/新登场/跌出榜）。
3. **按检索条件组合区分类型**：类型由 `ranking × division × kind × 年度/世代维度` 唯一确定。
4. **存储与发布**：数据为**纯文件**（JSON），可直接提交 GitHub 仓库并由 **GitHub Pages** 以静态站点形式发布；采集与派生计算用 **Node.js**（零依赖，仅用内置 `fetch`）。

本次交付为**设计方案文档**（含数据契约与流程），代码骨架在 §5/§6 中以示例形式给出，后续可照此实现。

---

## 2. 数据源验证结果（2026-10-10 实测）

### 2.1 URL 与参数语义

榜单页：`https://www.jbis.or.jp/ranking/result/?<参数>`

| 参数 | 类型 | 取值（实测） | 语义 |
|---|---|---|---|
| `ranking` | radio | `1`=年度別サイアー，`2`=2歳，`3`=ファーストシーズンサイアー，`4`=世代別サイアー，`5`=ブルードメアサイアー，… | 榜单种类 |
| `kind` | radio | `1`=サラ系，`2`=アラ系 | 馬種 |
| `division` | radio | `1`=総合，`2`=中央，`3`=地方 | 中央/地方/総合维度 |
| `hold` | checkbox | `0`=すべて，`1`=中央，`2`=地方 | 与 `division` 冗余；传 `division` 即可，`hold` 可不传 |
| `racetype1` | radio | `1`=総合，`2`=芝，`3`=ダート | 馬場（第1维） |
| `racetype2` | radio | `1`=総合，`2`=平地，`3`=障害 | 競走種別（第2维） |
| `condition` | radio | `1`=総合，`2`=良，`3`=稍重，`4`=重，`5`=不良 | 馬場状態 |
| `y1` | select | 1972–2026（逐年） | **年度別/2歳**：集計年度；**世代別**：集計年度 |
| `y2` / `y3` | select | 1974–2024 / 2000–2026 | **世代別**：世代（出生年）范围的下限/上限 |
| `items` | select | 20 / 50 / 100 | 每页行数（最大 100） |
| `sort` / `order` / `page` | select/链接 | `ranking` 等；`A`=昇順 `D`=降順；页码 | 排序与分页 |

**实测结论（重要）**：

- 「中央」= `division=2`（加不加 `hold=1` 结果相同：438 件）。总合 = `division=1`。
- **世代別サイアー**必须同时传三个年度参数：`y1`=集計年度，`y2`=世代下限，`y3`=世代上限。
  例：2026年集計、2023年生世代 → `ranking=4&y1=2026&y2=2023&y3=2023`（中央 285 件）。只传 `y1` 会返回空榜。
- 快照统一用 `sort=ranking&order=A`（順位昇順，与默认视图一致）＋ `items=100`，全量拉取所有页。

### 2.2 结果行结构（div 布局，非 `<table>`）

页面无 `<table>/<tr>/<td>`，榜单在 `div.data-7__inner` 内按“行块”渲染。每行 = 一个 `<div>`，内含 13 个子 `<div>`，顺序固定：

| # | 内容 | 示例（实测 2026 年度別・中央） | 解析要点 |
|---|---|---|---|
| 1 | 順位 | `1` | 整数；可能并列（保留原文与行序） |
| 2 | 種牡馬名 | `<a href="/horse/0001120570/">キズナ</a>` | **马 ID** 取 `/horse/(\d{10})/`，名称保留如 `シスキン(USA)` 后缀 |
| 3 | 出走・回数 | `974` | 整数 |
| 4 | 出走・頭数 | `279` | 整数 |
| 5 | 勝利・回数 | `118` | 整数 |
| 6 | 勝利・頭数 | `93` | 整数 |
| 7 | 重賞勝・回数 | `8` | 整数 |
| 8 | 重賞勝・頭数 | `8` | 整数 |
| 9 | AEI・全般 | `1.84` | 浮点；可缺失 |
| 10 | AEI・重賞 | `1.27` | 浮点；可缺失，世代別早期常为 `-` |
| 11 | 賞金・全般 | `303982.9万円` | 解析为数值 `303982.9`，单位固定 万円 |
| 12 | 賞金・重賞 | `111006.2万円` | 同上 |
| 13 | 代表産駒 | `<a href="/horse/0001340113/">シックスペンス</a>` | 可缺失 → `null` |

缺失值统一显示为 `-`，解析为 `null`。

### 2.3 榜单规模（2026-10-10 实测，件数 = 上榜种马数）

按需求：**全量收录**（`items=100` 翻页抓完所有上榜种马）。

| 类型 | 全量件数（= 记录行数） |
|---|---|---|
| 2歳・中央（サラ系） | 215 | 100 |
| 年度別・中央（サラ系） | 438 | 100 |
| 年度別・総合（サラ系） | 614 | 100 |
| 世代別 2023年生・中央 | 285 | 100 |
| 世代別 2023年生・総合 | 325 | 100 |

每日 5 个快照合计 **500 行**、**仅 5 次 HTTP 请求**（每类型 1 次），规模很小。

### 2.4 重要限制：历史不可回填每日粒度

JBIS 只提供“所选年度的**当前累计**排名”。过去年度的榜单是冻结的最终值——**不存在**“过去某日的当日排名”历史。因此：

- 每日粒度只能**从本方案启用日起前向积累**（尽快开始，越早越完整）。
- 过去年度只能回填“最终累计快照”（标注 `final: true`），不能重建日变化。

---

## 3. 排名类型定义（5 种类型的规范化查询）

所有类型公共参数：`kind=1`（サラ系）`racetype1=1` `racetype2=1` `condition=1` `sort=ranking` `order=A` `items=100`。

**数据范围：全量收录**（翻页抓取全部上榜种马，行数与页面宣告件数一致）。

| 类型 ID | 名称 | ranking | division | 年度/世代参数 | 开始记录 | 维度语义 |
|---|---|---|---|---|---|---|
| `t1-2yo-central` | 中央 サラ系 2歳 | `2` | `2` | `y1`=当年赛季 | 自启用日起，在窗口内记录：每年约 6 月（首个 2歳 レース）～12 月 | 赛季年滚动；窗口外无有效榜单 |
| `t2-annual-central` | 中央 年度別サイアー サラ系 | `1` | `2` | `y1=2026` | 2026 年起 | 集計年度固定 2026 |
| `t3-annual-overall` | 総合 年度別サイアー サラ系 | `1` | `1` | `y1=2026` | 2026 年起 | 集計年度固定 2026 |
| `t4-gen-central-2023` | 中央 世代別サイアー サラ系（2023年生） | `4` | `2` | `y1`=当年，`y2=y3=2023` | 2023 年生世代起 | 世代固定 2023，集計年度滚动 |
| `t5-gen-overall-2023` | 総合 世代別サイアー サラ系（2023年生） | `4` | `1` | `y1`=当年，`y2=y3=2023` | 2023 年生世代起 | 世代固定 2023，集計年度滚动 |

要点：

- **t2/t3**：`y1=2026` 写死在类型配置里；2027 年新榜单按“年度维度扩展”追加新类型（见 §8.3）。
- **t4/t5**：世代（出生年 2023）固定，`y1` 随年份滚动（2026→2027→…），记录该世代每年集計下的排名演变；后续世代（2024 年生等）可追加。
- **t1**：2歳 榜单的**有效窗口为每年约 6 月～12 月**（用户确认）：6 月前无 2歳 レース、榜单不存在；12 月末赛季结束，年度最终榜即定稿。采集按窗口进行（§8.1），窗口外不产生无意义快照。
- 每类型在配置中同时保留：`startDate`、`note`（中文说明）、`canonical query`（§5.1）。

---

## 4. 存储方案（面向 GitHub Pages）

### 4.1 为什么“只能纯文件保存”——直接回答

GitHub Pages 只提供**静态文件托管**：无服务端进程、无数据库、无动态路由。因此：

- 所有数据必须以**文件**形式存在仓库中（`data/**/*.json`），站点用 `fetch` 读取。
- 这**不是妥协，而是契合**：本方案的核心模型就是“每日快照 = 一个文件”，日变化 = 相邻日期文件的 diff/对比，天然文件化。
- 如需复杂查询（全历史 SQL 分析），可在**本地或 CI 构建期**临时把 JSON 灌入 SQLite 分析，但**发布到 Pages 的始终是文件**。
- 原始 HTML 归档（防 JBIS 改版后重解析）属可选增强，应放**独立私有仓库或分支**，不进 Pages 发布目录（§8.3）。

### 4.2 仓库目录布局

```
jbis-sire-rank-history/
├─ README.md
├─ docs/DESIGN.md                  # 本方案
├─ src/                            # Node.js 采集/构建脚本（零依赖）
│  ├─ config.js                    # 5 类型定义（§5.1）
│  ├─ collect.js                   # 每日采集主流程：抓取→解析→校验→写快照（§5）
│  ├─ build-site.js                # Pages 构建期：生成派生数据（§4.5）
│  └─ lib/{fetch,parse,validate}.js
├─ data/                           # ★ 快照数据（提交入库 → 随 Pages 发布）
│  ├─ manifest.json                # 全类型索引/最新状态
│  ├─ t1-2yo-central/2026/2026-10-10.json
│  ├─ t2-annual-central/2026/2026-10-10.json
│  ├─ t3-annual-overall/2026/2026-10-10.json
│  ├─ t4-gen-central-2023/2026/2026-10-10.json
│  └─ t5-gen-overall-2023/2026/2026-10-10.json
├─ site/                           # 静态站点源码（纯 HTML/JS，读 data/）
│  └─ vendor/echarts.min.js         # 本地 Chart 插件（ECharts 5.6.1，Apache-2.0，见 §10）
└─ .github/workflows/
   ├─ collect.yml                  # 每日 cron 采集 + 自动提交（§6.1）
   └─ pages.yml                    # Pages 构建 + 部署（§6.2）
```

**文件组织规则**：

- 快照路径：`data/<类型ID>/<年度>/<YYYY-MM-DD>.json`（世代別按集計年度分目录）。
- 类型 ID 含“维度”信息（`annual-2026`、`gen-2023`），**不**因年份/世代滚动而改名，保证历史稳定。
- 年度目录使增量提交只碰当日文件，git 历史干净。

### 4.3 每日快照 JSON 契约（schema v1）

```jsonc
{
  "schema": "jbis.sire.rank.snapshot/v1",
  "type": "t2-annual-central",
  "date": "2026-10-10",                    // 数据日期（JST）
  "capturedAt": "2026-10-10T22:35:00+09:00",// 采集时刻（可审计）
  "query": {                                // 完整规范化请求，可重放
    "ranking": 1, "y1": 2026, "division": 2, "kind": 1,
    "racetype1": 1, "racetype2": 1, "condition": 1,
    "sort": "ranking", "order": "A", "items": 100
  },
  "total": 438,                             // 页面宣告的件数（rows 应等于 total）
  "pages": 5,                               // 实际拉取的页数
  "status": "ok",                           // ok | partial | empty | error
  "rows": [
    {
      "rank": 1,
      "sire": { "id": "0001120570", "name": "キズナ" },
      "starts": 974, "runners": 279,
      "wins": 118, "winners": 93,
      "gradedWins": 8, "gradedWinners": 8,
      "aeiOverall": 1.84, "aeiGraded": 1.27,   // 缺失为 null
      "prizeOverall": 303982.9, "prizeGraded": 111006.2, // 单位：万円
      "repProgeny": { "id": "0001340113", "name": "シックスペンス" } // 缺失为 null
    }
    // ...（rows 为全量上榜种马；顺序即 JBIS 順位序；rank 并列时保留原文序）
  ]
}
```

字段说明：

- `sire.id` 取 `/horse/(\d{10})/`，是跨日关联种马的**稳定主键**（比名称可靠）。
- `prize*` 存储数值（万円），`"-"`/缺失 → `null`；展示时再拼单位。
- `aei*` 同理；世代別早期 `aeiGraded` 常为 `null`。
- `rows` 必须为**全量**（所有页），否则“新登场/跌出榜”检测不可靠。
- `status` 允许 `empty`（如 2歳 年初空榜），空榜也落文件，保证日期连续。

### 4.4 manifest.json（全量索引）

```jsonc
{
  "schema": "jbis.sire.rank.manifest/v1",
  "updatedAt": "2026-10-10T22:35:10+09:00",
  "types": {
    "t2-annual-central": { "name": "中央 年度別サイアー サラ系", "startDate": "2026-01-01" }
    // ...5 类型
  },
  "snapshots": {
    "2026-10-10": { "t1-2yo-central": "ok", "t2-annual-central": "ok", "t3-annual-overall": "ok",
                    "t4-gen-central-2023": "ok", "t5-gen-overall-2023": "ok" }
  }
}
```

- 站点首页先拉 `manifest.json` 即可渲染“类型/日期”选择器。
- `snapshots` 用**日期→各类型状态**映射，缺项即当日未采集；`partial/error` 状态保留原始 `capturedAt`，便于补跑。

### 4.5 派生数据（站点用，构建期生成，不提交）

`collect.yml` 只提交当日 5 个快照（每日增量小、git 干净）；**派生数据在 `pages.yml` 构建期**由 `build-site.js` 生成到 `_site/derived/`：

| 产物 | 内容 | 用途 |
|---|---|---|
| `derived/{type}/latest.json` | 最新快照（含与上一日的 rank delta） | 首页/默认视图 |
| `derived/{type}/deltas/{date}.json` | 按**日/周/月/年**四个期间与基准日对比（§7）：`{daily\|weekly\|monthly\|yearly: {refDate, bySire: {sireId: {prevRank, rank, delta}}}}` | 变化高亮 |
| `derived/sire-history/{type}/{sireId}.json` | 该种马在该类型全历史 `[{date, rank, prizeOverall}]` | 种马详情曲线 |

取舍说明：全量 sire-history 若每日更新会导致数千小文件高频变动（git 噪音大），故**仅在构建期生成**、且默认只覆盖“最新榜 top-100 + 当日新登场”的种马；如需全量历史曲线，站点端按年度目录批量拉取快照（每类型每年 ≤ 7MB，可接受）自行聚合。此策略可在实现时按需调整。

### 4.6 体积估算（git / Pages 均无压力）

- 每快照约 50–150 KB（minified JSON，全量行），5 个/日 ≈ **0.3–0.8 MB/日 ≈ 100–300 MB/年**（含全量 sire-history）。
- 每日 1 个 commit（仅当日文件 + manifest），一年 365 个 commit，仓库 < 100 MB，远低于 GitHub 建议上限（1 GB）。
- 不建议在 Pages 上放原始 HTML 归档（会翻倍体积且无展示价值），见 §8.3。

---

## 5. 采集流程（Node.js，零依赖）

### 5.1 类型配置（`src/config.js` 设计）

```js
export const BASE = { kind: 1, racetype1: 1, racetype2: 1, condition: 1,
                      sort: "ranking", order: "A", items: 100 };
export const TYPES = [
  { id: "t1-2yo-central",      name: "中央 サラ系 2歳",
    query: { ranking: 2, division: 2 }, year: "current",
    season: { startMonth: 6, endMonth: 12 },   // 2歳 榜单窗口：约 6 月～12 月（§8.1）
    startDate: "2026-01-01" },
  { id: "t2-annual-central",   name: "中央 年度別サイアー サラ系",
    query: { ranking: 1, division: 2 }, year: 2026,      startDate: "2026-01-01" },
  { id: "t3-annual-overall",   name: "総合 年度別サイアー サラ系",
    query: { ranking: 1, division: 1 }, year: 2026,      startDate: "2026-01-01" },
  { id: "t4-gen-central-2023", name: "中央 世代別サイアー サラ系（2023年生）",
    query: { ranking: 4, division: 2, y2: 2023, y3: 2023 }, year: "current", startDate: "2026-01-01" },
  { id: "t5-gen-overall-2023", name: "総合 世代別サイアー サラ系（2023年生）",
    query: { ranking: 4, division: 1, y2: 2023, y3: 2023 }, year: "current", startDate: "2026-01-01" },
];
// year: "current" = 当年（JST）；数字 = 固定年度（t2/t3=2026）
// season: 仅 t1 有采集窗口（6 月～12 月），窗口外跳过采集
// 最终请求 = { ...BASE, ...query, y1: resolveYear(year) }

// 变化对比期间（§7）：基准日 = 目标日期偏移；缺失时取“最晚可用快照 ≤ ref”
export const PERIODS = {
  daily:   { days: -1 },
  weekly:  { days: -7 },
  monthly: { months: -1 },   // 上月同日
  yearly:  { years: -1 },    // 去年同日
};
```

### 5.2 抓取（`fetch.js`）

1. 对每个类型：`y1 = resolveYear(year)`（固定值或当年 JST）。
2. **分页抓取**：`items=100&sort=ranking&order=A&page=1..P`，直到累计行数 = `data-hit__count` 宣告的 N（空页保护、页间 ≥1s 延迟）。首页读出全量件数 `N`。
3. 礼貌抓取：`User-Agent` 注明用途与联系方式；请求间隔 ≥ 1s；超时 30s；失败重试 3 次（指数退避 2s/4s/8s）。
4. 若请求失败：本类型标 `status: "partial"`（或 `"error"`），**不中断其他类型**。

### 5.3 解析（`parse.js`）

1. 定位 `div.data-7__inner`，按“行块 `<div>` 的直接子 `<div>`”切分（每块 13 个子 div，顺序见 §2.2）。
2. 字段映射：順位→`rank`；種牡馬名→`sire{id,name}`（`/horse/(\d{10})/` 提取 id）；第 3–12 个子 div→`starts/runners/wins/winners/gradedWins/gradedWinners/aeiOverall/aeiGraded/prizeOverall/prizeGraded`；第 13→`repProgeny{id,name}`。
3. 数值归一：整数/浮点；`-`、`""` → `null`；`303982.9万円` → `303982.9`。
4. 保留行序（并列順位时以行序为稳定序）。

### 5.4 校验（`validate.js`，任一失败即 `status: "error"` 并告警）

- 行数 == 全量件数 N（翻页抓完；允许空榜 N=0）。
- `rank` 序列与行序一致且连续递增（允许并列，即非严格递增）。
- `sire.id` 唯一、非空、格式 `\d{10}`。
- 数值列可解析；`total == rows.length`。

### 5.5 幂等与去重提交

- 同日重跑：写同一路径文件，**覆盖**（幂等）。
- 若 5 个快照与 manifest 与 HEAD 完全一致 → **跳过 commit**（无变化日不产生噪音提交）。
- 文件内容含 `capturedAt`，重跑会变化 → 提交前对快照**剔除 `capturedAt` 后做内容哈希比对**，`capturedAt` 仅保留在文件内。

### 5.6 失败处理

- 类型级隔离：某类型失败不影响其余 4 类当日快照。
- 请求级重试：仅针对失败的请求重试（不重跑整个板块），每次运行（即每日计划任务）全局最多重试 5 次，间隔 30s 起逐次翻倍（30s→60s→120s→240s→480s），耗尽预算仍失败才记 `error` 隔离。
- manifest 记录 `status: "partial" | "error"` 与失败页，次日 cron 自动补跑（同日重跑语义）或人工 `workflow_dispatch`。
- 连续失败（如 JBIS 改版导致解析全挂）→ 校验器报错 → 工作流失败 → 邮件/issue 通知（GitHub Actions 失败通知），并进入 §8.2 的人工处置。

---

## 6. 调度与部署（GitHub Actions）

### 6.1 `collect.yml` — 每日采集并自动提交

```yaml
name: collect
on:
  schedule: [{ cron: "30 3 * * *" }]   # 11:30 北京（12:30 JST）采集，快照标注当天日期（非整点避开高负载队列）
  workflow_dispatch: {}                 # 支持手动补跑
permissions: { contents: write }
jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: node src/collect.js                     # 零依赖
      - run: |
          git config user.name "jbis-rank-bot"
          git config user.email "bot@users.noreply.github.com"
          git add data
          git diff --cached --quiet && echo "NO_CHANGE" || (git commit -m "snapshot $(date -u +%F)" && git push)
```

要点：

- **时区与日期标注**：cron 为 UTC，选 03:30 UTC（=11:30 北京=12:30 JST）采集；快照 `date` 标注**采集当天**（JST）日期，`capturedAt` 为真实采集时刻（`+09:00`）用于审计；执行距 JST 零点 12.5 小时，常规调度延迟不会使标签跨日漂移。**采集时点必须晚于 JBIS 当日集计更新**（上午刷新，周末赛果并入在周一）：原 07:17 JST 的时点长期早于刷新，快照会系统性落后一档（2026-10-26 实测：08:26 JST 仍是周五数字，11:20 已含周末赛果）。
- **避免递归触发**：`collect` 只监听 `schedule`/`workflow_dispatch`，push 不会触发自身。
- 零依赖（Node ≥ 18 内置 `fetch`），无需 `npm install`。

### 6.2 `pages.yml` — 静态站点构建与部署

```yaml
name: pages
on: { push: { branches: [main] } }
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node src/build-site.js     # 生成 _site/derived/**（§4.5）
      - uses: actions/upload-pages-artifact@v3
        with: { path: site }            # site/ 含 data/（快照）+ derived/
      - uses: actions/deploy-pages@v4
```

### 6.3 站点数据契约（纯前端）

- 首页：`fetch('data/manifest.json')` → 类型/日期选择器 + 最新榜。
- 榜单表：`fetch('data/<type>/<year>/<date>.json')` → §4.3 的 `rows`。
- 变化对比：选择期间（日/周/月/年）后，拉 `derived/{type}/deltas/{date}.json`（或站点端直接对比两个快照，§7.3），高亮 升/降/新登場/跌出榜。
- 种马详情：`derived/sire-history/{type}/{sireId}.json` 画历史曲线。

---

## 7. 变化（Rank Delta）定义 —— 支持 日/周/月/年 多期间

变化不是写死的“仅日对比”，而是**任意两日快照之间的通用对比**，期间（period）作为参数：

```
delta(sire, d, period) = rank(sire, d) - rank(sire, ref(d, period))
```

### 7.1 期间与基准日 `ref(d, period)`

**口径（v1.5）：周期桶对比——"本桶最新 vs 上一桶最新"**，与排名曲线 x 轴分桶共用同一套定义：

| period | 当前桶 | 基准 ref（上一桶内最新快照） | 说明 |
|---|---|---|---|
| `daily` | 当日 | 上一采集日 | 相邻两个快照日对比 |
| `weekly` | 本 ISO 周（周一~周日） | 上周内最新采集日（通常为上周日） | 周对周 |
| `monthly` | 本自然月 | 上月内最新采集日（≈上月末） | 月对月 |
| `yearly` | 本年 | 去年内最新采集日（≈去年年末） | 年末对年末 |

**桶的取法**：基准 = 当前桶之前**最近一个有快照的桶**内的最新快照。桶间连续采集时即严格的"周对周 / 月对月 / 年末对年末"；若紧邻的桶整个缺失（如长期断采），向前取最近有数据的桶——保证 Δ 始终有对比，且与曲线 x 轴上相邻两个桶点一致。当前桶之前**完全没有**任何桶（首次采集）时，该期间 delta 全为 `null` 并标注 `refDate: null`。

### 7.2 判定规则

- `delta < 0` → 排名上升；`delta > 0` → 下降；`0` → 持平。
- 基准日有记录、当日无记录 → **跌出榜**（rank 置 `null`）。
- 当日有记录、基准日无记录 → **新登场**（prevRank 置 `null`）。
- **delta 语义（全量收录后）**：`"无记录"` 即该基准日**未上榜/未登场**，"新上榜 / 跌出榜" 可直接判定，无截断歧义。仅在基准日快照缺失时 delta 为 `null`。
- **并列順位**：JBIS 可能出现相同順位（如 `1,2,2,4`）。快照保留原文順位与行序；delta 以“显示順位”计算，并在展示上提示并列（`tie`）。
- 指标列（赏金/胜利数等）的期间增量同理：`Δ = value(d) - value(ref)`（“本周新增赏金”等展示直接用）。

### 7.3 实现位置

- **推荐**：站点端按所选期间取两个快照现场计算（零存储开销，期间是 UI 参数）。
- **可选**：构建期用 `build-site.js` 预生成全部期间到 `derived/{type}/deltas/{date}.json`（§4.5），空间换时间；`PERIODS` 配置见 §5.1。

---

## 8. 边界情况与风险

1. **2歳 榜单窗口（6 月～12 月）**：t1 仅在每年约 6 月（首个 2歳 レース）至 12 月（赛季结束）期间有有效榜单。采集按 `season` 窗口（§5.1）进行：窗口外跳过；窗口开始后每日记录，12 月末为赛季最终榜。若窗口内某日榜单异常为空，记 `status:"empty"` 保证日期连续。
2. **JBIS 改版**：div 结构变化 → 解析/校验失败。对策：校验器显式报警；可选“原始 HTML 归档”用于重解析（§8.3）；改版后修正解析器并**回放历史归档**重建快照。
3. **年度/世代滚动（v1.8）**：**所有类型统一按"板 = 类型 × 年份"分板**（`<typeId>@<year>`，快照目录即年份）——①②③ 为集計年度（yearly，`node src/collect.js <y1>` 可回采收官）；④⑤ 为**出生年**（generation，y2=y3=出生年，采集窗口为最近 `SITE.genWindow` 个世代，随年自动滑动；JBIS 端 y1 不生效故无法回采历史年度状态）。UI 年份切换器统一显示（世代別标"出生年"），默认最新年份，跨年/跨世代天然断开。
4. **世代追加**：2024 年生世代开始时，追加 `t6-gen-central-2024` / `t7-gen-overall-2024`（同样式配置，5 行代码）。
5. **回填限制**：过去年度无“当日历史”，只能回填最终累计值（`final:true` 标注），不可重建日变化（§2.4）。
6. **时区与采集时刻**：快照 = 采集时刻的 JBIS 状态；`capturedAt` 保证可审计。若 JBIS 更新时刻变动，调整 cron 即可（同日重跑幂等）。
7. **访问礼节**：1 次/日、间隔 ≥1s、注明 UA——远低于 JBIS 正常访问量；请遵守其服务条款。
8. **Pages 大小**：§4.6 估算年增 ~70MB，安全；若长期运行超 1GB，可归档旧年数据到独立仓库。

---

## 9. 扩展路线

- **更多榜单**：ファーストシーズンサイアー（`ranking=3`）、ブルードメアサイアー（`ranking=5`）、障害/ダート细分（`racetype1/2` 变体）——只需新增类型配置。
- **站点功能**：日/周/月/年期间切换的变化高亮、种马历史曲线、赏金增量视图、Top-N 变化榜单、导出 CSV。
- **原始 HTML 归档**（可选）：每日把抓到的 HTML 压缩后提交到**私有仓库**（不进 Pages），应对 JBIS 改版重解析；体积翻倍但只存一份。
- **本地分析库**：CI 或本地 `node scripts/import-sqlite.js` 把 JSON 灌入 SQLite，便于 SQL 分析（发布物仍是文件）。

---

## 10. 站点图表方案（本地 Chart 插件）

### 10.1 选型结论

**首选：Apache ECharts 5.6.1**（Apache-2.0，可自由本地自托管）。

- **已下载到本仓库** `site/vendor/echarts.min.js`（约 1.0 MB，文件头含 Apache License 声明），站点零 CDN、完全离线可用。
- 中文文档完善（对中文用户友好）；单文件引入 `<script src="vendor/echarts.min.js"></script>` 即可。
- 排名场景能力齐全：折线/面积/柱状/热力、`yAxis.inverse: true`（第 1 名在顶部）、tooltip、legend、dataZoom（时间范围缩放）、markLine。

备选（若更在意体积/性能）：

| 库 | License | 体积(gzip) | 说明 |
|---|---|---|---|
| Chart.js 4.x | MIT | ~70 KB | 轻量，`scale.reverse: true` 可画排名轴；交互较弱 |
| uPlot | MIT | ~40 KB | 极快极轻，适合大时间序列，但样式/提示需自建 |
| Lightweight-charts | Apache-2.0 | ~45 KB | 时间序列+十字光标专业，风格偏金融 |

> 参考：<https://echarts.apache.org/en/download.html> · <https://www.chartjs.org/> · <https://github.com/leeoniya/uPlot> · <https://github.com/tradingview/lightweight-charts>

### 10.2 图表配方（数据来自 §4.5 / §6.3）

1. **排名曲线（Bump Chart）——主图**：x = 日期，y = 排名，`yAxis.inverse: true`（第 1 名在顶部）；每匹种马一条线（默认最新榜 Top-10，可切换）；tooltip 显示 当日排名 / 赏金 / 与所选期间的 delta；dataZoom 支持时间范围缩放。
2. **Top-20 柱状图**（页面实际采用）：横向条形（种马名 × 奖金额），榜单总览。
3. **单匹种马详情**：面积图 = 赏金累计随时间；叠加排名曲线。
4. **排名热力表（可选）**：行 = 种马，列 = 日期，色阶 = 排名（ECharts heatmap）。

### 10.3 数据接入

- 站点从 `derived/{type}/latest.json` 拿最新榜与变化，从 `data/` 快照或 `derived/sire-history/` 拿历史序列（§4.5）。
- 期间（日/周/月/年）是 UI 参数：站点端对比两个快照计算 delta（§7.3 推荐方案），再交给 ECharts 渲染。
- 排名曲线：默认 Top-3 + コントレイル，点击明细行增减（上限 12）；x 轴按 期间 粒度分桶（每桶取最晚快照，latest.json 带 `dates`）；y 轴按可见系列最大名次动态缩放（10/20/30/…/100+，图例开合联动）。

### 10.4 视觉方向（已实现，v2 简约清爽版）

- **风格**：简约清爽低彩——**纯白背景**（背景与卡片同色，仅靠 1px 细线分隔）+ **单一强调色**，层级靠字重与留白；不使用大面积色块。
- **默认主题**：`mint 薄荷`（青绿 `#2f9e93` 强调，纯白底）；另备 `mist 雾蓝 / ink 墨线 / sand 暖沙` 三套，URL 参数 `?theme=` 可切换（四套背景均为纯白）。
- **布局**：白色顶栏（文字标识）→ 下划线文字标签 → 轻量 No.1 条（大号强调色数字 + 行内统计）→ 双图 → 细线明细表（前三名序号用强调色）。
- **图表**：柱状图仅第 1 名用强调色、其余灰阶；折线图用 12 色低饱和多色板 + 异形标记（圆/方/三角/菱…）区分系列；`prefers-reduced-motion` 下关闭动画。
- 字体：全站系统字体栈（Segoe UI / 微软雅黑 / Hiragino Kaku Gothic），数据列 `tabular-nums`，不引入外部字体文件。

---

## 11. 本地预览（端口 9090）

已实现（`src/`、`site/`）：

```bash
npm run collect   # 抓取 5 类榜单当日快照 → data/
npm run build     # 生成 _site/（复制 site/ + data/，并生成 derived/ 派生数据）
npm run serve     # 本地静态服务，默认端口 9090，并自动打开浏览器
npm start         # collect + build + serve 一条龙
```

- 服务根目录为 `_site/`，地址 `http://127.0.0.1:9090/`；端口在 `src/config.js` 的 `SITE.port` 配置（默认 9090，占用时自动顺延）。
- 页面为纯静态（ECharts 本地 `site/vendor/echarts.min.js`），`fetch` 读取 `data/` 与 `derived/` 下的 JSON，无任何构建框架依赖。
- GitHub Pages 部署时上传 `_site/` 即可（`site/` 即 Pages 发布根）。

---

## 附录 A：实测快照样本（真实数据，2026-10-10）

年度別・中央（`ranking=1&y1=2026&kind=1&division=2&racetype1=1&racetype2=1`）前 3 行：

| 順位 | 種牡馬 | ID | 出走(回/頭) | 勝利(回/頭) | 重賞勝(回/頭) | AEI(全般/重賞) | 賞金(全般/重賞,万円) | 代表産駒 |
|---|---|---|---|---|---|---|---|---|
| 1 | キズナ | 0001120570 | 974 / 279 | 118 / 93 | 8 / 8 | 1.84 / 1.27 | 303982.9 / 111006.2 | シックスペンス (0001340113) |
| 2 | ロードカナロア | 0001089850 | 870 / 239 | 80 / 71 | 6 / 6 | 1.92 / 1.74 | 271709.1 / 108080.3 | ワールズエンド (0001336773) |
| 3 | キタサンブラック | 0001155349 | 683 / 224 | 80 / 64 | 8 / 7 | 1.99 / … | … | … |

世代別・中央 2023年生（`ranking=4&y1=2026&y2=2023&y3=2023&division=2`）前 2 行：キズナ 560/105/83/56/4/4、AEI 2.08 / `-`（null）、139638.9/48814.0、代表産駒 パントルナイーフ；エピファネイア 530/107/73/58/3/3、AEI 1.75 / `-`、120197.0/30072.6、代表産駒 マテンロウゲイル。

2歳・中央（`ranking=2&y1=2026&division=2`）前 2 行：エフフォーリア (0001266977) 78/48/14/13/0/0、AEI 1.72/0.00、19316.8/0.0、代表産駒 スタースポット；シスキン(USA) (0001330729) 36/21/11/8/1/1、AEI 3.42/3.79、16765.4/4840.5、代表産駒 ジーティーマイカ。

## 附录 B：参考 URL 一览（2026-10-10 验证）

- 年度別・中央：`https://www.jbis.or.jp/ranking/result/?ranking=1&y1=2026&kind=1&division=2&racetype1=1&racetype2=1&items=100` → 438 件
- 年度別・総合：同上但 `division=1` → 614 件
- 2歳・中央：`?ranking=2&y1=2026&kind=1&division=2&racetype1=1&racetype2=1&items=100` → 215 件
- 世代別・中央（2023年生）：`?ranking=4&y1=2026&y2=2023&y3=2023&kind=1&division=2&racetype1=1&racetype2=1&items=100` → 285 件
- 世代別・総合（2023年生）：同上但 `division=1` → 325 件
