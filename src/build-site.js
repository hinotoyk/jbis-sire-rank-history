// 站点构建：复制 site/ 与 data/ 到 _site/，按"板（board）"生成派生数据
// 板 = 类型 × 集計年度（board:"yearly"，如 t2-annual-central@2026）或 世代连续板（board:"cohort"，如 t4-gen-central-2023）
import fs from "node:fs";
import path from "node:path";
import { TYPES, PERIODS } from "./config.js";

const DATA_DIR = path.resolve("data");
const SITE_DIR = path.resolve("site");
const OUT_DIR = path.resolve("_site");

function listDates(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}

function loadSnapshot(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// 从若干"日期文件直存"目录加载快照（yearly 板 = 单个 y1 目录；cohort 板 = 跨年多目录合并）
function loadSnapshotsFrom(dirs) {
  const snaps = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const d of listDates(dir)) snaps.push(loadSnapshot(path.join(dir, `${d}.json`)));
  }
  return snaps.sort((a, b) => a.date.localeCompare(b.date));
}

// 期间分桶键（docs/DESIGN.md §7.1）：周=ISO 周（键取该周周四所在年份+周号），月=YYYY-MM，年=YYYY
function bucketKey(dateStr, period) {
  if (period === "daily") return dateStr;
  if (period === "weekly") {
    const dt = new Date(dateStr + "T00:00:00Z");
    const day = (dt.getUTCDay() + 6) % 7; // 周一=0
    const thu = new Date(dt);
    thu.setUTCDate(dt.getUTCDate() - day + 3);
    const week =
      1 + Math.round((thu - new Date(Date.UTC(thu.getUTCFullYear(), 0, 1))) / 604800000);
    return `${thu.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  if (period === "monthly") return dateStr.slice(0, 7);
  return dateStr.slice(0, 4);
}

// 期间基准：上一桶内最新的快照（周对周、月对月、年末对年末；上一桶无快照则无对比）
function refDateOf(allDates, period, curDate) {
  const keys = [...new Set(allDates.map((d) => bucketKey(d, period)))].sort();
  const idx = keys.indexOf(bucketKey(curDate, period));
  if (idx <= 0) return null;
  const prevKey = keys[idx - 1];
  for (let i = allDates.length - 1; i >= 0; i--) {
    if (bucketKey(allDates[i], period) === prevKey) return allDates[i];
  }
  return null;
}

// ---- 复制静态资源 ----
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.cpSync(SITE_DIR, OUT_DIR, { recursive: true });
fs.cpSync(DATA_DIR, path.join(OUT_DIR, "data"), { recursive: true });

const derivedRoot = path.join(OUT_DIR, "derived");
fs.mkdirSync(path.join(derivedRoot, "sire-history"), { recursive: true });

// ---- 枚举板：所有类型统一按"类型 × 集計年度"分板（快照目录即年度） ----
const boards = [];
for (const t of TYPES) {
  const typeDir = path.join(DATA_DIR, t.id);
  if (!fs.existsSync(typeDir)) continue;
  const years = fs.readdirSync(typeDir).filter((n) => /^\d{4}$/.test(n)).sort();
  for (const y of years) boards.push({ t, y1: y, boardId: `${t.id}@${y}`, dirs: [path.join(typeDir, y)] });
}

for (const b of boards) {
  const snapshots = loadSnapshotsFrom(b.dirs);
  if (!snapshots.length) continue;

  const latest = snapshots[snapshots.length - 1];
  const allDates = snapshots.map((s) => s.date);

  // 各期间 delta（§7.1）：基准 = 上一同粒度周期桶内最新快照（板内对比，跨年不连接）
  const change = {};
  for (const pname of Object.keys(PERIODS)) {
    const ref = refDateOf(allDates, pname, latest.date);
    const prev = ref ? snapshots.find((s) => s.date === ref) : null;
    const prevRank = new Map((prev?.rows || []).map((r) => [r.sire.id, r.rank]));
    const prevRow = new Map((prev?.rows || []).map((r) => [r.sire.id, r]));
    change[pname] = {
      refDate: ref,
      bySire: Object.fromEntries(
        latest.rows.map((r) => {
          const pr = prevRank.get(r.sire.id);
          const prw = prevRow.get(r.sire.id);
          return [
            r.sire.id,
            {
              prevRank: pr ?? null,
              rank: r.rank,
              delta: pr == null ? null : r.rank - pr,
              prevPrize: prw?.prizeOverall ?? null,
              prizeDelta: prw == null ? null : r.prizeOverall - prw.prizeOverall,
            },
          ];
        })
      ),
    };
  }

  // latest.json
  const latestOut = {
    schema: "jbis.sire.rank.latest/v1",
    type: b.t.id,
    board: b.boardId,
    boardMode: b.t.board,
    year: b.y1 ? parseInt(b.y1, 10) : null,
    name: b.t.name,
    jp: b.t.jp,
    date: latest.date,
    total: latest.total,
    dates: allDates, // 全部快照日期（曲线 x 轴分桶用）
    generatedAt: new Date().toISOString(),
    rows: latest.rows.map((r) => ({
      rank: r.rank,
      sire: r.sire,
      starts: r.starts, runners: r.runners,
      wins: r.wins, winners: r.winners,
      gradedWins: r.gradedWins, gradedWinners: r.gradedWinners,
      aeiOverall: r.aeiOverall, aeiGraded: r.aeiGraded,
      prizeOverall: r.prizeOverall, prizeGraded: r.prizeGraded,
      repProgeny: r.repProgeny,
      change: Object.fromEntries(
        Object.entries(change).map(([p, c]) => [p, c.bySire[r.sire.id]])
      ),
    })),
  };
  const tdir = path.join(derivedRoot, b.boardId);
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, "latest.json"), JSON.stringify(latestOut));

  // sire-history（全量种马：曲线支持点击任意行加入）
  const hdir = path.join(derivedRoot, "sire-history", b.boardId);
  fs.mkdirSync(hdir, { recursive: true });
  for (const r of latest.rows) {
    const history = snapshots.map((s) => {
      const row = s.rows.find((x) => x.sire.id === r.sire.id);
      return {
        date: s.date,
        rank: row ? row.rank : null,
        prizeOverall: row ? row.prizeOverall : null,
      };
    });
    fs.writeFileSync(
      path.join(hdir, `${r.sire.id}.json`),
      JSON.stringify({ sire: r.sire, history })
    );
  }
  console.log(`[build] ${b.boardId}: date=${latest.date} rows=${latest.rows.length}`);
}

// ---- 板索引（UI 的 tabs / 年份切换依据） ----
const index = {
  schema: "jbis.sire.rank.index/v1",
  generatedAt: new Date().toISOString(),
  types: TYPES.map((t) => {
    const ys = boards
      .filter((b) => b.t.id === t.id && b.y1)
      .map((b) => parseInt(b.y1, 10))
      .sort((a, b2) => b2 - a);
    return { id: t.id, name: t.name, jp: t.jp, board: t.board, years: ys };
  }),
};
fs.writeFileSync(path.join(derivedRoot, "index.json"), JSON.stringify(index));

console.log("site built ->", OUT_DIR);
