/*!
 * friend-links.js — 「友情档案」三站互跳小组件（单一方案，三站共用同一文件）
 *
 * 覆盖站点（SITES 注册表）：
 *   yunji = 云迹 · 云崽档案        https://www.yunji.xyz/
 *   kzn   = 絆 · 高情厚意档案      https://hinotoyk.github.io/kzn-web/dist/
 *   jbis  = JBIS LS榜（種牡馬ランキング） https://hinotoyk.github.io/jbis-sire-rank-history/
 *
 * ★ 增删站点 / 改文案 / 改 URL：三站同名文件必须同步修改
 *   （yunji-web front/public/ 、kzn-web front/public/ 、jbis-sire-rank-history site/），
 *   方案说明见各仓库 docs/友情跳转方案.md。
 *
 * 用法（挂载点；渲染失败 / 脚本缺失时挂载点保持空白，无占位观感）：
 *   <div data-friend-links data-site="yunji" data-skin="yj"></div>
 *   <script src="friend-links.js" defer></script>
 *
 * data-site = 当前站 id（渲染时排除自身）；data-skin：
 *   yj   = 模板站（yunji/kzn）侧栏皮肤，Tailwind utility 字面量
 *          （两站 tailwind.config.js 的 content 均扫 public 目录，可被编译进 theme css）；
 *   jbis = jbis 页脚收尾皮肤，运行时注入自带 CSS（jbis 无 Tailwind），取站点 CSS 变量
 *          （--line/--muted/--accent/--accent-soft/--ink/--card），自动随 mint/mist/ink/sand 换肤。
 *
 * 跳转语义：一律新标签页（target=_blank + rel=noopener）——三站都是带页内状态的查询工具，
 * 跳走不丢当前筛选 / 图表 / 页码状态；外站也不进本站 iframe。
 */
(function () {
  "use strict";

  /* ---------- 站点注册表（唯一需要维护的数据） ---------- */
  var SITES = [
    {
      id: "yunji", logo: "雲", color: "#0aa7a0",
      name: "云迹", sub: "云崽档案",
      url: "https://www.yunji.xyz/",
      desc: "コントレイル 产驹档案"
    },
    {
      id: "kzn", logo: "絆", color: "#0aa7a0",
      name: "絆", sub: "绊崽档案",
      url: "https://hinotoyk.github.io/kzn-web/dist/",
      desc: "キズナ 产驹档案"
    },
    {
      id: "jbis", logo: "LS", color: "#0aa7a0",
      name: "JBIS LS榜", sub: "",
      url: "https://hinotoyk.github.io/jbis-sire-rank-history/",
      desc: "每日快照"
    }
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 展示名：name + sub 連写不超 10 字才拼「name · sub」，避免侧栏窄列截断
   * （云迹·云崽档案 6 字 ✓ / 絆·绊崽档案 5 字 ✓ / JBIS LS榜 无副题单显） */
  function labelOf(s) {
    if (s.sub && (s.name.length + s.sub.length) <= 10) return s.name + " · " + s.sub;
    return s.name;
  }

  /* ---------- 皮肤 yj：模板站（yunji / kzn）侧栏 ----------
   * 视觉语言 = 侧栏既有元素逐类复用：分组标题 = nav 组标签（「统计」）同款，
   * 条目 = nav-item 同款（hover:bg-muted/40），logo 方块 = 品牌区 logo 同构（26px 缩号）。
   * 容器类也写在 JS 里（content 可扫到）；挂载点本身不带类，脚本缺失 = 零痕迹。 */
  function skinYJ(host) {
    var d = document.createElement("div");
    d.className = "border-t border-border px-2.5 pb-2";
    var h = '<div class="px-2.5 pb-1.5 pt-3 text-[11.5px] font-semibold uppercase tracking-[1.5px] text-secondary-foreground">友情档案</div>';
    SITES.forEach(function (s) {
      if (s.id === host.site) return;
      h += '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="友情档案 · 新标签页打开"'
        + ' class="group mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[14px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">'
        + '<span aria-hidden="true" class="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] text-[12.5px] font-bold text-primary-foreground" style="background:' + esc(s.color) + '">' + esc(s.logo) + '</span>'
        + '<span class="min-w-0 flex-1 leading-tight">'
        + '<span class="block truncate font-medium">' + esc(labelOf(s)) + '</span>'
        + '<span class="block truncate text-[10.5px] opacity-75">' + esc(s.desc) + '</span>'
        + '</span>'
        + '<span aria-hidden="true" class="flex-none text-[12px] text-primary opacity-0 transition-opacity group-hover:opacity-100">↗</span>'
        + '</a>';
    });
    d.innerHTML = h;
    host.el.appendChild(d);
  }

  /* ---------- 皮肤 jbis：種牡馬ランキング 页脚收尾区 ----------
   * 位置 = main 之后、colophon footer 之前：读完排名自然到达的出口，不占首屏、
   * 不混入站头功能区（v2 定稿，站头 chips 行废弃）。
   * 视觉语言 = 站点既有 .panel（白底、1px --line 边、8px 圆角）+ .panel-title
   * （中文粗题 + 英文小字副题）；条目 hover 同表格行（--accent-soft 底 + --accent 边）。
   * 品牌方块（雲/絆）= 三站家族识别语言，颜色恒定不随主题。 */
  var JCSS_ID = "yjfr-j-css";
  var JCSS = [
    ".yjfr-j{max-width:1200px;margin:0 auto;padding:0 24px 20px}",
    ".yjfr-j-head{margin:0 0 10px;font-size:13.5px;font-weight:700;color:var(--ink)}",
    ".yjfr-j-head span{margin-left:10px;font-size:11px;font-weight:400;letter-spacing:.1em;color:var(--muted)}",
    ".yjfr-j-cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
    ".yjfr-j-card{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);text-decoration:none;transition:border-color .15s,background .15s}",
    ".yjfr-j-card:hover{border-color:var(--accent);background:var(--accent-soft)}",
    ".yjfr-j-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
    ".yjfr-j-logo{display:flex;width:28px;height:28px;flex:none;align-items:center;justify-content:center;border-radius:8px;color:#fff;font-size:13px;font-weight:700}",
    ".yjfr-j-txt{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}",
    ".yjfr-j-txt b{font-weight:700;font-size:14px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .15s}",
    ".yjfr-j-card:hover .yjfr-j-txt b{color:var(--accent)}",
    ".yjfr-j-txt small{font-weight:400;font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".yjfr-j-arr{flex:none;font-size:13px;color:var(--accent);opacity:0;transition:opacity .15s}",
    ".yjfr-j-card:hover .yjfr-j-arr{opacity:1}",
    "@media (max-width:720px){.yjfr-j-cards{grid-template-columns:1fr}}",
    "@media (prefers-reduced-motion:reduce){.yjfr-j-card,.yjfr-j-txt b,.yjfr-j-arr{transition:none}}"
  ].join("\n");

  function ensureJCss() {
    if (document.getElementById(JCSS_ID)) return;
    var st = document.createElement("style");
    st.id = JCSS_ID;
    st.textContent = JCSS;
    document.head.appendChild(st);
  }

  function skinJBIS(host) {
    ensureJCss();
    var d = document.createElement("section");
    d.className = "yjfr-j";
    var h = '<h2 class="yjfr-j-head">友情档案<span>SISTER SITES</span></h2><div class="yjfr-j-cards">';
    SITES.forEach(function (s) {
      if (s.id === host.site) return;
      h += '<a class="yjfr-j-card" href="' + esc(s.url) + '" target="_blank" rel="noopener" title="友情档案 · 新标签页打开">'
        + '<span aria-hidden="true" class="yjfr-j-logo" style="background:' + esc(s.color) + '">' + esc(s.logo) + '</span>'
        + '<span class="yjfr-j-txt"><b>' + esc(labelOf(s)) + '</b><small>' + esc(s.desc) + '</small></span>'
        + '<span aria-hidden="true" class="yjfr-j-arr">↗</span>'
        + '</a>';
    });
    d.innerHTML = h + '</div>';
    host.el.appendChild(d);
  }

  /* ---------- 引导：扫描挂载点，逐个渲染（幂等，先清空再渲染） ---------- */
  function boot() {
    var mounts = document.querySelectorAll("[data-friend-links]");
    for (var i = 0; i < mounts.length; i++) {
      var el = mounts[i];
      el.innerHTML = "";
      var site = el.getAttribute("data-site") || "";
      var skin = el.getAttribute("data-skin") || "yj";
      try {
        if (skin === "jbis") skinJBIS({ el: el, site: site });
        else skinYJ({ el: el, site: site });
      } catch (e) { /* 任何渲染异常都静默：挂载点最多保持空白，绝不影响宿主页面 */ }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
