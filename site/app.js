// 種牡馬ランキング 展示（Apache ECharts 本地自托管）
// 简约清爽版：4 套低彩主题（?theme=mint|mist|ink|sand），默认 mint 薄荷
const $ = (s) => document.querySelector(s);
const MB_PAGE = 30; // MB 端明细分页：默认 30 条，「查看更多」每次增量 +30 追加（PC 保持「展开全部」现状）
const state = { type: null, year: null, index: null, latest: null, period: "daily", expanded: false, limit: 50, mbShown: MB_PAGE, mbPrev: 0, chartTab: "bar" };
const TYPE_ORDER = ["t1-2yo-central", "t2-annual-central", "t3-annual-overall", "t4-gen-central", "t5-gen-overall"];
// 一级导航分组（仅 MB 启用三层导航）：L1 类别 → L2 区分（中央/総合）→ L3 年度；
// PC 恢复平铺 5 板完整名 tab（无 L2）。2歳 只有中央，无 L2
const GROUPS = [
  { id: "2yo", labelMb: "中央 サラ系 2歳", boards: ["t1-2yo-central"] },
  { id: "annual", labelMb: "年度別サイアー サラ系", boards: ["t2-annual-central", "t3-annual-overall"] },
  { id: "generation", labelMb: "世代別サイアー サラ系", boards: ["t4-gen-central", "t5-gen-overall"] },
];
const groupOf = (id) => GROUPS.find((g) => g.boards.includes(id));
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
// 大额万円 → 万/亿 复合单位（1亿 = 10,000万円）：45,425.2万 → 4.54亿；8,066万 → 8,066万；806.6万 → 806.6万
function fmtManOku(v) {
  if (v == null || Number.isNaN(v)) return "—";
  if (Math.abs(v) >= 10000) return parseFloat((v / 10000).toFixed(2)) + "亿";
  return fmt(v, Math.abs(v) >= 100 ? 0 : 1) + "万";
}
function chart(id) {
  if (!charts[id]) charts[id] = echarts.init($("#" + id));
  return charts[id];
}
// 窄屏（<720px）：柱图收窄名头与右留白，多留画布给柱子 —— 设备判定唯一来源 = device.js（与 CSS 同源）
const isNarrow = () => JB.device.isMb();
function resizeAll() {
  for (const k in charts) charts[k].resize();
}
// 跨断点翻转：用已缓存数据重渲染，覆盖「桌面宽度先渲染出 PC 表格，再切到手机」的场景；
// 曲线不重建（x 轴/数据与设备无关，尺寸由 resize 兜底），resize 事件只负责 ECharts 尺寸
JB.device.onChange(() => {
  if (!state.latest) return;
  state.expanded = false;
  state.mbShown = MB_PAGE;
  state.mbPrev = 0;
  renderTabs(); // 导航形态随设备重建（PC 平铺 / MB 三层）
  renderDivSwitch(groupOf(state.type));
  renderHint();
  renderBar(); // 跨断点重设柱图 grid
  renderTable();
  applyChartTab(); // PC 双图并排 / MB 单面板 tab
});
window.addEventListener("resize", resizeAll);

// MB 双图 tab：PC 端 tabs 隐藏、双面板并排；MB 端单面板显示，靠 tab 切换
function applyChartTab() {
  const mb = JB.device.isMb();
  $("#chart-tabs").hidden = !mb;
  $("#panel-bar").hidden = mb && state.chartTab !== "bar";
  $("#panel-line").hidden = mb && state.chartTab !== "line";
  document.querySelectorAll("#chart-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.c === state.chartTab));
  // 被切换出来的面板从 0 尺寸恢复，下一帧补一次 resize
  requestAnimationFrame(() => {
    const id = state.chartTab === "bar" ? "chart-bar" : "chart-line";
    if (charts[id]) charts[id].resize();
  });
}

async function main() {
  const index = await json("derived/index.json");
  state.index = index;
  const ids = index.types.filter((t) => TYPE_ORDER.includes(t.id)).map((t) => t.id);
  renderTabs();
  const defType = ids.includes(qsType)
    ? qsType
    : ids.includes("t2-annual-central")
      ? "t2-annual-central"
      : ids[0];
  renderHint();
  applyChartTab();
  await selectType(defType, qsYear);
}

// L1 导航按设备分治：PC = 平铺 5 板完整名（原样）；MB = 3 组短名 tab
function renderTabs() {
  const tabs = $("#type-tabs");
  tabs.innerHTML = "";
  const types = state.index.types.filter((t) => TYPE_ORDER.includes(t.id));
  if (JB.device.isMb()) {
    const avail = new Set(types.map((t) => t.id));
    for (const g of GROUPS.filter((g) => g.boards.some((b) => avail.has(b)))) {
      const b = document.createElement("button");
      b.textContent = g.labelMb;
      b.dataset.group = g.id;
      b.onclick = () => selectGroup(g.id);
      tabs.appendChild(b);
    }
  } else {
    for (const t of types) {
      const b = document.createElement("button");
      b.textContent = t.name;
      b.dataset.id = t.id;
      b.onclick = () => selectType(t.id);
      tabs.appendChild(b);
    }
  }
  syncTabsOn();
}

function syncTabsOn() {
  const mb = JB.device.isMb();
  const g = groupOf(state.type);
  document.querySelectorAll("#type-tabs button").forEach((b) =>
    b.classList.toggle("on", mb ? b.dataset.group === g?.id : b.dataset.id === state.type)
  );
}

// L1（仅 MB 三层导航生效）：切换类别——保持区内当前选择，否则优先中央、兜底第一个可用板
function selectGroup(gid) {
  if (groupOf(state.type)?.id === gid) return;
  const g = GROUPS.find((x) => x.id === gid);
  const avail = g.boards.filter((b) => state.index.types.some((t) => t.id === b));
  const next = avail.includes(state.type)
    ? state.type
    : avail.find((b) => b.includes("central")) || avail[0];
  selectType(next, state.year); // selectType 内部会回退到该板最新年度
}

async function selectType(id, year) {
  const t = state.index.types.find((x) => x.id === id);
  state.type = id;
  syncTabsOn();
  renderDivSwitch(groupOf(id));
  // 统一"板 = 类型 × 年度"：默认展示最新年份；cohort（世代別）仅影响能否回采历史年度
  state.year = t.years.length ? (t.years.includes(year) ? year : t.years[0]) : null;
  // 深链双向同步：切换榜单/年度即回写 URL（replaceState 不留历史），刷新/分享保持当前视图；theme 参数原样保留
  const usp = new URLSearchParams(location.search);
  usp.set("type", id);
  state.year ? usp.set("year", state.year) : usp.delete("year");
  const qs = usp.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  renderYearSwitch(t);
  const boardId = state.year ? `${id}@${state.year}` : id;
  state.latest = await json(`derived/${boardId}/latest.json`);
  // 曲线默认系列：当前 Top-3 + 固定種牡馬（コントレイル，如在本榜中）
  const def = state.latest.rows.slice(0, 3).map((r) => r.sire.id);
  if (state.latest.rows.some((r) => r.sire.id === FIXED_SIRE.id)) def.push(FIXED_SIRE.id);
  state.curve = new Set(def);
  state.expanded = false; // 切换榜单后明细回到设备默认条数
  state.mbShown = MB_PAGE;
  state.mbPrev = 0;
  renderMeta();
  renderHint(); // 副题随榜单变化（固定种牡马是否收录）
  renderHero();
  renderBar();
  renderTable();
  animateDetailSwap(); // 榜单/年度切换时明细同样给过渡
  await renderLine();
}

function renderMeta() {
  const L = state.latest;
  $("#meta").textContent = `${L.year ? L.year + " 年 · " : ""}${L.date} 更新 ｜ 全 ${L.total} 頭`;
  $("#detail-range").textContent = `全 ${L.rows.length} 頭`;
  const aeiTh = $("#th-aei");
  aeiTh.textContent = hasAeiGraded(L) ? "AEI 全/重" : "AEI";
  aeiTh.title = hasAeiGraded(L)
    ? "AEI（アーニングインデックス）：産駒の獲得収入指数，全般 / 重賞"
    : "AEI（アーニングインデックス）：産駒の獲得収入指数（世代別榜 JBIS 不提供重賞 AEI）";
}

// 曲线操作提示：一行讲清核心交互（MB「卡片」/ PC「行」），细节靠界面自解释
function renderHint() {
  $("#curve-hint").textContent = JB.device.isMb()
    ? "点击下方明细卡片，可把该种牡马加入/移出曲线（上限 12）。"
    : "点击明细行可加入/移出曲线（上限 12）；y 轴随已选名次自动缩放。";
}

// 本榜是否提供 AEI・重賞：世代別板 JBIS 官方即无此列（aeiGraded 恒 null，见 docs/DESIGN.md），
// 此时 AEI 只显示全般一个值，表头与 hero 标签同步去掉「全般/重」字样
const hasAeiGraded = (L) => L.rows.some((r) => r.aeiGraded != null);

// L2：区分切换器（中央/総合）——仅 MB 三层导航显示；PC 平铺导航下隐藏，组内仅 1 个可用板时也隐藏（2歳）
function renderDivSwitch(g) {
  const nav = $("#div-switch");
  const avail = g ? g.boards.filter((b) => state.index.types.some((t) => t.id === b)) : [];
  if (!JB.device.isMb() || avail.length < 2) {
    nav.classList.remove("show");
    nav.innerHTML = "";
    return;
  }
  nav.classList.add("show");
  nav.innerHTML = avail
    .map((b) => `<button data-b="${b}" class="${b === state.type ? "on" : ""}">${b.includes("overall") ? "総合" : "中央"}</button>`)
    .join("");
  nav.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => selectType(btn.dataset.b, state.year);
  });
}

// L3：年度切换器（所有类型统一显示，默认最新年份）
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
    { label: hasAeiGraded(L) ? "AEI 全般" : "AEI", value: fmt(r.aeiOverall, 2), unit: "" },
  ];
  $("#hero-stats").innerHTML = stats
    .map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}${s.unit ? `<small>${esc(s.unit)}</small>` : ""}</dd></div>`)
    .join("");
}

function renderBar() {
  const L = state.latest;
  const top = L.rows.slice(0, isNarrow() ? 10 : 20); // MB 只展示 Top-10：柱数减半，名头与画布更从容
  $("#bar-sub").textContent = `Top-${top.length} · 万円 · 突出色＝重賞`;
  const narrow = isNarrow();
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
        const gap = gapToPrev(L, r);
        return `${esc(r.sire.name)}（#${r.rank}）<br/>賞金全般：${fmt(r.prizeOverall, 1)} 万円<br/>賞金重賞：${fmt(r.prizeGraded, 1)} 万円<br/>${gap != null ? `距上一名：${fmtManOku(gap)}円<br/>` : ""}勝利：${fmt(r.wins)} / ${fmt(r.winners)} 頭<br/>重賞：${fmt(r.gradedWins)} / ${fmt(r.gradedWinners)} 頭`;
      },
    },
    grid: { left: narrow ? 112 : 156, right: narrow ? 52 : 56, top: 10, bottom: 30 },
    xAxis: {
      type: "value",
      name: "万円",
      splitNumber: narrow ? 4 : 5, // 窄屏少画几档刻度，避免挤成一团
      nameTextStyle: { color: T.muted, fontSize: 10 },
      axisLabel: { color: T.muted, fontSize: narrow ? 9 : 10 },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: T.split } },
    },
    yAxis: {
      type: "category",
      data: top.map((r) => r.sire.name),
      inverse: true,
      axisLabel: { fontSize: 11.5, color: T.ink, fontFamily: FONT_BODY, width: narrow ? 100 : 148, overflow: "truncate" },
      axisLine: { lineStyle: { color: T.axis } },
      axisTick: { show: false },
    },
    series: [
      {
        name: "賞金重賞",
        type: "bar",
        stack: "prize",
        data: top.map((r) => r.prizeGraded ?? 0),
        barMaxWidth: 15,
        itemStyle: { color: T.accent },
      },
      {
        name: "重賞以外",
        type: "bar",
        stack: "prize",
        data: top.map((r) => Math.max(0, (r.prizeOverall ?? 0) - (r.prizeGraded ?? 0))),
        barMaxWidth: 15,
        itemStyle: { borderRadius: [0, 2, 2, 0], color: T.bar },
        label: {
          show: true,
          position: "right",
          fontSize: 10,
          color: T.muted,
          formatter: (p) => fmt(top[p.dataIndex].prizeOverall, narrow ? 0 : 1), // 柱端标注 = 賞金全般总额（窄屏省略小数）
        },
      },
    ],
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
      // 不设轴名：inverse 轴的 name 会沉到底部与 x 轴首标签重叠；「順位」含义由面板标题与 tooltip 自明
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

// 明细渲染双路径（渲染层分治）：同一份数据，PC = 11 列表格 / MB = 两行式卡片，两容器互斥
function renderTable() {
  const L = state.latest;
  const mb = JB.device.isMb();
  $("#rank-table").hidden = mb;
  $("#rank-cards").hidden = !mb;
  if (mb) renderCards(L, false);
  else renderTablePc(L);
  renderMore();
}

// 距上一名赏金差：直接按名次取上一行（L.rows 按順位排序）；第 1 名/缺数据返回 null（显示「先頭/—」）
function gapToPrev(L, r) {
  const prev = L.rows[r.rank - 2];
  if (!prev || prev.prizeOverall == null || r.prizeOverall == null) return null;
  return prev.prizeOverall - r.prizeOverall;
}

// PC 路径：表格（现状保留）
function renderTablePc(L) {
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
    const aeiCell = hasAeiGraded(L)
      ? `${fmt(r.aeiOverall, 2)} / ${fmt(r.aeiGraded, 2)}`
      : fmt(r.aeiOverall, 2);
    const gap = gapToPrev(L, r);
    tr.innerHTML = `
      <td class="rank">${r.rank}</td>
      <td class="name">${sireLink}</td>
      <td class="num c-rankdelta ${deltaCls(ch)}" title="${deltaTitle(ch)}">${deltaTxt(ch)}</td>
      <td class="num">${fmt(r.starts)} / ${fmt(r.runners)}</td>
      <td class="num">${fmt(r.wins)} / ${fmt(r.winners)}</td>
      <td class="num">${fmt(r.gradedWins)} / ${fmt(r.gradedWinners)}</td>
      <td class="num">${aeiCell}</td>
      <td class="num">${fmt(r.prizeOverall, 1)}</td>
      <td class="num gap" title="${gap != null ? `距上一名 ${fmtManOku(gap)}円` : "ランキング先頭"}">${gap != null ? fmtManOku(gap) : "先頭"}</td>
      <td class="num">${fmt(r.prizeGraded, 1)}</td>
      <td class="num c-prizedelta" title="${prizeDeltaTitle(ch)}">${prizeDeltaTxt(ch)}</td>
      <td class="name">${rep}</td>`;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

// MB 卡片：两行式 —— 行1 = 順位 + Δ順位徽章 + 马名 + 賞金全般（主数值）；
// 行2 = 勝利/重賞 次级指标 + 代表産駒。字段与 PC 行共用同一组映射（deltaCls/deltaTxt/fmt），口径不走样
function mbCardHTML(r) {
  const L = state.latest;
  const ch = r.change?.[state.period];
  const gap = gapToPrev(L, r);
  const sireLink = r.sire.id
    ? `<a class="sire-link" href="${jbisUrl(r.sire.id)}" target="_blank" rel="noopener">${esc(r.sire.name)}</a>`
    : esc(r.sire.name);
  const rep = r.repProgeny
    ? r.repProgeny.id
      ? `<a class="sire-link" href="${jbisUrl(r.repProgeny.id)}" target="_blank" rel="noopener">${esc(r.repProgeny.name)}</a>`
      : esc(r.repProgeny.name)
    : "—";
  return `
    <div class="mb-card${r.rank <= 3 ? " top3" : ""}${state.curve.has(r.sire.id) ? " picked" : ""}" data-sire="${r.sire.id || ""}">
      <div class="mb-row1">
        <span class="mb-rank">${r.rank}</span>
        <span class="mb-delta ${deltaCls(ch)}" title="${deltaTitle(ch)}">${deltaTxt(ch)}</span>
        <span class="mb-name">${sireLink}</span>
        <span class="mb-prize-col">
          <span class="mb-prize">${fmt(r.prizeOverall, 0)}<small>万円</small></span>
          <span class="mb-gap">${gap != null ? `差 ${fmtManOku(gap)}` : "先頭"}</span>
        </span>
      </div>
      <div class="mb-row2">
        <span class="mb-stat">勝利 ${fmt(r.wins)}/${fmt(r.winners)}</span>
        <span class="mb-stat">重賞 ${fmt(r.gradedWins)}/${fmt(r.gradedWinners)}</span>
        <span class="mb-rep">代表産駒：${rep}</span>
      </div>
    </div>`;
}

// MB 路径：卡片列表。append=true 时只追加新增区间（「查看更多」增量 +30，不整表重建）
function renderCards(L, append) {
  const wrap = $("#rank-cards");
  const shown = Math.min(state.mbShown, L.rows.length);
  if (append) {
    if (shown > state.mbPrev) {
      wrap.insertAdjacentHTML("beforeend", L.rows.slice(state.mbPrev, shown).map(mbCardHTML).join(""));
    }
  } else {
    wrap.innerHTML = L.rows.slice(0, shown).map(mbCardHTML).join("");
  }
  state.mbPrev = shown;
}

// 明细底部：查看更多 / 收起（PC 默认前 50 + 展开全部；MB 默认 30 + 增量 +30）
function renderMore() {
  const L = state.latest;
  const el = $("#table-more");
  const mb = JB.device.isMb();
  const shown = mb ? Math.min(state.mbShown, L.rows.length) : (state.expanded ? L.rows.length : state.limit);
  if (shown >= L.rows.length) {
    const collapsible = mb ? L.rows.length > MB_PAGE : state.expanded;
    el.innerHTML = collapsible ? `<button id="btn-collapse">收起（显示前 ${mb ? MB_PAGE : state.limit} 名）</button>` : "";
    return;
  }
  el.innerHTML = mb
    ? `<button id="btn-expand">更多（${shown}/${L.rows.length}）</button>`
    : `<button id="btn-expand">展开全部（共 ${L.rows.length} 名）</button>`;
}

// 点击明细行（链接除外）→ 增减曲线系列
function toggleCurve(id) {
  if (!id) return;
  if (state.curve.has(id)) state.curve.delete(id);
  else {
    if (state.curve.size >= CURVE_MAX) return; // 上限保护
    state.curve.add(id);
  }
  document.querySelectorAll("#rank-table tbody tr, #rank-cards .mb-card").forEach((el) =>
    el.classList.toggle("picked", state.curve.has(el.dataset.sire))
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
// Δ 悬停/触摸解释（PC td 与 MB 卡片共用，title 供 hover/长按/读屏）
function deltaTitle(ch) {
  if (!ch || ch.delta == null) return "上一快照无数据，暂无对比";
  if (ch.delta === 0) return "与上一快照持平";
  return ch.delta < 0 ? `较上一快照上升 ${-ch.delta} 位` : `较上一快照下降 ${ch.delta} 位`;
}
function prizeDeltaTitle(ch) {
  if (!ch || ch.prizeDelta == null) return "上一快照无数据，暂无对比";
  if (ch.prizeDelta === 0) return "与上一快照持平";
  return `较上一快照${ch.prizeDelta > 0 ? "增加" : "减少"} ${fmt(Math.abs(ch.prizeDelta), 1)} 万円`;
}

// 明细切换动效：行级联入场（stagger）—— 每行/卡依次滑入，节奏递进；
// renderTable 已重建 DOM，新节点直接赋 delay 即可，无需 reflow 重触发。
// 只对前 14 行逐行递进，之后统一延迟入场（500 行逐个延时会拖沓）；reduced-motion 直接跳过。
function animateDetailSwap() {
  if (REDUCE_MOTION) return;
  const els = JB.device.isMb()
    ? Array.from($("#rank-cards").children)
    : Array.from($("#rank-table tbody").children);
  els.forEach((el, i) => {
    el.style.animationDelay = Math.min(i * 26, 340) + "ms";
    el.classList.add("row-in");
  });
}

// 期間开关滑动指示条：绝对定位条随选中按钮平移（offsetLeft 相对 .period-switch）
const psEl = $("#period-switch");
const psInd = document.createElement("span");
psInd.className = "ps-indicator";
psEl.appendChild(psInd);
function movePsIndicator(animate = true) {
  const on = psEl.querySelector("button.on");
  if (!on) return;
  if (!animate) psInd.style.transition = "none"; // 首次定位不播滑动，避免加载时从原点飞过去
  psInd.style.width = on.offsetWidth + "px";
  psInd.style.transform = `translateX(${on.offsetLeft}px)`;
  if (!animate) requestAnimationFrame(() => (psInd.style.transition = ""));
}
movePsIndicator(false);
window.addEventListener("resize", movePsIndicator);

document.querySelectorAll("#period-switch button").forEach((b) => {
  b.onclick = () => {
    state.period = b.dataset.p;
    document.querySelectorAll("#period-switch button").forEach((x) => x.classList.toggle("on", x === b));
    movePsIndicator();
    renderTable();
    animateDetailSwap();
    renderLine(); // x 轴粒度跟随期间
  };
});

document.querySelector("#rank-table tbody").addEventListener("click", (e) => {
  if (e.target.closest("a")) return; // 点名字/代表産駒 → 跳转 JBIS
  const tr = e.target.closest("tr[data-sire]");
  if (tr) toggleCurve(tr.dataset.sire);
});

// MB 卡片同语义：点卡片主体加/减曲线，点链接（名字/代表産駒）跳 JBIS 不冒泡
$("#rank-cards").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const card = e.target.closest(".mb-card[data-sire]");
  if (card && card.dataset.sire) toggleCurve(card.dataset.sire);
});

$("#table-more").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const L = state.latest;
  const wrap = document.querySelector(".table-wrap");
  if (JB.device.isMb()) {
    if (b.id === "btn-expand") {
      state.mbShown = Math.min(state.mbShown + MB_PAGE, L.rows.length);
      renderCards(L, true); // 增量追加，不整表重建
      renderMore();
    } else {
      state.mbShown = MB_PAGE;
      state.mbPrev = 0;
      renderCards(L, false);
      renderMore();
      wrap.scrollTop = 0;
    }
  } else {
    state.expanded = b.id === "btn-expand";
    renderTable();
    if (!state.expanded) wrap.scrollTop = 0;
  }
});

$("#chart-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.dataset.c === state.chartTab) return;
  state.chartTab = b.dataset.c;
  applyChartTab();
});

main().catch((e) => {
  $("#meta").textContent = "加载失败：" + e.message;
  console.error(e);
});
