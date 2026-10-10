// JBIS 榜单页解析：div 行块布局，非 <table>（docs/DESIGN.md §2.2、§5.3）

function text(el) {
  return el
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(v) {
  const s = String(v ?? "").trim();
  if (s === "" || s === "-") return null;
  const n = parseFloat(s.replace(/[,\s万円円]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function horse(el) {
  if (!el) return null;
  const m = el.match(/<a[^>]*href="\/horse\/(\d{10})\/"[^>]*>([\s\S]*?)<\/a>/i);
  if (m) return { id: m[1], name: text(m[2]) };
  const t = text(el);
  return t ? { id: null, name: t } : null;
}

// 按顶层 <div> 切分（返回闭合的块）
function topLevelDivs(html) {
  const out = [];
  let depth = 0;
  let start = -1;
  const re = /<div\b|<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0] === "</div>") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(html.slice(start, m.index + m[0].length));
        start = -1;
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}

export function parseRows(html) {
  // 全量件数（data-hit__count，如 "438 件"）
  const hit = html.match(/data-hit__count[^>]*>([\s\S]*?)<\/div>/i);
  const total = parseInt((hit ? text(hit[1]) : "").replace(/[^0-9]/g, ""), 10) || 0;

  // 榜单容器：class="data-7__inner ..."，取其内容（排除容器自身开标签）
  const ci = html.indexOf('class="data-7__inner');
  if (ci < 0) return { rows: [], total };
  const openEnd = html.indexOf(">", ci);
  const inner = html.slice(openEnd + 1);
  const blocks = topLevelDivs(inner); // blocks[0] = 表头，其后为数据行

  const rows = [];
  for (const block of blocks.slice(1)) {
    const cells = [...block.matchAll(/<div class="jc-(?:left|right)"[^>]*>([\s\S]*?)<\/div>/g)].map(
      (m) => m[1]
    );
    const rankM = block.match(/^<div[^>]*>\s*<div>([^<]*)<\/div>/);
    if (!rankM || cells.length < 12) continue;
    const [starts, runners, wins, winners, gradedWins, gradedWinners, aeiOverall, aeiGraded, prizeOverall, prizeGraded] =
      cells.slice(1, 11);
    rows.push({
      rank: parseInt(rankM[1].trim(), 10) || 0,
      sire: horse(cells[0]),
      starts: num(starts),
      runners: num(runners),
      wins: num(wins),
      winners: num(winners),
      gradedWins: num(gradedWins),
      gradedWinners: num(gradedWinners),
      aeiOverall: num(aeiOverall),
      aeiGraded: num(aeiGraded),
      prizeOverall: num(prizeOverall),
      prizeGraded: num(prizeGraded),
      repProgeny: cells.length >= 12 ? horse(cells[11]) : null,
    });
  }
  return { rows, total };
}
