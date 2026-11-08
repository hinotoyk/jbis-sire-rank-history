# 前端优化方案：PC / MB 分治（参考 yunji-web）

> 目标：把 yunji-web 经过实战验证的 PC/MB 分治思路移植到本项目，
> 解决当前「移动端只是把桌面端挤小」的问题，同时收敛断点、统一判定入口。
> 范围：`site/`（index.html / app.js / style.css + 新增 device.js）。
> **不动**：embed/sire-rank-chart.js（外部嵌入组件，自带样式体系）、friend-links.js、构建脚本、数据层。

---

## 一、yunji-web 分治思路提炼（4 条核心约定）

| # | 约定 | yunji-web 落地方式 |
|---|------|--------------------|
| 1 | **设备判定单一入口** | `device.js` 全站唯一判定点：`YJ.device.isMb()/isPc()/mode()/onChange(cb)`，基于 `matchMedia` 实现，禁止散落 `innerWidth` |
| 2 | **单断点、CSS/JS 同源** | 全站一个 768px 断点（Tailwind `max-md:`），JS 的 matchMedia 与 CSS 媒体查询是同一表达式 → 样式层与逻辑层永不脱节 |
| 3 | **渲染层双路径** | 同一份数据，render 函数内部 `isMb()` 决定走 **PC 表格** 还是 **MB 卡片分块**（如 races 页 `renderRaces`），而不是用 CSS 把表格硬掰成卡片 |
| 4 | **翻转重渲染 + 按设备定参** | `YJ.device.onChange()` 在跨断点时用**已缓存数据**重渲染（覆盖「先桌面渲染、再缩到手机」场景）；分页条数、图高、筛选密度按设备固定（如 mb 10~20 条 / pc 100 条） |

## 二、本项目现状问题

1. **断点碎片化、JS/CSS 不同源**
   - CSS 有 3 个断点：`980`（图表双列变单列）、`720`（布局收紧 + 表格 sticky 列）、`600`（隐藏 Δ 两列）
   - JS 只有 1 个：`app.js:66` 的 `isNarrow() = window.innerWidth <= 720`，轮询式读取，与 CSS 无同源关系
2. **明细表在移动端仍是 11 列表格横滑**：只做了「前两列 sticky + 隐藏 Δ 列」的补丁，600+ 行 × 9 列在手机上信息密度低、滑动距离长
3. **断点翻转只照顾了柱图**：`app.js:71-78` 跨 720px 时只 `renderBar()`，明细表（sticky 列、隐藏列）与曲线不响应
4. **MB 交互不可发现**：「点击行加入曲线」只靠 `tr.title`（桌面 hover 才可见），手机端完全无提示
5. **「查看更多」一次性渲染全部**：`state.expanded` 展开后 620 行 DOM 一次插入，手机上明显卡顿

## 三、改造方案

### 3.1 新增 `site/device.js` —— 设备判定单一入口（对应约定 1、2）

照搬 yunji-web `device.js` 模式，断点取 **720**（与现有窄屏判定和 CSS 主体断点一致）：

```js
/* 设备判定统一入口：全站只此一处判断 PC / MB，
 * 后续一律用 JB.device.isMb() 分支，不再散落 innerWidth。
 * 断点 720px，与 style.css 的 @media (max-width: 719px) 同源（matchMedia 实时响应）。 */
window.JB = window.JB || {};
JB.device = (function () {
  "use strict";
  const BREAKPOINT = 720;
  const mql = window.matchMedia
    ? window.matchMedia("(max-width:" + (BREAKPOINT - 1) + "px)")
    : null;
  const isMb = () => mql ? mql.matches
    : (window.innerWidth || document.documentElement.clientWidth) < BREAKPOINT;
  const isPc = () => !isMb();
  const mode = () => isMb() ? "mb" : "pc";
  const cbs = [];
  const fire = () => { const i = { isMb: isMb(), isPc: isPc(), mode: mode() }; cbs.forEach(fn => { try { fn(i); } catch (e) {} }); };
  if (mql) (typeof mql.addEventListener === "function" ? mql.addEventListener("change", fire)
    : mql.addListener && mql.addListener(fire));
  return { isMb, isPc, mode, onChange: fn => (cbs.push(fn), () => cbs.splice(cbs.indexOf(fn), 1)), BREAKPOINT };
})();
```

`app.js` 中原 `isNarrow()` 改为薄别名（保留函数名，调用点零改动）：

```js
const isNarrow = () => JB.device.isMb();   // 唯一判定来源 = device.js
```

### 3.2 明细表 MB 卡片化 —— 渲染层双路径（对应约定 3）

`renderTable()` 内部按 `isMb()` 分两条渲染路径，数据同源：

**PC 路径**：维持现状（11 列表格 + sticky 表头 + 前 50 收起）。

**MB 路径**：渲染为两行式卡片列表（替代现在的横滑表格）。字段取舍原则 ——
手机上只保留「识别它是谁 + 它表现如何」的最小集，次要列收进第二行小字：

```
┌──────────────────────────────────────────┐
│ 1  ▲2  コントレイル        賞金全般        │  ← 行1：順位 + Δ順位徽章 + 马名（粗）+ 主数值
│        勝利 12/9 · 重賞 4/3   84,512 万円 │  ← 行2：次级指标串 + 賞金
│        代表産駒：エコロジinstein           │  ← 行3：代表産駒（小字，可点）
└──────────────────────────────────────────┘
```

- **保留交互语义**：点击卡片主体 = 加入/移出曲线（与 PC 点行一致），`picked` 卡片左侧 3px 强调色条；代表産駒链接点击不冒泡（同现有 `e.target.closest("a")` 豁免逻辑，天然复用）
- Δ順位做成小徽章（▲绿 / ▼红 / ＝灰），替代现在隐藏掉整列 —— 移动端反而比桌面多保留一个信号
- AEI、賞金重賞、出走回/頭 在 MB 卡片省略（赏金全般已含重賞 stacks，需要细节时点名字去 JBIS）
- 渲染函数抽 `mbCardHTML(r)` 单一出处，与 PC 行共享 `deltaCls/deltaTxt/fmt` 映射，两路径字段口径永不走样

```js
function renderTable() {
  if (JB.device.isMb()) renderTableMb(); else renderTablePc();
}
```

`index.html` 的 `<table>` 外再放一个 `<div id="rank-cards" class="rank-cards" hidden></div>`，
两容器互斥显示（`hidden` 切换），事件委托分别挂。

### 3.3 断点翻转重渲染 + 按设备定参（对应约定 4）

```js
// 翻转 720px 断点：用已缓存数据重渲染，覆盖「桌面先渲染、再缩到手机」场景
JB.device.onChange(() => {
  state.expanded = false;              // 回到设备默认条数
  renderMeta(); renderBar(); renderTable();
  // 曲线不必重建：x 轴/数据与设备无关，尺寸由现有 resize 逻辑兜底
});
window.addEventListener("resize", resizeAll);  // 跨断点分支移交 onChange，resize 只管 ECharts 尺寸
```

设备定参表：

| 参数 | PC | MB |
|------|----|----|
| 明细默认条数 `state.limit` | 50 | 30 |
| 「查看更多」步进 | 保持「展开全部」现状 | **增量 +30 追加**（不整表重渲染，`insertAdjacentHTML` 接续，避免 620 行一次插入卡顿） |
| 柱图 grid / 刻度密度 | 现状 | 现有 `narrow` 分支不变，只是来源改为 device |
| 卡片列表容器高 | — | 不限高（自然滚动），替代现在 `max-height:640px` 的内嵌滚动条（手机双滚动条体验差） |

### 3.4 CSS 断点收敛（对应约定 2）

| 现状 | 收敛后 | 说明 |
|------|--------|------|
| `@media (max-width: 980px)` 图表单列 | **保留**，但文档定性为「布局断点」（只管 `.grid` 列数），不参与设备判定 | 720–980 双列每列 ~330px 确实挤，此断点有存在价值 |
| `@media (max-width: 720px)` | 保留为**唯一设备断点**，与 device.js 同源 | 布局收紧规则不变 |
| `@media (max-width: 600px)` 隐藏 Δ 列 | **删除** | MB 已卡片化，表格横滑场景不复存在；卡片端 Δ 是徽章不隐藏 |
| 新增 `.rank-cards` 样式 | 卡片、Δ 徽章、picked 色条、`prefers-reduced-motion` 降级 | 放 720 断点内，桌面上 `display:none` 兜底 |

### 3.5 MB 交互增强（小成本项）

1. **曲线操作可发现**：曲线面板 `hint` 在 MB 端文案换为「点击明细卡片可加入/移出曲线」，卡片首次渲染时 `picked` 者带淡强调底色，状态可见
2. **触控反馈**：卡片 `:active` 态压暗背景（`touch` 无 hover，现 `tr:hover` 在手机上永远不触发）
3. **期间切换**（日/周/月/年）在 MB 端随 `row-head` 自动换行，现状已可接受，不动

## 四、实施清单

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `site/device.js` 新增 | 设备判定单一入口（§3.1） |
| 2 | `site/index.html` | `<script src="device.js">`（先于 app.js）；`#rank-cards` 挂载点 |
| 3 | `site/app.js` | `isNarrow` 改薄别名；`renderTable` 双路径 + `mbCardHTML`；`device.onChange` 翻转重渲染；MB 分页定参；resize 逻辑瘦身 |
| 4 | `site/style.css` | `.rank-cards` 卡片样式；删 600 断点；720 断点内补卡片规则与 `:active` 态 |
| 5 | 验证 | `npm run build` → 本地 9092 双端过一遍：PC 表格回归无变化；DevTools 手机模拟看卡片、断点拖拽翻转重渲染、点卡片加曲线、查看更多增量、4 套主题下卡片取色 |

## 五、验收标准

- [ ] 全站（site 主页面）唯一设备判定来源为 `device.js`，grep 无散落 `innerWidth`
- [ ] JS 判定与 CSS 设备断点是同一表达式（719px），拖拽窗口跨断点时表格⇄卡片即时互换、数据不重新请求
- [ ] 375px 宽度下明细区无横向滚动，单屏可读 順位/Δ/马名/賞金
- [ ] 卡片点击加曲线与 PC 点行行为一致，上限 12 与 picked 高亮共用
- [ ] PC 端展示与现状零回归（表格、柱图、曲线、hero 不动）
