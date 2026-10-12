// 每日采集主流程：抓取 → 解析 → 校验 → 写快照（docs/DESIGN.md §5）
import fs from "node:fs";
import path from "node:path";
import { TYPES, SITE } from "./config.js";
import { fetchHtml, buildUrl } from "./lib/fetch.js";
import { parseRows } from "./lib/parse.js";
import { validate } from "./lib/validate.js";

const DATA_DIR = path.resolve("data");
const DELAY_MS = 1200; // 礼貌抓取间隔
const RETRY_MAX = 5; // 每天最多重试 5 次（工作流每日运行一次，当日全局共享预算）
const RETRY_BASE_MS = 30_000; // 重试间隔逐次翻倍：30s→60s→120s→240s→480s
let retryBudget = RETRY_MAX;

// 仅针对失败的请求重试：同一 URL 失败后等待并重取，间隔逐次翻倍，耗尽当日预算后按原逻辑隔离失败板块
async function fetchWithRetry(url) {
  for (;;) {
    try {
      return await fetchHtml(url);
    } catch (e) {
      if (retryBudget <= 0) throw e;
      const n = RETRY_MAX - retryBudget + 1;
      const wait = RETRY_BASE_MS * 2 ** (n - 1);
      retryBudget--;
      console.log(`[retry] 请求失败，${Math.round(wait / 1000)}s 后重试（当日第 ${n}/${RETRY_MAX} 次）: ${url}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function jstParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((x) => x.type === t).value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // 快照标注采集当天（JST）日期。每日北京 10:00（JST 11:00）晨间执行，
  // 调度延迟需超过 13 小时才会跨过 JST 零点导致标签漂移，常规延迟不会发生。
  return { date, capturedAt: `${date}T${get("hour")}:${get("minute")}:${get("second")}+09:00` };
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
      const firstHtml = await fetchWithRetry(buildUrl(q, y1, 1));
      const first = parseRows(firstHtml);
      const total = first.total;
      let rows = first.rows;
      let pages = 1;
      while (rows.length < total && pages < 40) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
        const part = parseRows(await fetchWithRetry(buildUrl(q, y1, pages + 1)));
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
