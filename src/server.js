// 本地静态服务：端口 / 服务根 / 绑址单源 = 项目根 serve.config.json（docs/DESIGN.md §11）
//   yunji-web 9090 / kzn-web 9091 / 本站 9092 / racing-calendar 9093
// 端口被占用时直接报错退出（不自动顺延）：宿主站（云迹 stats.html）引用的是固定 9092，
// 顺延等于静默失配。换端口只改 serve.config.json。
import http from "node:http";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { SITE, SERVE, ROOT_DIR } from "./config.js";

const ROOT = path.resolve(ROOT_DIR, SERVE.root);
const ENTRY = SERVE.open || "index.html";
const HOST = SERVE.host || "127.0.0.1";
const PORT = SITE.port;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
};
// 静态二进制（图片/字体）允许小时级缓存；HTML/JS/CSS/JSON 一律 no-cache —— 重 build 后
// 浏览器还吃旧脚本是「看不到新功能」的元凶（本地无 ETag，启发式缓存会一直复用）。
const CACHEABLE = new Set([".png", ".gif", ".jpg", ".jpeg", ".webp", ".ico", ".svg", ".woff2"]);

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url.endsWith("/")) url += ENTRY;
  const fp = path.normalize(path.join(ROOT, url));
  if (!fp.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      return res.end("not found: " + url);
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      // 与线上 GitHub Pages 对齐（全站 ACAO *）：兄弟站 embed 组件在宿主页跨站 fetch 本站产物
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": CACHEABLE.has(ext) ? "public, max-age=3600" : "no-cache",
    });
    fs.createReadStream(fp).pipe(res);
  });
});

function die(msg) {
  console.error("[serve] " + msg);
  process.exit(1);
}

/** 真·占用检测：本机已有监听则 connect 立刻成功（不靠 bind，避开 SO_REUSEADDR/TIME_WAIT 干扰） */
function portBusy(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: HOST, port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(500, () => done(false));
  });
}

async function main() {
  if (!fs.existsSync(ROOT)) {
    die(`服务根不存在：${ROOT}\n        产物没建出来，先执行：npm run build`);
  }
  if (!fs.existsSync(path.join(ROOT, ENTRY))) {
    die(`入口不存在：${path.join(ROOT, ENTRY)}\n        产物不完整，先执行：npm run build`);
  }
  if (await portBusy(PORT)) {
    die(`端口 ${PORT} 已被占用（本站约定端口，见 serve.config.json）。\n` +
      `        查占用：netstat -ano | findstr :${PORT} → taskkill /PID <pid> /F\n` +
      `        换端口只改 serve.config.json，并连带核对宿主站的跨站引用。`);
  }

  server.once("error", (e) => die(`无法监听 ${HOST}:${PORT} —— ${e.message}`));
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}/${ENTRY}`;
    console.log(`[serve] serving ${ROOT}`);
    console.log(`[serve] open: ${url}`);
    if (!process.argv.includes("--no-open")) {
      try {
        if (process.platform === "win32") {
          spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
        } else if (process.platform === "darwin") {
          spawn("open", [url], { stdio: "ignore", detached: true }).unref();
        } else {
          spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
        }
      } catch { /* 打开浏览器失败不影响服务 */ }
    }
  });
}

main();
