/* ============================================================
 * sire-rank-chart.js —— JBIS 種牡馬ランキング 嵌入式图表组件（零依赖 · 纯渲染）
 * ------------------------------------------------------------
 * 定位（2026-10-27 与云迹定稿）：本仓库对外发布的「图表组件」，供兄弟站
 *   （云迹 yunji-web 等）一行挂载。数据获取/缓存归宿主站（YJ.cache 等），
 *   本组件只画图——不 fetch、不写任何存储键。
 *
 * 数据契约 = derived/sire-history/<board>/<sireId>.json：
 *   { "sire": {"id":"0001237042","name":"コントレイル"},
 *     "history": [{"date":"2026-10-10","rank":3,"prizeOverall":111727.2}, ...] }
 *   prizeOverall 单位 = 万円；rank / prizeOverall 可为 null（当日跌出榜/缺测）。
 *
 * 用法：
 *   <div id="chart"></div>
 *   <script src="embed/sire-rank-chart.js"></script>
 *   JBIS_RANK_EMBED.render(el, data, opts);
 *
 * opts（全部可选）：
 *   style    "step-area" | "step" | "bar" | "smooth-area" | "combo"
 *          | "triple" | "delta" | "bump"
 *            阶梯面积（默认）/ 纯阶梯 / 累计柱 / 平滑面积 / 平滑累计+增量柱（共用y轴）/
 *            双面板（累计+增量柱独立刻度）/ 纯增量视图 / 名次主角
 *   annotate true = 主图跳增日标注「+金额（名次）」（平滑/阶梯类风格生效；快照 >45 日自动关闭）
 *   colors   {prize, rank, grid, tick, halo}  线/网格/刻度色；缺省依次取宿主
 *                                             CSS 变量 --primary/--chart-2（回退 --accent）与内置中性灰
 *   labels   {prize, rank, delta, empty}      tooltip/面板文案（宿主按自己语言传）
 *   heights  {main, delta}                    主图/增量面板高（px，默认 180/70；v1.3.0 起无副图）
 *   yTicks   目标刻度格数（默认 9：步长按 1/2/2.5/5×10^k 取整；
 *            如 1.87億 板 → 每 2,000万 一格，13.8億 板 → 每 2億 一格）
 *   font     字体栈字符串                      缺省继承宿主（SVG text 不设 font-family）
 *
 * 图形语义：赏金为累计值、只在赛果后跳增——阶梯（step-after）是默认画法；
 *   "smooth-area" 更好看但会在快照间插值，属视觉取舍（跳增标注补齐信息）；
 *   "triple"/"delta" 的增量柱用独立刻度，千万级日增变化不被累计大尺度压扁。
 * 名次不再单独成图（v1.3.0 用户定稿：副图太丑）：跳增标注内嵌「（N位）」+ tooltip 提供名次，
 *   "bump" 仍可名次为主图。
 * x 轴 = 快照序号等距（非日期等距）：缺日不留洞，诚实表达「逐日快照序列」。
 * ============================================================ */
(function () {
  "use strict";

  var VERSION = "1.3.1";
  var STYLES = ["step-area", "step", "bar", "smooth-area", "combo", "triple", "delta", "bump"];
  var seq = 0; /* 渐变 id 自增：同页多实例不串 */

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* 万円数值 → 千分位（保留 1 位小数）："138237.8" → "138,237.8" */
  function fmtWan(v) {
    if (v == null || isNaN(v)) return "—";
    var neg = v < 0, s = Math.abs(v).toFixed(1), parts = s.split(".");
    var ip = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + ip + "." + parts[1];
  }
  /* 轴刻度短格式：0 → "0"；≥1億 显示 "2億"/"1.5億"/"1.25億"（最多 2 位小数），
   * 否则整数千分位 "2,000万"（刻度无小数尾巴） */
  function fmtAxisWan(v) {
    if (v === 0) return "0";
    if (v >= 10000) return Math.round(v / 10000 * 100) / 100 + "億";
    return Math.round(v).toLocaleString("en-US") + "万";
  }
  function fmtMD(dateStr) { /* "2026-10-26" → "10/26" */
    var p = String(dateStr || "").split("-");
    return p.length === 3 ? parseInt(p[1], 10) + "/" + p[2] : String(dateStr);
  }
  /* 优雅刻度：在 1/2/2.5/5×10^k 阶梯里选 |格数-target| 最小的步长（同分取更细）。
   * 返回 {max, step, iv}：max = step×iv ≥ peak，保证最高格盖住数据顶。 */
  function niceScale(peak, target) {
    target = target || 9;
    if (!(peak > 0)) return { max: 1, step: 1, iv: 1 };
    var LADDER = [1, 2, 2.5, 5, 10], best = null;
    for (var e = 0; e <= 7; e++) {
      var pow = Math.pow(10, e);
      for (var li = 0; li < LADDER.length; li++) {
        var step = LADDER[li] * pow;
        var iv = Math.ceil(peak / step - 1e-9);
        if (iv < 2) continue;
        var score = Math.abs(iv - target);
        if (!best || score < best.score || (score === best.score && step < best.step)) {
          best = { step: step, iv: iv, score: score };
        }
      }
    }
    return { max: best.step * best.iv, step: best.step, iv: best.iv };
  }
  /* 单调三次样条（Fritsch–Carlson，d3 curveMonotoneX 同族）：平滑但不过冲，
   * 平段不鼓包、跳增处不回勾——比 Catmull-Rom 诚实。xs/ys 均为有限值。 */
  function monotonePath(xs, ys) {
    var n = xs.length;
    if (n === 1) return "M" + xs[0].toFixed(1) + " " + ys[0].toFixed(1);
    var dx = [], dy = [], s = [], m = [];
    for (var i = 0; i < n - 1; i++) {
      dx[i] = xs[i + 1] - xs[i]; dy[i] = ys[i + 1] - ys[i]; s[i] = dy[i] / dx[i];
    }
    m[0] = s[0]; m[n - 1] = s[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (s[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / s[i], b = m[i + 1] / s[i], sq = a * a + b * b;
      if (sq > 9) { var t = 3 / Math.sqrt(sq); m[i] = t * a * s[i]; m[i + 1] = t * b * s[i]; }
    }
    var d = "M" + xs[0].toFixed(1) + " " + ys[0].toFixed(1);
    for (i = 0; i < n - 1; i++) {
      d += " C" + (xs[i] + dx[i] / 3).toFixed(1) + " " + (ys[i] + m[i] * dx[i] / 3).toFixed(1) +
        " " + (xs[i + 1] - dx[i] / 3).toFixed(1) + " " + (ys[i + 1] - m[i + 1] * dx[i] / 3).toFixed(1) +
        " " + xs[i + 1].toFixed(1) + " " + ys[i + 1].toFixed(1);
    }
    return d;
  }
  /* 增量序列：delta[i] = prize[i] - prize[i-1]（i=0 无前值 → null） */
  function deltasOf(pts) {
    var arr = [];
    for (var i = 0; i < pts.length; i++) {
      arr.push(i > 0 && pts[i].prize != null && pts[i - 1].prize != null ? pts[i].prize - pts[i - 1].prize : null);
    }
    return arr;
  }

  /* ---------- 纯函数：SVG 构建（Node 可测；opts 需已解析好颜色/文案） ----------
   * 返回 { svg, W, H, geo }；geo 供 render() 做十字线与 tooltip 定位。 */
  function buildSVG(data, o, W) {
    W = Math.max(300, Math.round(W || 640));
    var his = (data && data.history) || [];
    var n = his.length;
    var labels = o.labels || {};
    var C = o.colors, HH = o.heights;
    var style = STYLES.indexOf(o.style) >= 0 ? o.style : "step-area";
    var slotMode = style === "bar" || style === "combo" || style === "delta";
    var isBump = style === "bump";
    var isTriple = style === "triple";

    /* 空态：宿主容器内一行提示（纯函数也输出，保持两路一致） */
    if (!n) {
      var eh = (HH.main || 180) + (isTriple ? (HH.delta || 70) : 0) + 40;
      return { svg: "", W: W, H: eh, geo: null, empty: esc(labels.empty || "暂无数据"), emptyH: eh };
    }

    /* 准备序列：赏金空值沿用前值（累计口径），名次空值断线 */
    var pts = [], lastPrize = null, rmax = 2;
    for (var i = 0; i < n; i++) {
      var d = his[i];
      if (d.prizeOverall != null && !isNaN(d.prizeOverall)) lastPrize = d.prizeOverall;
      pts.push({ date: d.date, prize: lastPrize, rank: d.rank == null ? null : d.rank });
      if (d.rank != null && d.rank > rmax) rmax = d.rank;
    }
    var rBot = rmax + (rmax <= 5 ? 1 : 2);   /* 名次轴下缘留余量：不拿最差名次当轴起点贴边 */
    var deltas = deltasOf(pts);
    var maxDelta = 0;
    for (i = 0; i < n; i++) if (deltas[i] != null && deltas[i] > maxDelta) maxDelta = deltas[i];

    /* ---- 布局：主图（+ triple 增量面板）；v1.3.0 起无名次副图 ---- */
    var padL = 46, padR = 14, top = 8;
    var mainH = HH.main || 180, deltaH = isTriple ? (HH.delta || 70) : 0;
    var mainTop = top;
    var deltaTop = mainTop + mainH + 24;
    var xH = 18;
    var H = mainTop + mainH + (isTriple ? deltaH + 24 : 0) + xH;
    var plotW = W - padL - padR;
    var slot = plotW / n;
    var x = slotMode
      ? function (i) { return padL + (i + 0.5) * slot; }
      : function (i) { return n === 1 ? padL + plotW / 2 : padL + i * plotW / (n - 1); };
    var baseY = mainTop + mainH;

    /* ---- 主图 y 刻度：bump = 名次（1 位在顶，下缘留余量），其余 = 赏金 niceScale ---- */
    var scMain, yMain;
    if (isBump) {
      yMain = function (r) { return rBot <= 1 ? mainTop + mainH / 2 : mainTop + ((r - 1) / (rBot - 1)) * mainH; };
    } else if (style === "delta") {
      scMain = niceScale(maxDelta, o.yTicks);
      yMain = function (v) { return baseY - (v / scMain.max) * mainH; };
    } else {
      scMain = niceScale(Math.max.apply(null, pts.map(function (p) { return p.prize || 0; })), o.yTicks);
      yMain = function (v) { return baseY - (v / scMain.max) * mainH; };
    }
    var scDelta = niceScale(maxDelta, 3);           /* triple 增量面板：独立刻度（千万级不被压扁） */
    var yDelta = function (v) { return deltaTop + deltaH - (v / scDelta.max) * deltaH; };

    var s = [];
    var gradId = "jbre-g" + (++seq);
    var needGrad = style === "step-area" || style === "smooth-area" || style === "triple" || style === "combo";
    if (needGrad) {
      s.push('<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="' + C.prize + '" stop-opacity="0.11"/>' +
        '<stop offset="1" stop-color="' + C.prize + '" stop-opacity="0"/></linearGradient></defs>');
    }

    /* ---- 面板网格 ---- */
    function prizeGrid(yFn, scale, topY, botY) {
      for (var t = 0; t <= scale.iv; t++) {
        var gv = scale.step * t, gy = yFn(gv);
        if (gy < topY - 0.5 || gy > botY + 0.5) continue;
        s.push('<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) +
          '" stroke="' + C.grid + '" stroke-width="1"/>');
        s.push('<text x="' + (padL - 6) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="' +
          C.tick + '">' + fmtAxisWan(gv) + "</text>");
      }
    }
    function rankGrid(yFn, topY, botY) {
      var ticks;
      if (rBot <= 8) { ticks = []; for (var rr = 1; rr <= rBot; rr++) ticks.push(rr); }
      else ticks = [1, Math.ceil(rBot / 3), Math.ceil(rBot * 2 / 3), rBot];
      var seen = {};
      ticks.forEach(function (r) {
        if (r < 1 || r > rBot || seen[r]) return;
        seen[r] = 1;
        var gy = yFn(r);
        if (gy < topY - 0.5 || gy > botY + 0.5) return;
        s.push('<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) +
          '" stroke="' + C.grid + '" stroke-width="1"/>');
        s.push('<text x="' + (padL - 6) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="' +
          C.tick + '">' + r + "</text>");
      });
    }
    /* 主图网格 + 轴题 */
    if (isBump) rankGrid(yMain, mainTop, baseY);
    else prizeGrid(yMain, scMain, mainTop, baseY);
    s.push('<text x="' + (padL + 8) + '" y="' + (mainTop + 13) + '" font-size="10" fill="' + C.tick + '">' +
      esc(isBump ? (labels.rank || "順位") : style === "delta" ? (labels.delta || "増分") : (labels.prize || "賞金")) + "</text>");
    /* triple 中面板：增量柱独立刻度 */
    if (isTriple) {
      prizeGrid(yDelta, scDelta, deltaTop, deltaTop + deltaH);
      s.push('<text x="' + (W - padR) + '" y="' + (deltaTop - 6) + '" text-anchor="end" font-size="10" fill="' + C.tick + '">' +
        esc(labels.delta || "増分") + "</text>");
    }

    /* ---- 主图赏金序列（按 style 分支；bump 主图 = 名次平滑线） ---- */
    if (isBump) {
      var xs = [], ys = [];
      for (var bi = 0; bi < n; bi++) {
        if (pts[bi].rank != null) { xs.push(x(bi)); ys.push(yMain(pts[bi].rank)); }
      }
      s.push('<path d="' + monotonePath(xs, ys) + '" fill="none" stroke="' + C.prize + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>');
      var rEvery = n > 60 ? 7 : 1;
      for (bi = 0; bi < n; bi++) {
        var pB = pts[bi], lastB = bi === n - 1;
        if (pB.rank != null && (lastB || bi % rEvery === 0)) {
          s.push('<circle cx="' + x(bi).toFixed(1) + '" cy="' + yMain(pB.rank).toFixed(1) + '" r="' + (lastB ? 4 : 2.6) +
            '" fill="' + C.prize + '"' + (lastB ? ' stroke="' + C.halo + '" stroke-width="1.6"' : "") + "/>");
        }
      }
    } else if (style === "bar") {
      var bw = Math.max(1.5, Math.min(slot * 0.62, 26));
      for (var bi2 = 0; bi2 < n; bi2++) {
        if (pts[bi2].prize == null) continue;
        var bx = x(bi2) - bw / 2, bv = yMain(pts[bi2].prize), bh = Math.max(1, baseY - bv);
        s.push('<rect x="' + bx.toFixed(1) + '" y="' + bv.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' +
          bh.toFixed(1) + '" rx="' + Math.min(3, bw / 2).toFixed(1) + '" fill="' + C.prize + '" opacity="' +
          (bi2 === n - 1 ? "1" : "0.45") + '"/>');
      }
    } else if (style === "delta") {
      var dw = Math.max(1.5, Math.min(slot * 0.62, 26));
      for (var di = 0; di < n; di++) {
        if (deltas[di] == null || deltas[di] <= 0) continue;
        var dx0 = x(di) - dw / 2, dvy = yMain(deltas[di]), dh = Math.max(1, baseY - dvy);
        s.push('<rect x="' + dx0.toFixed(1) + '" y="' + dvy.toFixed(1) + '" width="' + dw.toFixed(1) + '" height="' +
          dh.toFixed(1) + '" rx="' + Math.min(3, dw / 2).toFixed(1) + '" fill="' + C.prize + '" opacity="' +
          (di === n - 1 ? "1" : "0.55") + '"/>');
      }
    } else {
      /* combo（v1.3.1 组合版）：先画增量柱（与累计线共用 y 轴、同面板），再平滑面积累计线 */
      if (style === "combo") {
        var cw = Math.max(1.5, Math.min(slot * 0.5, 22));
        for (var ci = 1; ci < n; ci++) {
          if (deltas[ci] == null || deltas[ci] <= 0) continue;
          var cy0 = yMain(deltas[ci]), ch = Math.max(1, baseY - cy0);   /* 柱高 = 增量（不是累计值） */
          s.push('<rect x="' + (x(ci) - cw / 2).toFixed(1) + '" y="' + cy0.toFixed(1) + '" width="' + cw.toFixed(1) + '" height="' +
            ch.toFixed(1) + '" rx="' + Math.min(3, cw / 2).toFixed(1) + '" fill="' + C.prize + '" opacity="' +
            (ci === n - 1 ? "0.9" : "0.5") + '"/>');
        }
      }
      /* 阶梯 / 平滑（+triple/combo 主图恒为平滑）：先面积后主线；阶梯末点延到右缘=当前值延续 */
      var lineD, areaD = "";
      if (style === "smooth-area" || isTriple || style === "combo") {
        var xs2 = [], ys2 = [];
        for (var si = 0; si < n; si++) { xs2.push(x(si)); ys2.push(yMain(pts[si].prize)); }
        lineD = monotonePath(xs2, ys2);
        if (needGrad) areaD = lineD + " L" + xs2[n - 1].toFixed(1) + " " + baseY.toFixed(1) +
          " L" + xs2[0].toFixed(1) + " " + baseY.toFixed(1) + " Z";
      } else {
        lineD = "";
        var started = false;
        for (var pi = 0; pi < n; pi++) {
          var px = x(pi), ppy = yMain(pts[pi].prize);
          if (!started) { lineD += "M" + px.toFixed(1) + " " + ppy.toFixed(1); started = true; }
          else lineD += " H" + px.toFixed(1) + " V" + ppy.toFixed(1);
        }
        if (started) lineD += " H" + (W - padR);
        if (needGrad && started) {
          areaD = lineD + " L" + (W - padR) + " " + baseY.toFixed(1) +
            " L" + x(0).toFixed(1) + " " + baseY.toFixed(1) + " Z";
        }
      }
      if (areaD) s.push('<path d="' + areaD + '" fill="url(#' + gradId + ')"/>');
      s.push('<path d="' + lineD + '" fill="none" stroke="' + C.prize + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>');
      /* 主线只在末点放强调点（多点常驻圆点显乱） */
      var lastPrize = pts[n - 1].prize;
      if (lastPrize != null) {
        s.push('<circle cx="' + x(n - 1).toFixed(1) + '" cy="' + yMain(lastPrize).toFixed(1) + '" r="4" fill="' +
          C.prize + '" stroke="' + C.halo + '" stroke-width="1.6"/>');
      }
      /* 跳增标注：上涨日标「+金额（名次）」，千万级变化与名次一眼可见（密集快照自动关闭）；
       * 靠右缘的点改右对齐，避免文字出界被裁 */
      if (o.annotate && n <= 45) {
        for (var ai = 1; ai < n; ai++) {
          if (deltas[ai] == null || deltas[ai] <= 0) continue;
          var ax = x(ai), ay = yMain(pts[ai].prize);
          var above = ay > mainTop + 16;
          var edge = ax > W - padR - 58;
          s.push('<text x="' + ax.toFixed(1) + '" y="' + (above ? ay - 7 : ay + 15).toFixed(1) +
            '" text-anchor="' + (edge ? "end" : "middle") + '" font-size="9.5" font-weight="600" fill="' + C.tick + '">+' +
            fmtWan(deltas[ai]) + (pts[ai].rank != null ? "（" + pts[ai].rank + "位）" : "") + "</text>");
        }
      }
    }

    /* ---- triple 中面板：增量柱（独立刻度） ---- */
    if (isTriple) {
      var tw = Math.max(1.5, Math.min((plotW / Math.max(1, n - 1)) * 0.5, 22));
      for (var ti = 1; ti < n; ti++) {
        if (deltas[ti] == null || deltas[ti] <= 0) continue;
        var tvy = yDelta(deltas[ti]), th = Math.max(1, deltaTop + deltaH - tvy);
        s.push('<rect x="' + (x(ti) - tw / 2).toFixed(1) + '" y="' + tvy.toFixed(1) + '" width="' + tw.toFixed(1) + '" height="' +
          th.toFixed(1) + '" rx="' + Math.min(3, tw / 2).toFixed(1) + '" fill="' + C.prize + '" opacity="' +
          (ti === n - 1 ? "0.9" : "0.5") + '"/>');
      }
    }

    /* ---- 名次不再成图（v1.3.0 用户定稿）：信息由 跳增标注（+金额（N位））与 tooltip 承担 ---- */

    /* ---- x 刻度（首/尾必含，其余抽稀防重叠；尾点右对齐防出界） ---- */
    var lblStep = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 52))));
    for (var xi = 0; xi < n; xi++) {
      if (xi % lblStep !== 0 && xi !== n - 1) continue;
      var isLastX = xi === n - 1;
      s.push('<text x="' + (isLastX ? W - padR + 12 : x(xi)).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="' +
        (isLastX ? "end" : "middle") + '" font-size="10" fill="' + C.tick + '">' + esc(fmtMD(pts[xi].date)) + "</text>");
    }
    /* 悬停命中区（透明覆盖，含全部面板） */
    s.push('<rect x="' + padL + '" y="' + top + '" width="' + plotW + '" height="' + (H - top - xH) +
      '" fill="transparent" data-jbre-hit="1"/>');

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" style="display:block;height:auto" role="img" aria-label="' +
      esc((labels.prize || "賞金") + " " + fmtWan(pts[n - 1].prize) + "円相当 · " + (labels.rank || "順位") + " " +
        (pts[n - 1].rank == null ? "—" : pts[n - 1].rank)) + '">' + s.join("") + "</svg>";
    return {
      svg: svg, W: W, H: H, style: style,
      geo: { padL: padL, padR: padR, top: top, mainH: mainH, plotBot: H - xH, x: x,
             pts: pts, sc: scMain, rmax: rmax, slotMode: slotMode, slot: slot, n: n }
    };
  }

  /* ---------- DOM 侧：颜色解析 + 渲染 + 十字 tooltip ---------- */
  function cssVar(el, name, fallback) {
    try {
      var v = getComputedStyle(el).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  function resolveOpts(mount, opts) {
    opts = opts || {};
    var c = opts.colors || {};
    return {
      style: opts.style,
      annotate: !!opts.annotate,
      colors: {
        prize: c.prize || cssVar(mount, "--primary", cssVar(mount, "--accent", "#0aa7a0")),
        rank: c.rank || cssVar(mount, "--chart-2", "#0f8fd6"),
        grid: c.grid || "#f0f0f0",
        tick: c.tick || "#a1a1aa",
        halo: c.halo || "#ffffff"
      },
      labels: Object.assign({ prize: "賞金", rank: "順位", delta: "増分", empty: "暂无数据" }, opts.labels || {}),
      heights: Object.assign({ main: 180, delta: 70 }, opts.heights || {}),
      yTicks: opts.yTicks,
      font: opts.font || ""
    };
  }

  function render(mount, data, opts) {
    if (!mount) return;
    if (mount.__jbreRO) { mount.__jbreRO.disconnect(); mount.__jbreRO = null; }   /* 重渲染（自适应）不叠加观察器 */
    var o = resolveOpts(mount, opts);
    /* 内容宽度（clientWidth 含内边距：云迹卡片 p-4 之类容器必须扣除，否则 viewBox 与实测像素错位） */
    var W = 640;
    try {
      var cs = getComputedStyle(mount);
      W = Math.max(300, mount.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
    } catch (e) { /* keep 640 */ }
    var out = buildSVG(data, o, W);

    mount.style.position = mount.style.position || "relative";
    if (out.empty) {
      mount.innerHTML = '<div class="jbre-empty" style="padding:26px 10px;text-align:center;font-size:13px;color:#a1a1aa">' +
        out.empty + "</div>";
      return;
    }
    mount.innerHTML =
      '<div class="jbre-wrap" style="position:relative">' + out.svg +
      '<div class="jbre-cursor" style="position:absolute;top:' + out.geo.top + "px;height:" +
      (out.geo.plotBot - out.geo.top) + 'px;width:0;border-left:1px dashed rgba(23,23,23,.28);display:none;pointer-events:none"></div>' +
      '<div class="jbre-tt" style="position:absolute;top:4px;min-width:150px;max-width:230px;padding:7px 10px;border:1px solid #e4e4e7;border-radius:8px;background:rgba(255,255,255,.96);box-shadow:0 4px 14px rgba(0,0,0,.08);font-size:12px;line-height:1.5;color:#171717;display:none;pointer-events:none;white-space:nowrap;z-index:5"></div>' +
      "</div>";
    if (o.font) mount.style.fontFamily = o.font;

    var wrap = mount.firstChild;
    var cursor = wrap.querySelector(".jbre-cursor");
    var tt = wrap.querySelector(".jbre-tt");
    var geo = out.geo, n = geo.n;
    /* viewBox → 实际像素缩放比（wrap 宽 = 渲染宽；mount 有内边距时 < W） */
    function scale() { return wrap.getBoundingClientRect().width / out.W || 1; }

    function rowIndex(evX) {
      var rect = wrap.getBoundingClientRect();
      var sc = scale();
      var rel = evX - rect.left - geo.padL * sc;
      if (geo.slotMode) {
        var i = Math.floor(rel / (geo.slot * sc));
        return Math.max(0, Math.min(n - 1, i));
      }
      var plotW = (out.W - geo.padL - geo.padR) * sc;
      var i2 = Math.round(rel / (n === 1 ? plotW : plotW / (n - 1)));
      return Math.max(0, Math.min(n - 1, i2));
    }
    function show(i) {
      var p = geo.pts[i], prev = i > 0 ? geo.pts[i - 1] : null;
      var cx = geo.x(i) * scale();
      cursor.style.left = cx + "px";
      cursor.style.display = "block";
      var dp = prev && p.prize != null && prev.prize != null ? p.prize - prev.prize : null;
      var dr = prev && p.rank != null && prev.rank != null ? prev.rank - p.rank : null;
      tt.innerHTML =
        '<div style="font-weight:600;margin-bottom:2px">' + esc(p.date) + "</div>" +
        '<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + o.colors.prize + ';margin-right:5px"></i>' +
        esc(o.labels.prize) + " <b>" + fmtWan(p.prize) + "万円</b>" +
        (dp ? ' <span style="color:#737373">(+' + fmtWan(dp) + ")</span>" : "") + "</div>" +
        '<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + o.colors.rank + ';margin-right:5px"></i>' +
        esc(o.labels.rank) + " <b>" + (p.rank == null ? "—" : "第" + p.rank + "位") + "</b>" +
        (dr ? ' <span style="color:#737373">(' + (dr > 0 ? "↑" : dr < 0 ? "↓" : "－") + Math.abs(dr) + ")</span>" : "") + "</div>";
      tt.style.display = "block";
      var wrapW = wrap.getBoundingClientRect().width;
      var ttW = tt.getBoundingClientRect().width || 170;
      var left = cx + 10;
      if (left + ttW > wrapW - 4) left = Math.max(2, cx - ttW - 10);
      tt.style.left = left + "px";
    }
    function hide() { cursor.style.display = "none"; tt.style.display = "none"; }

    wrap.addEventListener("mousemove", function (e) { show(rowIndex(e.clientX)); });
    wrap.addEventListener("mouseleave", hide);
    wrap.addEventListener("touchstart", function (e) {
      if (e.touches && e.touches[0]) show(rowIndex(e.touches[0].clientX));
    }, { passive: true });

    if (typeof ResizeObserver !== "undefined") {
      var lastW = W;
      var ro = new ResizeObserver(function () {
        var w = Math.round(mount.clientWidth || 0);
        if (w && Math.abs(w - lastW) > 2) { lastW = w; hide(); render(mount, data, opts); }
      });
      ro.observe(mount);
      mount.__jbreRO = ro;
    }
  }

  window.JBIS_RANK_EMBED = { version: VERSION, styles: STYLES, render: render, buildSVG: buildSVG };
})();
