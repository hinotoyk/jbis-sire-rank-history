// 5 种排名类型的公共查询参数与运行配置（docs/DESIGN.md §3、§5.1）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 本地预览的端口/根目录单源 = 项目根 serve.config.json（docs/DESIGN.md §11）。
// 四兄弟站约定：yunji-web 9090 / kzn-web 9091 / 本站 9092 / racing-calendar 9093。
// 勿在此写死端口——占号冲突/自动顺延会让宿主站（云迹 stats.html）的跨站引用静默失配。
export const SERVE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../serve.config.json", import.meta.url)), "utf8"),
);
export const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url)); // 仓库根（serve.config.json 所在）

export const BASE = {
  kind: 1,          // サラ系
  racetype1: 1,     // 馬場：総合
  racetype2: 1,     // 競走種別：総合
  condition: 1,     // 馬場状態：総合
  sort: "ranking",  // 順位順
  order: "A",       // 昇順（rank 1 在前）
  items: 100,       // 每页 100 条，翻页取全量（docs/DESIGN.md §5.2）
};

export const TYPES = [
  {
    id: "t1-2yo-central",
    name: "中央 サラ系 2歳",
    jp: "2歳（中央・サラ系）",
    query: { ranking: 2, division: 2 },
    board: "yearly", // 板 = 类型 × 集計年度，跨年天然断开（docs/DESIGN.md §8.3）
    year: "current",
    season: { startMonth: 6, endMonth: 12 }, // 2歳 榜单窗口：每年约 6 月～12 月
    startDate: "2026-01-01",
  },
  {
    id: "t2-annual-central",
    name: "中央 年度別サイアー サラ系",
    jp: "年度別サイアー（中央・サラ系）",
    query: { ranking: 1, division: 2 },
    board: "yearly",
    year: "current", // 自动滚动到当前自然年；上一年用 `node src/collect.js <y1>` 收官补采
    startDate: "2026-01-01",
  },
  {
    id: "t3-annual-overall",
    name: "総合 年度別サイアー サラ系",
    jp: "年度別サイアー（総合・サラ系）",
    query: { ranking: 1, division: 1 },
    board: "yearly",
    year: "current",
    startDate: "2026-01-01",
  },
  {
    id: "t4-gen-central",
    name: "中央 世代別サイアー サラ系",
    jp: "世代別サイアー（中央・サラ系）",
    query: { ranking: 4, division: 2 },
    board: "generation", // 板 = 类型 × 出生年（y2=y3=出生年）；JBIS 端 y1 不生效（实测两年返回一致）
    startDate: "2026-01-01",
  },
  {
    id: "t5-gen-overall",
    name: "総合 世代別サイアー サラ系",
    jp: "世代別サイアー（総合・サラ系）",
    query: { ranking: 4, division: 1 },
    board: "generation",
    startDate: "2026-01-01",
  },
];

// 变化对比期间（docs/DESIGN.md §7.1）：
// Δ 基准 = 「上一个同粒度周期桶内最新的快照」——周对周、月对月、年末对年末；
// 上一桶无快照（如上线前的月份）该期间 Δ 为 null。曲线 x 轴分桶与此口径一致（桶内取最晚快照）。
export const PERIODS = {
  daily: { label: "日" },
  weekly: { label: "周" },
  monthly: { label: "月" },
  yearly: { label: "年" },
};

// 运行参数
export const SITE = {
  port: SERVE.port, // 本地预览端口（单源 = serve.config.json；docs/DESIGN.md §11）
  curveMax: 12,     // 排名曲线最多同时展示的种马数
  fixedCurveSire: { id: "0001237042", name: "コントレイル" }, // 曲线固定展示（用户指定）
  genWindow: 2,     // 世代別采集最近 N 个出生年（如 2026 年 → 2024/2023，即 2/3 歳世代；随年自动滑动）
};
