"use strict";
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
// 拼接规则（build.js）改了就重新载入：页面脚本本是即时拼的，不该因为拼法变了就得重启桥接
const BUILD_FILE = require.resolve("./build.js");
let bundler = require(BUILD_FILE),
  bundlerStamp = fs.statSync(BUILD_FILE).mtimeMs;
function currentBundler() {
  const stamp = fs.statSync(BUILD_FILE).mtimeMs;
  if (stamp !== bundlerStamp) {
    delete require.cache[BUILD_FILE];
    bundler = require(BUILD_FILE);
    bundlerStamp = stamp;
  }
  return bundler;
}
const { sendJson } = require("./server/http.js");
const { openUrl, systemProxy } = require("./server/platform.js");
// 出网跟代理走：环境变量里设了就用它，没设再看系统代理；只交给 Node 的 fetch 与 http 全局代理，不写进 process.env——
// 模型跑的 pip、npm 照旧各凭各的。联网翻页（web.js）自带地址门禁、另起连接，不经这里。Node 24 起才有这个口子，旧版照旧直连
const PROXY = (() => {
  const env = process.env,
    https = env.HTTPS_PROXY || env.https_proxy,
    plain = env.HTTP_PROXY || env.http_proxy;
  const proxy =
    https || plain
      ? { HTTPS_PROXY: https || plain, HTTP_PROXY: plain || https, NO_PROXY: env.NO_PROXY || env.no_proxy || "" }
      : systemProxy();
  const setProxy = /** @type {any} */ (http).setGlobalProxyFromEnv;
  if (!proxy || typeof setProxy !== "function") return "";
  // 本机的几处（假服务、本地模型、游目调试口）无论如何直连
  proxy.NO_PROXY = [proxy.NO_PROXY, "localhost", "127.0.0.1", "::1"].filter(Boolean).join(",");
  setProxy(proxy);
  return proxy.HTTPS_PROXY;
})();
// 联网：地址门禁、翻网页、检索、调接口
const WEB = require("./server/web.js");
const SEARCH = require("./server/search.js");

const ROOT = __dirname;
const HOST = "127.0.0.1";
const PORT = Number(process.env.YAN_PORT || 8787);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".pfb": "application/octet-stream",
  ".bcmap": "application/octet-stream"
};

function securityHeaders(req, res) {
  const isPreview = new URL(req.url, `http://${HOST}`).pathname === "/preview.html";
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // 主页面另许连本机的 ws：看台直连模型所用浏览器的调试口（见 server/stage.js）。
  // 主页面只许本站自己嵌入：右栏（并排的最多四段对话）就是主页面嵌了一份自己（见 src/27-split.js）；别的网站一概嵌不进来。
  // preview.html 只允许被本站（主页面）嵌入，且只有它需要执行 blob: 脚本；否则任意网站都能把它 iframe 进去并注入脚本读取 localStorage
  res.setHeader(
    "Content-Security-Policy",
    isPreview
      ? "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
      : `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:*; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`
  );
}
// 能调桥接的页面：本机来源。别的网站连模型转发、列模型也不许借道——那等于让任意网页经桥接往局域网里发请求。
// 来源为 "null" 的一概不认：file:// 打开的页面是它，可任何网站嵌一个开了沙箱的 iframe 也是它，分不出来；
// file:// 打开的页面因此接不上桥接，页面只提示去 http://127.0.0.1:端口 打开
function allowedOrigin(origin) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin || "");
}
// Host 头只认本机的这个端口：防 DNS 重绑定——恶意域名解析到 127.0.0.1 后，它的页面对桥接发的是「同源」请求，GET 不带 Origin，
// 只看 Origin 就会被当成本机脚本放行（卷宗的取件接口能读到任意路径）
function trustedHost(req) {
  const host = String(req.headers.host || "").toLowerCase();
  return host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
}
function corsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.headers["access-control-request-private-network"] === "true") res.setHeader("Access-Control-Allow-Private-Network", "true");
}
// 执事接口能执行本机指令，不能只依赖 CORS：不可信页面即使读不到响应，也可能用简单请求触发副作用。
// 无 Origin 的本机脚本仍可调用；浏览器只接受本站页面（别的本机端口可对谈，但不开放执事）。
function trustedWorkRequest(req) {
  const origin = req.headers.origin;
  // img / video 等浏览器 GET 通常不带 Origin，仍须按 Fetch Metadata 拒绝跨站与别的本机来源。
  if (!origin) return !req.headers["sec-fetch-site"] || ["same-origin", "none"].includes(req.headers["sec-fetch-site"]);
  try {
    const url = new URL(origin),
      port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname.toLowerCase()) && port === PORT;
  } catch {
    return false;
  }
}
let APP_VERSION = "";
try {
  APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version || "";
} catch {}
// 桥接自己的代码（server.js、server/）在启动之后又改过：页面据此提醒重启，
// 否则新页面对着旧桥接，接口对不上时的毛病无从查起
const STARTED_AT = Date.now();
function bridgeStale() {
  const under = dir =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap(entry => (entry.isDirectory() ? under(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  return [__filename, ...under(path.join(ROOT, "server"))].some(file => fs.statSync(file).mtimeMs > STARTED_AT);
}
function handleBootstrap(req, res) {
  sendJson(res, 200, {
    version: APP_VERSION,
    stale: bridgeStale(),
    // store：存储根的位置，fresh 是这个根还没立起来（页面据此把旧数据迁进来）
    store: STORE.describe(),
    work: {
      home: WORK.workHome(),
      archive: STORE.paths().archive,
      chats: STORE.paths().chats,
      files: STORE.paths().files,
      scratch: WORK.SCRATCH_DIR,
      platform: process.platform,
      shell: WORK.WORK_SHELL
    }
  });
}
// 存储根（默认 ~/.yan）：对话、卷宗、配置都在里面，换位置后下面两处跟着走；有对话正作答时不换（问 CHATS 的租约，换时才问）
const STORE = require("./server/store.js")({ working: () => CHATS.working() });
// 沙箱环境：存储根里的 环境/，桥接起的进程（指令、MCP 服务）都接上它
const ENV = require("./server/env/index.js")({ envHome: () => STORE.paths().env });
// 视频换壳：浏览器认不得的封装（如扩展名写作 mp4 的 MPEG-TS），预览时借环境里的 ffmpeg 原样换进 MP4（见 server/video.js）
const VIDEO = require("./server/video.js")({
  cacheHome: () => path.join(STORE.paths().env, "cache", "视频"),
  ffmpeg: () => ENV.toolPath("ffmpeg")
});
const WORK = require("./server/work/index.js")({
  archiveHome: () => STORE.paths().archive,
  workHome: () => STORE.paths().work,
  storeRoot: () => STORE.paths().root,
  toolEnv: ENV.apply,
  playable: VIDEO.playable
});
// 技能：照 Claude Code 的 SKILL.md 写法，只认存储根/技能一处（见 server/skills.js）；随言带来的几份在 skills/，头一回列技能时拷进去
// （YAN_BUILTIN_SKILLS 给空串即不带，测试桥接用）
const SKILLS = require("./server/skills.js")({
  skillsHome: () => STORE.paths().skills,
  bundled: process.env.YAN_BUILTIN_SKILLS ?? path.join(ROOT, "skills")
});
const CHATS = require("./server/chats.js")({ chatsHome: () => STORE.paths().chats });
const FILES = require("./server/files.js")({ filesHome: () => STORE.paths().files, playable: VIDEO.playable });
const STAGE_LIB = require("./server/stage.js");
// 检索与翻网页用的无头浏览器（直接请求被拦、网页要跑脚本时才起，见 server/headless.js）：配置目录只是 Cookie 与缓存，不算用户的东西，
// 放系统临时目录、不进存储根（也不进 环境/：清空环境时它若开着，删到一半就卡住）；按端口各一份，测试的桥接不与常开的那个共用
require("./server/headless.js").configure({ home: () => path.join(os.tmpdir(), `yan-检索浏览器-${PORT}`) });
// MCP：按设置里的配置起、连外部的 MCP 服务，把它们的工具交给页面
const MCP = require("./server/mcp/index.js")({
  version: APP_VERSION,
  toolEnv: ENV.apply,
  // 游目自己的浏览器拼成整条；起 Playwright 的 MCP 时补齐游目要的接法（调试口、放行来源、窗口挪到屏幕外），见 server/stage.js
  prepare: config => STAGE_LIB.prepareMcp(config, { root: STORE.paths().root, bridgePort: PORT })
});
// 看台：替页面问出模型所用浏览器的调试地址，其余页面直连（见 server/stage.js）
const STAGE = STAGE_LIB({ root: () => STORE.paths().root });
// 总线：长请求的响应从页面的一条事件流回去，不再一个请求占一条浏览器连接（见 server/bus.js）
const BUS = require("./server/bus.js")({ dispatch });
// 模型转发：测试连接、列模型、对话；各家接口的差异都在 server/model/ 的登记表里（ChatGPT 订阅的登录凭证随存储根）
const MODEL = require("./server/model/index.js")({ home: () => STORE.paths().root });
// 用量簿：按日记各类花了多少，给设置里的用量卡看（见 server/usage.js）
const USAGE = require("./server/usage.js")({ file: () => path.join(STORE.paths().root, "用量.json") });

// 接口表：「方法 路径」→ 处理函数。受信的那一半能碰本机磁盘与本机服务（执事、卷宗、对话目录、存储、附件，以及能打本机的 http_request），
// 只受理本站页面与本机脚本；另一半（引导、转发、检索、翻网页）凡是本机桥接认得的来源都可调
const OPEN_ROUTES = {
    "GET /api/bootstrap": handleBootstrap,
    ...MODEL.openRoutes,
    ...WEB.openRoutes,
    ...SEARCH.openRoutes,
    ...BUS.routes
  },
  TRUSTED_ROUTES = {
    ...WEB.routes,
    ...WORK.routes,
    ...SKILLS.routes,
    ...CHATS.routes,
    ...STORE.routes,
    ...FILES.routes,
    ...MCP.routes,
    ...ENV.routes,
    ...STAGE.routes,
    ...MODEL.routes,
    ...USAGE.routes
  };
const ROUTES = new Map(Object.entries({ ...OPEN_ROUTES, ...TRUSTED_ROUTES }));
const TRUSTED_PATHS = new Set(Object.keys(TRUSTED_ROUTES).map(key => key.split(" ")[1]));

const NOT_FOUND_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>此页不存在 · 言</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#fbfaf6;color:#292724;font-family:"Noto Serif SC","Songti SC","STSong",serif}@media(prefers-color-scheme:dark){body{background:#1e1c19;color:#e6e1d6}}main{text-align:center;letter-spacing:.06em}.seal{display:inline-grid;place-items:center;width:34px;height:34px;border:1px solid #9b5540;color:#9b5540;font-size:18px;transform:rotate(-3deg)}h1{margin:18px 0 8px;font-weight:500;font-size:24px}p{margin:0 0 22px;opacity:.6;font-size:13px}a{color:#9b5540;text-decoration:none;font-size:13px;border-bottom:1px solid currentColor}</style></head><body><main><span class="seal">空</span><h1>此页不存在</h1><p>所寻之处并无一字</p><a href="/">回到案前</a></main></body></html>`;
// 页面脚本与样式由多段源文件拼成：按请求即时拼接（ETag 取各段的大小与修改时间），src/ 改一段、刷新即生效；不落成文件
const BUNDLES = {
  "/support.js": { build: () => currentBundler().bundleScript(), type: "application/javascript; charset=utf-8" },
  "/app.css": { build: () => currentBundler().bundleStyles(), type: "text/css; charset=utf-8" }
};
// 静态服务只开放页面运行真正需要的文件。仓库根目录里还有桥接源码、测试、.git 与用户可能临时放入的配置，
// 不能因为它们恰好位于 ROOT 下就一并交给浏览器；vendor/ 是随页面分发的纯前端资源，i18n/ 是界面的译文表；提示词随页面脚本拼进 /support.js。
const PUBLIC_STATIC_FILES = new Set(["index.html", "theme-boot.js", "icon.svg", "preview.html", "preview-runtime.js"]);
const REAL_ROOT = fs.realpathSync(ROOT);
function publicStaticTarget(requested) {
  // URL 路径里的反斜杠在 Windows 上也是目录分隔符；先统一再规范化，vendor/../server.js 不能借前缀混进来。
  const webPath = requested.replace(/\\/g, "/"),
    normalized = path.posix.normalize(webPath);
  if (normalized !== webPath || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return null;
  if (!PUBLIC_STATIC_FILES.has(normalized) && !normalized.startsWith("vendor/") && !normalized.startsWith("i18n/")) return null;
  const candidate = path.resolve(ROOT, ...normalized.split("/"));
  if (!fs.existsSync(candidate)) return null;
  // 白名单目录中若出现指向仓库外的符号链接，也不能跟出去。
  const file = fs.realpathSync(candidate),
    relative = path.relative(REAL_ROOT, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const stat = fs.statSync(file);
  return stat.isFile() ? { file, stat } : null;
}
function serveBundle(req, res, urlPath) {
  const entry = BUNDLES[urlPath];
  if (!entry) return false;
  const bundle = entry.build();
  if (!bundle.files.length) return false;
  // 版本戳是各段的名字、大小、修改时间连成的一长串：整串取指纹，不能只截开头——后面哪段改了，开头照旧
  const etag = `W/"${createHash("sha1").update(bundle.stamp).digest("base64url")}-${bundle.text.length.toString(16)}"`;
  const headers = { "Content-Type": entry.type, "Cache-Control": "no-cache", ETag: etag };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const body = Buffer.from(bundle.text, "utf8");
  res.writeHead(200, { ...headers, "Content-Length": body.length });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  if (serveBundle(req, res, urlPath)) return;
  const requested = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const target = publicStaticTarget(requested);
  if (!target) {
    if (urlPath.startsWith("/api/")) return sendJson(res, 404, { error: "未找到接口" });
    res.writeHead(404, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
    return res.end(NOT_FOUND_PAGE);
  }
  const { file, stat } = target;
  // 带上 ETag / Last-Modified：no-cache 只要求重新验证，有了校验值浏览器才会真正拿到改动后的文件，而不是沿用旧缓存
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString()
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
}

// YAN_DEBUG=1：把每个请求与异常断开都打到控制台，排查「页面说桥接没起」这类问题时用
const DEBUG = /^(1|true|yes)$/i.test(String(process.env.YAN_DEBUG || ""));
const stamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
// 一次请求的分发：直接发来的与总线转进来的（server/bus.js）走同一套门禁与接口表
async function dispatch(req, res) {
  if (DEBUG) {
    console.log(`${stamp()} ${req.method} ${req.url} origin=${req.headers.origin || "-"}`);
    res.on("close", () => {
      if (!res.writableFinished) console.log(`${stamp()}   ↳ ${req.method} ${req.url} 连接在响应写完前断开`);
    });
  }
  try {
    securityHeaders(req, res);
    if (!trustedHost(req)) {
      res.writeHead(421, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("只受理发往本机桥接地址的请求");
    }
    const urlPath = new URL(req.url, `http://${HOST}`).pathname;
    if (urlPath.startsWith("/api/") && req.headers[WEB.OUTBOUND_MARK] !== undefined)
      return sendJson(res, 403, { error: "桥接不受理自己转出的请求" });
    if (urlPath.startsWith("/api/") && req.headers.origin && !allowedOrigin(req.headers.origin))
      return sendJson(res, 403, { error: "此页面无权调用本机桥接" });
    if (TRUSTED_PATHS.has(urlPath) && !trustedWorkRequest(req))
      return sendJson(res, 403, { error: "此页面无权调用本机执事接口，请从桥接地址打开「言」" });
    corsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const handler = ROUTES.get(`${req.method === "HEAD" ? "GET" : req.method} ${urlPath}`);
    if (handler) return await handler(req, res);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    sendJson(res, 405, { error: "不支持此请求" });
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: String(error.message || error).slice(0, 500) });
    else res.end();
  }
}
const server = http.createServer(dispatch);
server.on("error", (/** @type {NodeJS.ErrnoException} */ error) => {
  if (error.code === "EADDRINUSE") console.error(`端口 ${PORT} 已被占用，可设置 YAN_PORT 后重试。`);
  else console.error(error);
  process.exitCode = 1;
});
server.on("clientError", (/** @type {NodeJS.ErrnoException} */ error, socket) => {
  if (DEBUG) console.log(`${stamp()} 客户端连接错误：${error.code || error.message}`);
  if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});
// 浏览器复用空闲连接的瞬间桥接恰好把它关掉，POST 会以「Failed to fetch」失败（GET 浏览器会自动重发，POST 不会）：
// 把空闲连接保得比浏览器久一些，这个竞态就不会发生
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
// 桥接是本机常驻进程：某个请求里没兜住的异常打出来即可，不能让整个桥接倒下、页面从此「Failed to fetch」
process.on("uncaughtException", error => console.error(`${stamp()} 桥接内部错误（已忽略）：`, error));
process.on("unhandledRejection", error => console.error(`${stamp()} 桥接内部错误（已忽略）：`, error));
// Ctrl+C、关掉窗口、结束进程时 Node 默认直接退出，不发 exit 事件：还在跑的指令与后台指令（开发服务器之类）就留在了后台占着端口。
// 接住这几个信号走一遍正常退出，exit 里的收尾（见 server/work/shell.js）才会执行
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(signal, () => process.exit(signal === "SIGINT" ? 130 : 0));
server.listen(PORT, HOST, () => {
  const address = `http://${HOST}:${PORT}`;
  console.log(
    `\n  言 · 本机桥接${APP_VERSION ? `  v${APP_VERSION}` : ""}\n  页面    ${address}\n  存储    ${STORE.paths().root}\n${PROXY ? `  代理    ${PROXY.replace(/\/\/[^@/]*@/, "//")}\n` : ""}`
  );
  console.log("  请保持此窗口开启；关闭后页面刷新、模型转发、联网与执事都会停止。按 Ctrl+C 退出。");
  console.log("  此窗口不会显示 API Key。\n");
  if (process.argv.includes("--open")) openUrl(address);
});
