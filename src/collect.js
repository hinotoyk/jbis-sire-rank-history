// 每日采集主流程：抓取 → 解析 → 校验 → 写快照（docs/DESIGN.md §5）
import fs from "node:fs";
import path from "node:path";
import { TYPES, SITE } from "./config.js";
import { fetchHtml, buildUrl } from "./lib/fetch.js";
import { parseRows } from "./lib/parse.js";
import { validate } from "./lib/validate.js";

const DATA_DIR = path.resolve("data");
const DELAY_MS = 1200; // 礼貌抓取间隔

const JST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
});

function jstParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((x) => x.type === t).value;
  const capturedAt = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+09:00`;
  // 业务日期：快照归属最近一个已完赛的比赛日。
  // JST 18:00 前采集 → 归前一天（等价于取 now-18h 的 JST 日期），
  // 这样 GitHub 定时任务即使延迟数小时、甚至跨过零点执行，日期标签也不会漂移到次日。
  const date = JST_DATE.format(new Date(now.getTime() - 18 * 60 * 60 * 1000));
  return { date, capturedAt };
}

function resolveYear(type, now) {
  if (type.year === "current") return parseInt(now.date.slice(0, 4), 10);
  return type.year;
}

function inSeason(type, now) {
  if (!type.season) return true;
  const month = parseInt(now.date.slice(5, 7), 10);
  return month >= type.season.startMonth && month <= type.season.endMonth;
}

function parseQuery(url) {
  const u = new URL(url);
  const o = {};
  for (const [k, v] of u.searchParams) o[k] = /^\d+$/.test(v) ? Number(v) : v;
  return o;
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "manifest.json"), "utf8"));
  } catch {
    return { schema: "jbis.sire.rank.manifest/v1", updatedAt: null, types: {}, snapshots: {} };
  }
}

const now = jstParts();
const manifest = loadManifest();
// `node src/collect.js <y1>`：一次性补采历史集計年度（仅 yearly 板；generation 板无法回采历史状态）
const backfillY1 = process.argv[2] ? parseInt(process.argv[2], 10) : null;
if (backfillY1) console.log(`[backfill] 历史年度补采 y1=${backfillY1}（仅 yearly 板）`);

for (const t of TYPES) {
  manifest.types[t.id] = { name: t.name, jp: t.jp, startDate: t.startDate };

  // 采集目标板：yearly → [集計年度]；generation → 最近 N 个出生年（2/3/4 歳世代，由新到旧）
  let targets;
  if (backfillY1) {
    if (t.board !== "yearly") {
      console.log(`[skip] ${t.id}: generation 板无法回采历史年度状态`);
      continue;
    }
    targets = [backfillY1]; // 补采历史年度，不受 season 窗口限制
  } else if (t.board === "generation") {
    const cur = parseInt(now.date.slice(0, 4), 10);
    targets = [];
    for (let g = cur - 2; targets.length < SITE.genWindow; g--) targets.push(g);
  } else {
    if (!inSeason(t, now)) {
      console.log(`[skip] ${t.id}: 不在采集窗口（season=${JSON.stringify(t.season)}）`);
      continue;
    }
    targets = [resolveYear(t, now)];
  }

  for (const y1 of targets) {
    // generation 板：y2=y3=出生年（JBIS 端 y1 不生效，仍随查询发送）
    const q =
      t.board === "generation" ? { ...t, query: { ...t.query, y2: y1, y3: y1 } } : t;
    try {
      // 全量翻页抓取（items=100，docs/DESIGN.md §5.2）
      const firstHtml = await fetchHtml(buildUrl(q, y1, 1));
      const first = parseRows(firstHtml);
      const total = first.total;
      let rows = first.rows;
      let pages = 1;
      while (rows.length < total && pages < 40) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
        const part = parseRows(await fetchHtml(buildUrl(q, y1, pages + 1)));
        if (!part.rows.length) break; // 空页保护
        rows = rows.concat(part.rows);
        pages++;
      }
      const snapshot = {
        schema: "jbis.sire.rank.snapshot/v1",
        type: t.id,
        date: now.date,
        capturedAt: now.capturedAt,
        query: parseQuery(buildUrl(q, y1, 1)),
        total,
        pages,
        status: rows.length ? "ok" : "empty",
        rows,
      };
      const errors = validate(snapshot, rows);
      if (errors.length) {
        snapshot.status = "error";
        snapshot.errors = errors;
        console.error(`[warn] ${t.id}: ${errors.join("; ")}`);
      }

      const dir = path.join(DATA_DIR, t.id, String(y1));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${now.date}.json`);

      // 幂等：剔除 capturedAt 后与现有一致则跳过写（同日重跑不产生噪音）
      const key = JSON.stringify({ total, rows });
      if (fs.existsSync(file)) {
        try {
          const prev = JSON.parse(fs.readFileSync(file, "utf8"));
          if (JSON.stringify({ total: prev.total, rows: prev.rows }) === key) {
            console.log(`[same] ${t.id}@${y1} ${now.date} rows=${rows.length} total=${total}`);
            manifest.snapshots[now.date] = manifest.snapshots[now.date] || {};
            manifest.snapshots[now.date][`${t.id}@${y1}`] = snapshot.status;
            continue;
          }
        } catch { /* 文件损坏则重写 */ }
      }

      fs.writeFileSync(file, JSON.stringify(snapshot));
      manifest.snapshots[now.date] = manifest.snapshots[now.date] || {};
      manifest.snapshots[now.date][`${t.id}@${y1}`] = snapshot.status;
      console.log(`[ok]   ${t.id}@${y1} ${now.date} rows=${rows.length} total=${total} pages=${pages}`);
    } catch (e) {
      console.error(`[err]  ${t.id}@${y1}: ${e.message}`);
      manifest.snapshots[now.date] = manifest.snapshots[now.date] || {};
      manifest.snapshots[now.date][`${t.id}@${y1}`] = "error";
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

manifest.updatedAt = now.capturedAt;
fs.writeFileSync(path.join(DATA_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("manifest updated ->", path.join(DATA_DIR, "manifest.json"));
