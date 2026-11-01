/* 设备判定统一入口：全站只此一处判断 PC / MB（移动端），后续功能一律
 *       用 JB.device.isMb() / JB.device.isPc() 分支，不再散落 innerWidth。
 * 断点：720px，与 style.css 的 @media (max-width: 719px) 同一表达式（matchMedia 实现，
 *       随视口实时响应，JS 与样式层永不脱节）。
 * 用法：
 *   JB.device.isMb()       -> boolean  移动端（视口 < 720px）
 *   JB.device.isPc()       -> boolean  桌面端（!isMb()）
 *   JB.device.mode()       -> 'pc' | 'mb'
 *   JB.device.onChange(cb) -> 跨过 720px 断点时回调 cb({isMb,isPc,mode})；返回取消函数
 */
window.JB = window.JB || {};
JB.device = (function () {
  "use strict";

  const BREAKPOINT = 720;   // 设备断点（与 style.css 设备断点一致；980 为纯布局断点，不参与判定）

  // 与 CSS 同源的媒体查询；不支持 matchMedia 时退回 innerWidth
  const mql = window.matchMedia
    ? window.matchMedia("(max-width:" + (BREAKPOINT - 1) + "px)")
    : null;

  function isMb() {
    if (mql) return mql.matches;
    return (window.innerWidth || document.documentElement.clientWidth) < BREAKPOINT;
  }
  function isPc() { return !isMb(); }
  function mode() { return isMb() ? "mb" : "pc"; }

  const cbs = [];
  function onChange(fn) {
    cbs.push(fn);
    return function cancel() {
      const i = cbs.indexOf(fn);
      if (i >= 0) cbs.splice(i, 1);
    };
  }

  /* 断点翻转时通知订阅者（含降级：老 Safari 用 addListener） */
  function fire() {
    const info = { isMb: isMb(), isPc: isPc(), mode: mode() };
    cbs.forEach(function (fn) { try { fn(info); } catch (e) {} });
  }
  if (mql) {
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", fire);
    } else if (typeof mql.addListener === "function") {
      mql.addListener(fire);
    }
  }

  return { isMb: isMb, isPc: isPc, mode: mode, onChange: onChange, BREAKPOINT: BREAKPOINT };
})();
