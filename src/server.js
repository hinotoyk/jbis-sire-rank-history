// 本地静态服务（默认端口 9090）并打开浏览器（docs/DESIGN.md §11）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { SITE } from "./config.js";

const ROOT = path.resolve("_site");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url.endsWith("/")) url += "index.html";
  const fp = path.normalize(path.join(ROOT, url));
  if (!fp.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("not found: " + url);
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(fp).pipe(res);
  });
});

function listen(port, attempt = 0) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && attempt < 5) {
      console.log(`port ${port} busy, trying ${port + 1}...`);
      listen(port + 1, attempt + 1);
    } else {
      console.error("server error:", e.message);
      process.exit(1);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`serving ${ROOT}`);
    console.log(`open: ${url}`);
    try {
      if (process.platform === "win32") {
        spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
      } else {
        spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
      }
    } catch { /* 打开浏览器失败不影响服务 */ }
  });
}

listen(SITE.port);
