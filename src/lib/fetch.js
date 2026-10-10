import { BASE } from "../config.js";

export const UA =
  "Mozilla/5.0 (compatible; JBIS-Sire-Rank-History/1.2; research use, 1 request/day/type)";

// 带重试/超时的抓取（docs/DESIGN.md §5.2）
export async function fetchHtml(url, { retries = 3, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      if (text.length < 500) throw new Error("short response (" + text.length + ")");
      return text;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); // 指数退避
    }
  }
  throw lastErr;
}

// 每类型的规范 URL（docs/DESIGN.md §3）；page 用于全量翻页
export function buildUrl(type, y1, page = 1) {
  const q = { ...BASE, ...type.query, y1, page };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) p.set(k, v);
  return "https://www.jbis.or.jp/ranking/result/?" + p.toString();
}
