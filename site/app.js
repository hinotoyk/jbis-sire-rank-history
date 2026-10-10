// 種牡馬ランキング 展示（Apache ECharts 本地自托管）
// 简约清爽版：4 套低彩主题（?theme=mint|mist|ink|sand），默认 mint 薄荷
const $ = (s) => document.querySelector(s);
const state = { type: null, year: null, index: null, latest: null, period: "daily", expanded: false, limit: 50 };
const TYPE_ORDER = ["t1-2yo-central", "t2-annual-central", "t3-annual-overall", "t4-gen-central", "t5-gen-overall"];
const charts = {};
const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FONT_BODY = '"Segoe UI", "Microsoft YaHei", "Hiragino Kaku Gothic ProN", system-ui, sans-serif';

// 每主题的图表用色（强调色 + 灰阶）；排名曲线用统一多色板 CURVE_PALETTE 保证区分度
const THEMES = {
  mist: {
    accent: "#4a7dbd", bar: "#cdd8e4", bar2: "#a9bccf",
    ink: "#1f2937", muted: "#8b95a3", split: "#eef2f7", axis: "#dfe6ee",
    tipBg: "#ffffff", tipLine: "#dfe6ee",
  },
  mint: {
    accent: "#2f9e93", bar: "#cde4e0", bar2: "#9fccc5",
    ink: "#1e2a28", muted: "#8aa09b", split: "#eef6f4", axis: "#dcebe8",
    tipBg: "#ffffff", tipLine: "#dcebe8",
  },
  ink: {
    accent: "#141414", bar: "#d6d6d6", bar2: "#a8a8a8",
    ink: "#141414", muted: "#9a9a9a", split: "#f0f0f0", axis: "#e3e3e3",
    tipBg: "#ffffff", tipLine: "#e3e3e3",
  },
  sand: {
    accent: "#a9834f", bar: "#e0d6c4", bar2: "#c9b694",
    ink: "#2b2620", muted: "#a09585", split: "#f5f0e7", axis: "#ece5d8",
    tipBg: "#ffffff", tipLine: "#ece5d8",
  },
};
const themeKey = (() => {
  const t = new URLSearchParams(location.search).get("theme");
  return THEMES[t] ? t : "mint";
})();
document.documentElement.dataset.theme = themeKey;
const T = THEMES[themeKey];

// 排名曲线：固定展示コントレイル + 当前 Top-3，点击明细行增减
const FIXED_SIRE = { id: "0001237042", name: "コントレイル" };
const CURVE_MAX = 12;
const jbisUrl = (id) => `https://www.jbis.or.jp/horse/${id}/`;

// 深链：?type=...&year=...（theme 见上）
const qsType = new URLSearchParams(location.search).get("type");
const qsYear = (() => { const y = new URLSearchParams(location.search).get("year"); return y ? parseInt(y, 10) : null; })();

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r.json();
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(v, d = 0) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toLocaleString("en-US", { maximumFractionDigits: d });
}
function chart(id) {
  if (!charts[id]) charts[id] = echarts.init($("#" + id));
  return charts[id];
}
function resizeAll() {
  for (const k in charts) charts[k].resize();
}
window.addEventListener("resize", resizeAll);

async function main() {
  const index = await json("derived/index.json");
  state.index = index;
  const types = index.types.filter((t) => TYPE_ORDER.includes(t.id));
  const tabs = $("#type-tabs");
  for (const t of types) {
    const b = document.createElement("button");
    b.textContent = t.name;
    b.dataset.id = t.id;
    b.onclick = () => selectType(t.id);
    tabs.appendChild(b);
  }
  const ids = types.map((t) => t.id);
  const defType = ids.includes(qsType)
    ? qsType
    : ids.includes("t2-annual-central")
      ? "t2-annual-central"
      : ids[0];
  await selectType(defType, qsYear);
}

async function selectType(id, year) {
  const t = state.index.types.find((x) => x.id === id);
  state.type = id;
  document.querySelectorAll("#type-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  // 统一"板 = 类型 × 年度"：默认展示最新年份；cohort（世代別）仅影响能否回采历史年度
  state.year = t.years.length ? (t.years.includes(year) ? year : t.years[0]) : null;
  renderYearSwitch(t);
  const boardId = state.year ? `${id}@${state.year}` : id;
  state.latest = await json(`derived/${boardId}/latest.json`);
  // 曲线默认系列：当前 Top-3 + 固定種牡馬（コントレイル，如在本榜中）
  const def = state.latest.rows.slice(0, 3).map((r) => r.sire.id);
  if (state.latest.rows.some((r) => r.sire.id === FIXED_SIRE.id)) def.push(FIXED_SIRE.id);
  state.curve = new Set(def);
  state.expanded = false; // 切换榜单后明细回到前 50
  renderMeta();
  renderHero();
  renderBar();
  renderTable();
  await renderLine();
}

function renderMeta() {
  const L = state.latest;
  $("#meta").textContent = `${L.year ? L.year + " 年 · " : ""}数据日期 ${L.date} ｜ 全量 ${L.total}`;
  $("#detail-range").textContent = `1–${L.rows.length}`;
}

// 年度切换器（所有类型统一显示，默认最新年份）
function renderYearSwitch(t) {
  const nav = $("#year-switch");
  if (!t.years.length) {
    nav.classList.remove("show");
    nav.innerHTML = "";
    return;
  }
  nav.classList.add("show");
  const label = t.board === "generation" ? "出生年" : "年度";
  nav.innerHTML =
    `<span class="ys-label">${label}</span>` +
    t.years.map((y) => `<button data-y="${y}" class="${y === state.year ? "on" : ""}">${y}</button>`).join("");
  nav.querySelectorAll("button").forEach((b) => {
    b.onclick = () => selectType(t.id, parseInt(b.dataset.y, 10));
  });
}

// 轻量 No.1 条
function renderHero() {
  const L = state.latest;
  const r = L.rows[0];
  if (!r) {
    $("#hero-no").textContent = "—";
    $("#hero-name").textContent = "本榜暂无数据";
    $("#hero-sub").textContent = `${L.jp}${L.year ? `（${L.year}）` : ""}`;
    $("#hero-stats").innerHTML = "";
    return;
  }
  $("#hero-no").textContent = r.rank;
  $("#hero-name").innerHTML = `<a class="sire-link" href="${jbisUrl(r.sire.id)}" target="_blank" rel="noopener">${esc(r.sire.name)}</a>`;
  $("#hero-sub").textContent = `${L.jp}${L.year ? `（${L.year}）` : ""} · ${L.date}`;
  const stats = [
    { label: "賞金全般", value: fmt(r.prizeOverall, 1), unit: "万円" },
    { label: "賞金重賞", value: fmt(r.prizeGraded, 1), unit: "万円" },
    { label: "出走 回/頭", value: `${fmt(r.starts)} / ${fmt(r.runners)}`, unit: "" },
    { label: "勝利 回/頭", value: `${fmt(r.wins)} / ${fmt(r.winners)}`, unit: "" },
    { label: "重賞 回/頭", value: `${fmt(r.gradedWins)} / ${fmt(r.gradedWinners)}`, unit: "" },
    { label: "AEI 全般", value: fmt(r.aeiOverall, 2), unit: "" },
  ];
  $("#hero-stats").innerHTML = stats
    .map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}${s.unit ? `<small>${esc(s.unit)}</small>` : ""}</dd></div>`)
    .join("");
}

function renderBar() {
  const L = state.latest;
  const top = L.rows.slice(0, 20);
  chart("chart-bar").setOption({
    animation: !REDUCE_MOTION,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: T.tipBg,
      borderColor: T.tipLine,
      textStyle: { color: T.ink, fontSize: 12 },
      formatter: (ps) => {
        const r = top[ps[0].dataIndex];
        return `${esc(r.sire.name)}（#${r.rank}）<br/>賞金全般：${fmt(r.prizeOverall, 1)} 万円<br/>賞金重賞：${fmt(r.prizeGraded, 1)} 万円<br/>勝利：${fmt(r.wins)} / ${fmt(r.winners)} 頭<br/>重賞：${fmt(r.gradedWins)} / ${fmt(r.gradedWinners)} 頭`;
      },
    },
    grid: { left: 156, right: 56, top: 10, bottom: 30 },
    xAxis: {
      type: "value",
      name: "万円",
      nameTextStyle: { color: T.muted, fontSize: 10 },
      axisLabel: { color: T.muted, fontSize: 10 },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: T.split } },
    },
    yAxis: {
      type: "category",
      data: top.map((r) => r.sire.name),
      inverse: true,
      axisLabel: { fontSize: 11.5, color: T.ink, fontFamily: FONT_BODY, width: 148, overflow: "truncate" },
      axisLine: { lineStyle: { color: T.axis } },
      axisTick: { show: false },
    },
    series: [{
      type: "bar",
      data: top.map((r) => r.prizeOverall ?? 0),
      barMaxWidth: 15,
      itemStyle: {
        borderRadius: [0, 2, 2, 0],
        color: (p) => (p.dataIndex === 0 ? T.accent : p.dataIndex < 3 ? T.bar2 : T.bar),
      },
      label: { show: true, position: "right", fontSize: 10, color: T.muted, formatter: (p) => fmt(p.value, 1) },
    }],
  }, true);
}

// ---- 排名曲线：x 轴随 期间 粒度分桶，y 轴按可见名次动态缩放，多色板 + 异形标记区分 ----
const CURVE_PALETTE = ["#2f9e93", "#5b7fc4", "#c98a4a", "#9a6fb8", "#c96a7e", "#6fa054", "#b8544f", "#5a9bb0", "#a08050", "#7e7ec4", "#c4b04a", "#4aa5a0"];
const CURVE_SYMBOLS = ["circle", "rect", "triangle", "diamond", "roundRect", "pin"];
const Y_CANDIDATES = [10, 20, 30, 40, 50, 100, 150, 200, 300, 500, 1000];

function yAxisFor(maxRank) {
  const yMax = Y_CANDIDATES.find((c) => c >= maxRank) || Math.ceil((maxRank * 1.2) / 100) * 100;
  return { max: yMax, interval: yMax / 10 };
}

// 快照日期按 期间 粒度分桶（升序遍历，每桶保留最晚一个快照）
function bucketDates(dates, period) {
  if (period === "daily") return dates.map((d) => ({ key: d, label: d, date: d }));
  const map = new Map();
  for (const d of dates) {
    const dt = new Date(d + "T00:00:00Z");
    let key, label;
    if (period === "weekly") {
      const day = (dt.getUTCDay() + 6) % 7; // 周一=0
      const thu = new Date(dt);
      thu.setUTCDate(dt.getUTCDate() - day + 3);
      const yStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
      const week = 1 + Math.round((thu - yStart) / 604800000);
      key = `${thu.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
      label = `${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    } else if (period === "monthly") {
      key = d.slice(0, 7);
      label = d.slice(0, 7);
    } else {
      key = d.slice(0, 4);
      label = d.slice(0, 4);
    }
    map.set(key, { key, label, date: d });
  }
  return [...map.values()];
}

function maxRankOf(meta, sel) {
  let m = 0;
  for (const name in meta) {
    if (sel && sel[name] === false) continue;
    for (const v of meta[name]) if (v != null && v > m) m = v;
  }
  return m;
}

async function renderLine() {
  const L = state.latest;
  const allDates = L.dates?.length ? L.dates : [L.date];
  const buckets = bucketDates(allDates, state.period);
  const selected = [...state.curve].map((id) => L.rows.find((r) => r.sire.id === id)).filter(Boolean);
  const histories = [];
  for (const r of selected) {
    try { histories.push(await json(`derived/sire-history/${L.board}/${r.sire.id}.json`)); }
    catch { /* 无历史则跳过 */ }
  }
  const series = histories.map((h, i) => {
    const vals = buckets.map((b) => {
      const p = h.history.find((x) => x.date === b.date);
      return p ? p.rank : null;
    });
    return { name: h.sire.name, vals, symbol: CURVE_SYMBOLS[i % CURVE_SYMBOLS.length] };
  });
  state.lineMeta = Object.fromEntries(series.map((s) => [s.name, s.vals]));

  const c = chart("chart-line");
  c.off("legendselectchanged");
  c.on("legendselectchanged", () => {
    const sel = c.getOption()?.legend?.[0]?.selected || {};
    c.setOption({ yAxis: yAxisFor(maxRankOf(state.lineMeta || {}, sel)) });
  });
  c.setOption({
    animation: !REDUCE_MOTION,
    color: CURVE_PALETTE,
    tooltip: {
      trigger: "axis",
      backgroundColor: T.tipBg,
      borderColor: T.tipLine,
      textStyle: { color: T.ink, fontSize: 12 },
      formatter: (ps) => {
        const rows = ps
          .map((p) => `${p.marker}${esc(p.seriesName)}：${p.value == null ? "—" : "第 " + p.value + " 名"}`)
          .join("<br/>");
        return `${ps[0]?.axisValue || ""}<br/>${rows}`;
      },
    },
    legend: { type: "scroll", top: 0, textStyle: { fontSize: 11, color: T.ink }, pageIconColor: T.accent, pageTextStyle: { color: T.muted } },
    grid: { left: 44, right: 24, top: 34, bottom: 36 },
    xAxis: {
      type: "category",
      data: buckets.map((b) => b.label),
      boundaryGap: false,
      axisLabel: { color: T.muted, fontSize: 10 },
      axisLine: { lineStyle: { color: T.axis } },
    },
    yAxis: {
      type: "value",
      inverse: true,
      min: 1,
      name: "順位",
      nameTextStyle: { color: T.muted, fontSize: 10 },
      axisLabel: { color: T.muted, fontSize: 10 },
      splitLine: { lineStyle: { color: T.split } },
      ...yAxisFor(maxRankOf(state.lineMeta, null)),
    },
    series: series.map((s) => ({
      name: s.name,
      type: "line",
      data: s.vals,
      connectNulls: false,
      symbol: s.symbol,
      symbolSize: 7,
      lineStyle: { width: 2.5 },
    })),
  }, true);
}

function renderTable() {
  const L = state.latest;
  const tbody = $("#rank-table tbody");
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  const rows = state.expanded ? L.rows : L.rows.slice(0, state.limit);
  for (const r of rows) {
    const ch = r.change?.[state.period];
    const tr = document.createElement("tr");
    tr.dataset.sire = r.sire.id;
    if (r.rank <= 3) tr.classList.add("top3");
    if (state.curve.has(r.sire.id)) tr.classList.add("picked");
    const sireLink = r.sire.id
      ? `<a class="sire-link" href="${jbisUrl(r.sire.id)}" target="_blank" rel="noopener">${esc(r.sire.name)}</a>`
      : esc(r.sire.name);
    const rep = r.repProgeny
      ? r.repProgeny.id
        ? `<a class="sire-link" href="${jbisUrl(r.repProgeny.id)}" target="_blank" rel="noopener">${esc(r.repProgeny.name)}</a>`
        : esc(r.repProgeny.name)
      : "—";
    tr.title = "点击加入/移出排名曲线";
    tr.innerHTML = `
      <td class="rank">${r.rank}</td>
      <td class="name">${sireLink}</td>
      <td class="num ${deltaCls(ch)}">${deltaTxt(ch)}</td>
      <td class="num">${fmt(r.starts)} / ${fmt(r.runners)}</td>
      <td class="num">${fmt(r.wins)} / ${fmt(r.winners)}</td>
      <td class="num">${fmt(r.gradedWins)} / ${fmt(r.gradedWinners)}</td>
      <td class="num">${fmt(r.aeiOverall, 2)} / ${fmt(r.aeiGraded, 2)}</td>
      <td class="num">${fmt(r.prizeOverall, 1)}</td>
      <td class="num">${fmt(r.prizeGraded, 1)}</td>
      <td class="num">${prizeDeltaTxt(ch)}</td>
      <td class="name">${rep}</td>`;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  renderMore();
}

// 明细底部：查看更多 / 收起（默认仅前 50 行）
function renderMore() {
  const L = state.latest;
  const el = $("#table-more");
  if (!L || L.rows.length <= state.limit) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = state.expanded
    ? `<button id="btn-collapse">收起 · 仅显示前 ${state.limit} 名</button>`
    : `<button id="btn-expand">查看更多 · 完整展示（共 ${L.rows.length} 名）</button>`;
}

// 点击明细行（链接除外）→ 增减曲线系列
function toggleCurve(id) {
  if (!id) return;
  if (state.curve.has(id)) state.curve.delete(id);
  else {
    if (state.curve.size >= CURVE_MAX) return; // 上限保护
    state.curve.add(id);
  }
  document.querySelectorAll("#rank-table tbody tr").forEach((tr) =>
    tr.classList.toggle("picked", state.curve.has(tr.dataset.sire))
  );
  renderLine();
}

function deltaCls(ch) {
  if (!ch || ch.delta == null) return "delta-na";
  if (ch.delta === 0) return "delta-flat";
  return ch.delta < 0 ? "delta-up" : "delta-down";
}
function deltaTxt(ch) {
  if (!ch || ch.delta == null) return "—";
  if (ch.delta === 0) return "＝";
  return ch.delta < 0 ? `▲${-ch.delta}` : `▼${ch.delta}`;
}
function prizeDeltaTxt(ch) {
  if (!ch || ch.prizeDelta == null) return "—";
  return (ch.prizeDelta > 0 ? "+" : "") + fmt(ch.prizeDelta, 1);
}

document.querySelectorAll("#period-switch button").forEach((b) => {
  b.onclick = () => {
    state.period = b.dataset.p;
    document.querySelectorAll("#period-switch button").forEach((x) => x.classList.toggle("on", x === b));
    renderTable();
    renderLine(); // x 轴粒度跟随期间
  };
});

document.querySelector("#rank-table tbody").addEventListener("click", (e) => {
  if (e.target.closest("a")) return; // 点名字/代表産駒 → 跳转 JBIS
  const tr = e.target.closest("tr[data-sire]");
  if (tr) toggleCurve(tr.dataset.sire);
});

$("#table-more").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.expanded = b.id === "btn-expand";
  renderTable();
  const wrap = document.querySelector(".table-wrap");
  if (!state.expanded) wrap.scrollTop = 0;
});

main().catch((e) => {
  $("#meta").textContent = "加载失败：" + e.message;
  console.error(e);
});
