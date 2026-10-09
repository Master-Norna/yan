// 言 · 看台：模型所用的那个浏览器（playwright 等以 --remote-debugging-port 起的 Edge / Chrome），页面直接连它的调试口看画面、递点按。
// 桥接只替页面问一句它的地址：连浏览器的那条 WebSocket 须带上浏览器的 id，而调试口的 /json 不给跨源读。
// 调试口与配置目录不另设：从那个 MCP 服务的参数里读——直接写在参数里的（--cdp-endpoint、--user-data-dir），或写在 --config 那份文件里的。
// 标签页、画面、输入都在页面里（src/26-stage/），不过桥接，这里也不记任何东西。
// 另读一份收藏：看台只转网页，浏览器自己的收藏栏看不到；收藏存在浏览器配置目录的 Default/Bookmarks 里。
// 再收几份要传给网页的文件：网页要人选文件时，浏览器的选文件窗口在屏幕外，人在言这边选好，落到临时目录，交路径给浏览器
// 纸签的「用系统浏览器打开」：交给系统默认的浏览器（经 url.dll，不经 cmd——网址里的 & 会被当成命令分隔）
// 下载签的「打开所在文件夹」：在资源管理器里显出那个文件；没记着路径的，开那个服务存下载的目录（Playwright 默认是工作目录下的 .playwright-mcp）
"use strict";
const fs = require("node:fs");
const { spawn, execFile } = require("node:child_process");
const os = require("node:os");
const { fasterSide, pickSource } = require("./mirror.js");
const path = require("node:path");
const { sendJson, readJson } = require("./http.js");

// 参数里哪一项都没写调试口时的默认（见 docs/stage.md：避开常被端口转发占着的 9222 / 9223）
const DEFAULT_PORT = 9288;

/** @param {unknown[]} raw MCP 服务的 args @param {string} [cwd] 服务的工作目录 @returns {{ port: number, dir: string, output: string }} */
function browserOf(raw, cwd = "") {
  const args = (Array.isArray(raw) ? raw : []).map(String);
  /** @param {string} name */
  const arg = name => {
    const at = args.indexOf(name);
    if (at >= 0) return args[at + 1] || "";
    return args.find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) || "";
  };
  let file = /** @type {any} */ ({});
  try {
    file = JSON.parse(fs.readFileSync(arg("--config"), "utf8")).browser || {};
  } catch {}
  const launch = (file.launchOptions?.args || []).map(String),
    endpoint = arg("--cdp-endpoint") || String(file.cdpEndpoint || ""),
    port =
      Number(endpoint.match(/:(\d+)/)?.[1]) ||
      Number(launch.find(item => item.startsWith("--remote-debugging-port="))?.split("=")[1]) ||
      DEFAULT_PORT;
  const output = arg("--output-dir") || String(file.outputDir || "") || (cwd ? path.join(cwd, ".playwright-mcp") : "");
  return { port, dir: arg("--user-data-dir") || String(file.userDataDir || ""), output: output && path.resolve(cwd || ".", output) };
}
// ---------- 接法由言补齐 ----------
// 游目要那个浏览器开着调试口、放行言的页面（与调试口自己——开发者工具的前端由它供出）、窗口挪到屏幕外。先前要人自己写一份 stage.json 挂在 --config 上，
// 漏一项就有一样不灵。言本就是起这个 MCP 服务的那一方：起它时把这几项补进去——在人原有的 --config 上合并（人写了的照人的），
// 合并好的写到存储根的「游目」目录里，参数里的 --config 换成它。认得的只有 Playwright 的 MCP；别的服务原样起
const PLAYWRIGHT = /@playwright[\\/]mcp|playwright-mcp|mcp-server-playwright/i;
/** @param {{ command?: string, args?: unknown[] }} config */
const isPlaywright = config => !!config?.command && PLAYWRIGHT.test([config.command, ...(config.args || [])].join(" "));
/**
 * @param {Record<string, any>} config MCP 服务的配置
 * @param {{ root: string, bridgePort: number }} where 存储根、桥接的端口
 * @returns {Record<string, any>} 要起的配置（不是 Playwright 的原样递回）
 */
function prepareBrowser(config, { root, bridgePort }) {
  if (!isPlaywright(config)) return config;
  const args = (config.args || []).map(String),
    cwd = String(config.cwd || ""),
    at = args.findIndex(item => item === "--config" || item.startsWith("--config=")),
    userFile = at < 0 ? "" : args[at] === "--config" ? args[at + 1] || "" : args[at].slice("--config=".length);
  /** @type {any} */
  let file = {};
  try {
    if (userFile) file = JSON.parse(fs.readFileSync(path.resolve(cwd || ".", userFile), "utf8")) || {};
  } catch {}
  const browser = (file.browser ||= {}),
    launch = (browser.launchOptions ||= {}),
    extra = (launch.args = (launch.args || []).map(String));
  // 接的是别处起好的浏览器（--cdp-endpoint）：它的启动参数言管不着，不补
  if (!args.includes("--cdp-endpoint") && !args.some(item => item.startsWith("--cdp-endpoint=")) && !browser.cdpEndpoint) {
    const given = extra.find(item => item.startsWith("--remote-debugging-port=")),
      port = Number(given?.split("=")[1]) || DEFAULT_PORT;
    if (!given) extra.push(`--remote-debugging-port=${port}`);
    const allow = extra.findIndex(item => item.startsWith("--remote-allow-origins=")),
      origins = new Set(allow < 0 ? [] : extra[allow].slice("--remote-allow-origins=".length).split(",").filter(Boolean));
    origins.add(`http://127.0.0.1:${bridgePort}`);
    origins.add(`http://127.0.0.1:${port}`);
    const line = `--remote-allow-origins=${[...origins].join(",")}`;
    allow < 0 ? extra.push(line) : (extra[allow] = line);
    // 无头的不必挪；人自己定了窗口位置的照人的
    if (!args.includes("--headless") && launch.headless !== true && !extra.some(item => item.startsWith("--window-position=")))
      extra.push("--window-position=-32000,-32000");
  }
  const dir = path.join(root, "游目"),
    out = path.join(dir, "playwright.json"),
    text = JSON.stringify(file, null, 2);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== text) fs.writeFileSync(out, text);
  } catch {
    return config;
  }
  const rest = at < 0 ? args : args.filter((_, i) => i !== at && !(args[at] === "--config" && i === at + 1));
  return { ...config, args: [...rest, "--config", out] };
}

/** @param {string} dir */
const bookmarksFile = dir => path.join(dir, "Default", "Bookmarks");

// ---------- 游目自己的浏览器 ----------
// 浏览器不再要人去 MCP 里接：设置 → 游目里开着，言自己起一个 Playwright 的 MCP 服务（名叫「游目」）。家当都在存储根的「游目」目录：
//   依赖/  @playwright/mcp 装在这里（npm install，一键）
//   浏览器/  登录状态、收藏（--user-data-dir）
//   下载/  下载落在这里（--output-dir）
//   内核/  本机没有 Edge / Chrome 时，Playwright 自带的那个浏览器装在这里（PLAYWRIGHT_BROWSERS_PATH）
//   playwright.json  接法（prepareBrowser 写的）
const BROWSERS = ["msedge", "chrome", "chromium"];
/** @param {string} root 存储根 */
function stageHome(root) {
  const home = path.join(root, "游目");
  return {
    home,
    deps: path.join(home, "依赖"),
    profile: path.join(home, "浏览器"),
    output: path.join(home, "下载"),
    engine: path.join(home, "内核"),
    cli: path.join(home, "依赖", "node_modules", "@playwright", "mcp", "cli.js")
  };
}
/**
 * 页面递来的是几项选择（{ browser }），这里拼成起服务的那一整条；家当一律落在「游目」目录，本机文件一律许开（执事做的网页要自己开来看）
 * @param {{ browser?: string }} stage
 * @param {string} root
 */
function builtinConfig(stage, root) {
  const at = stageHome(root),
    browser = BROWSERS.includes(String(stage?.browser)) ? String(stage.browser) : "msedge";
  return {
    command: process.execPath,
    args: [at.cli, "--browser", browser, "--user-data-dir", at.profile, "--output-dir", at.output, "--allow-unrestricted-file-access"],
    cwd: at.home,
    env: browser === "chromium" ? { PLAYWRIGHT_BROWSERS_PATH: at.engine } : {}
  };
}
/** 起 MCP 服务前：游目自己的那个先拼成整条，Playwright 的再补接法 @param {Record<string, any>} config @param {{ root: string, bridgePort: number }} where */
function prepareMcp(config, where) {
  if (!config?.stage) return prepareBrowser(config, where);
  const { stage, ...rest } = config,
    built = { ...rest, ...builtinConfig(stage, where.root) };
  try {
    const at = stageHome(where.root);
    for (const dir of [at.profile, at.output]) fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return prepareBrowser(built, where);
}
// 页面问调试口、收藏、下载目录时递来的那个服务：游目自己的递选择，别的递参数
/** @param {any} body @param {string} root @returns {{ args: unknown[], cwd: string }} */
function serviceOf(body, root) {
  if (body?.stage) {
    const built = builtinConfig(body.stage, root);
    return { args: built.args, cwd: built.cwd };
  }
  return { args: body?.args || [], cwd: String(body?.cwd || "") };
}
// 本机有哪几个浏览器：Edge、Chrome 看常见的安装处，自带内核看「内核」目录
function localBrowsers(root) {
  const env = process.env,
    has = (/** @type {string[]} */ list) => list.some(file => !!file && fs.existsSync(file)),
    pf = [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  let chromium = false;
  try {
    chromium = fs.readdirSync(stageHome(root).engine).some(name => name.startsWith("chromium-"));
  } catch {}
  return {
    msedge: has(pf.map(dir => path.join(String(dir), "Microsoft", "Edge", "Application", "msedge.exe"))),
    chrome: has(pf.map(dir => path.join(String(dir), "Google", "Chrome", "Application", "chrome.exe"))),
    chromium
  };
}
const MIRROR_HOST = "https://cdn.npmmirror.com/binaries/playwright";
/** 跑一下、拿它的标准输出 @returns {Promise<string>} */
const outputOf = (/** @type {string} */ file, /** @type {string[]} */ args, env = {}) =>
  new Promise(resolve =>
    execFile(file, args, { env: { ...process.env, ...env }, windowsHide: true, timeout: 20000 }, (_error, stdout) =>
      resolve(String(stdout || ""))
    )
  );
/**
 * 内核走哪个下载源：拿要下的那个文件本身两边比（见 mirror.js）——Playwright 新出的内核镜像要现去源站拉，
 * 拿常用包比的结果不作数
 * @param {string} cli playwright-core 的 cli.js @returns {Promise<Record<string, string>>} 装时添的环境变量
 */
async function engineHost(cli) {
  const mirror = (
    await outputOf(process.execPath, [cli, "install", "chromium", "--no-shell", "--dry-run"], { PLAYWRIGHT_DOWNLOAD_HOST: MIRROR_HOST })
  ).match(/Download url:\s*(\S+)/)?.[1];
  if (!mirror?.startsWith(MIRROR_HOST)) return { PLAYWRIGHT_DOWNLOAD_HOST: MIRROR_HOST };
  const { side } = await fasterSide(mirror, mirror.replace(MIRROR_HOST, "https://cdn.playwright.dev"));
  // 官方源不设变量：Playwright 自带几个备用地址，一个不通换下一个
  return side === "official" ? {} : { PLAYWRIGHT_DOWNLOAD_HOST: MIRROR_HOST };
}
// 装内核时多久没有一点进展算卡住：Playwright 每下完一成吐一行进度，正常的网一成十来秒；
// 测速那几秒两边都没测准（刚连上时常卡一下）就会挑错源，挑错了靠这个换另一个源重来
const STALL_MS = 90000;
/**
 * 跑一趟安装，跑完才回；吐出的「n% of」报给 onProgress
 * @param {string} file @param {string[]} args @param {Record<string, string>} env @param {string} cwd
 * @param {{ stall?: number, onProgress?: (percent: number) => void }} [options] stall：多久没有输出即结束它、以 stalled 退回
 * @returns {Promise<string>}
 */
function runInstall(file, args, env, cwd, { stall = 0, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    // npm 在 Windows 上是 .cmd，得经 shell 起；参数都是言自己写的，没有外来的字
    // 路径里有空格（D:\Program Files\npm.cmd）：经 shell 起时整条加引号
    const shell = /\.cmd$/i.test(file) || file === "npm",
      child = spawn(shell ? `"${file}"` : file, args, { cwd, env: { ...process.env, ...env }, shell, windowsHide: true });
    let tail = "",
      /** @type {NodeJS.Timeout | undefined} */ timer;
    const watch = () => {
      if (!stall) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        // 下载在它另起的子进程里，连根结束
        spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
        reject(Object.assign(Error("下载卡住了"), { stalled: true }));
      }, stall);
    };
    const keep = (/** @type {Buffer} */ chunk) => {
      tail = (tail + chunk.toString()).slice(-1200);
      const percent = [...chunk.toString().matchAll(/(\d+)% of/g)].at(-1)?.[1];
      if (percent) onProgress(Number(percent));
      watch();
    };
    watch();
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      code === 0 ? resolve(tail) : reject(Error(tail.trim().split("\n").slice(-3).join(" ") || `退出码 ${code}`));
    });
  });
}
// 装依赖或内核：在「游目」目录里跑 npm / playwright install，跑完才回。下载源自己挑（见 mirror.js）：
// 驱动随常用包比的结果，内核拿它自己比，下着卡住了再换另一个
/** @param {"deps" | "chromium"} what @param {string} root @param {(percent: number) => void} [onProgress] */
async function installStage(what, root, onProgress) {
  const china = what === "deps" && (await pickSource()) === "china";
  const at = stageHome(root);
  fs.mkdirSync(at.deps, { recursive: true });
  const pkg = path.join(at.deps, "package.json");
  if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ name: "yan-stage", private: true }, null, 2));
  const npm = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");
  const [file, args, env] =
    what === "deps"
      ? [
          fs.existsSync(npm) ? npm : "npm",
          [
            "install",
            "@playwright/mcp@latest",
            "--no-audit",
            "--no-fund",
            "--loglevel=error",
            ...(china ? ["--registry=https://registry.npmmirror.com"] : [])
          ],
          {}
        ]
      : [
          process.execPath,
          [path.join(at.deps, "node_modules", "playwright-core", "cli.js"), "install", "chromium", "--no-shell"],
          { PLAYWRIGHT_BROWSERS_PATH: at.engine }
        ];
  if (what !== "chromium") return runInstall(file, args, env, at.deps);
  if (!fs.existsSync(args[0])) throw Error("先装依赖，再装内核");
  const first = await engineHost(args[0]),
    other = first.PLAYWRIGHT_DOWNLOAD_HOST ? {} : { PLAYWRIGHT_DOWNLOAD_HOST: MIRROR_HOST };
  try {
    return await runInstall(file, args, { ...env, ...first }, at.deps, { stall: STALL_MS, onProgress });
  } catch (error) {
    if (!(/** @type {any} */ (error).stalled)) throw error;
    // 被结束的那一趟留着 Playwright 的目录锁，不清掉下一趟要干等它过期
    fs.rmSync(path.join(at.engine, "__dirlock"), { recursive: true, force: true });
    onProgress?.(0);
    return runInstall(file, args, { ...env, ...other }, at.deps, { stall: STALL_MS, onProgress });
  }
}
/** @param {string} root */
function stageState(root) {
  const at = stageHome(root);
  // 该有的目录先建好，「打开文件夹」总打得开
  try {
    for (const dir of [at.profile, at.output]) fs.mkdirSync(dir, { recursive: true });
  } catch {}
  let version = "";
  try {
    version = JSON.parse(fs.readFileSync(path.join(path.dirname(at.cli), "package.json"), "utf8")).version || "";
  } catch {}
  return {
    home: at.home,
    output: at.output,
    installed: fs.existsSync(at.cli),
    version,
    browsers: localBrowsers(root)
  };
}

/** @param {{ root?: () => string }} [options] 存储根（游目自己的浏览器在它底下） */
module.exports = function createStage({ root = () => "" } = {}) {
  async function locate(req, res) {
    const body = await readJson(req),
      service = serviceOf(body, root()),
      { port, dir, output } = browserOf(service.args, service.cwd);
    const marks = !!dir && fs.existsSync(bookmarksFile(dir));
    const get = path => fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) }).then(r => r.json());
    try {
      const [version, list] = await Promise.all([get("/json/version"), get("/json/list")]);
      // /json/list 按最近活动排，头一个页面即浏览器前台的那一页——多半就是模型正在用的
      sendJson(res, 200, {
        ws: version.webSocketDebuggerUrl || "",
        front: list.find(t => t.type === "page")?.id || "",
        port,
        marks,
        output
      });
    } catch {
      // 浏览器没开：不算错，页面等下一次
      sendJson(res, 200, { ws: "", port, marks, output });
    }
  }
  // 只回 id、名字、网址与夹的层次（改收藏时按 id 认），读不到就是空的
  async function bookmarks(req, res) {
    const service = serviceOf(await readJson(req), root()),
      { dir } = browserOf(service.args, service.cwd);
    /** @returns {any} */
    const slim = node =>
      node.type === "folder"
        ? { id: node.id, name: node.name, children: (node.children || []).map(slim) }
        : { id: node.id, name: node.name, url: node.url };
    try {
      const roots = JSON.parse(await fs.promises.readFile(bookmarksFile(dir), "utf8")).roots || {};
      sendJson(res, 200, {
        bar: (roots.bookmark_bar?.children || []).map(slim),
        other: (roots.other?.children || []).map(slim),
        barId: roots.bookmark_bar?.id,
        otherId: roots.other?.id
      });
    } catch {
      sendJson(res, 200, { bar: [], other: [] });
    }
  }
  // 设置 → 游目：家当在哪、依赖装没装、本机有哪几个浏览器
  async function home(req, res) {
    await readJson(req);
    const going = Object.keys(installing)[0] || "";
    sendJson(res, 200, { ...stageState(root()), installing: going, progress: progress[going] ?? null });
  }
  /** 正在装的：页面刷新后再点、或两处同点，跟着同一趟等，不另起一个（另起的会卡在 Playwright 的目录锁上干等） @type {Record<string, Promise<unknown>>} */
  const installing = {};
  /** 内核下到几成（页面装着时隔一会儿问一次） @type {Record<string, number>} */
  const progress = {};
  // 装依赖（@playwright/mcp）或自带内核：跑完才回，一两分钟
  async function install(req, res) {
    const body = await readJson(req),
      what = body.what === "chromium" ? "chromium" : "deps";
    try {
      await (installing[what] ||= installStage(what, root(), percent => (progress[what] = percent)).finally(() => {
        delete installing[what];
        delete progress[what];
      }));
      sendJson(res, 200, stageState(root()));
    } catch (error) {
      sendJson(res, 500, { error: `没装上：${String(/** @type {any} */ (error).message || error).slice(0, 300)}` });
    }
  }
  // 只收 http / https；测试里不真去开（YAN_NO_EXTERNAL）
  async function open(req, res) {
    const url = String((await readJson(req)).url || "");
    if (!/^https?:\/\//i.test(url)) return sendJson(res, 400, { error: "只有网页（http / https）能交给系统浏览器" });
    if (!process.env.YAN_NO_EXTERNAL)
      spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
    sendJson(res, 200, { ok: true });
  }
  // 只显出、不打开：下载来的可能是程序，开它要人自己在资源管理器里点
  async function reveal(req, res) {
    const body = await readJson(req),
      { path: file } = body,
      target = String(file || "");
    if (target && fs.existsSync(target)) {
      // 目录直接打开，文件在它所在的目录里选中
      const dir = fs.statSync(target).isDirectory();
      spawn("explorer.exe", [dir ? path.resolve(target) : `/select,${path.resolve(target)}`], { detached: true, stdio: "ignore" }).unref();
      return sendJson(res, 200, { ok: true });
    }
    const service = serviceOf(body, root()),
      { output } = browserOf(service.args, service.cwd);
    if (!output || !fs.existsSync(output)) return sendJson(res, 404, { error: "还没有下载过，或找不到存下载的目录" });
    spawn("explorer.exe", [output], { detached: true, stdio: "ignore" }).unref();
    sendJson(res, 200, { ok: true });
  }
  // 一回一个文件：{ name, data: dataURL } → 落盘的路径。一天前落的顺手清掉
  async function upload(req, res) {
    const { name, data } = await readJson(req),
      text = String(data || ""),
      comma = text.indexOf(","),
      root = path.join(os.tmpdir(), "yan-stage-upload");
    if (!text.startsWith("data:") || comma < 0) return sendJson(res, 400, { error: "文件内容无效" });
    try {
      for (const old of fs.readdirSync(root))
        if (Date.now() - Number(old.split("-")[0]) > 86400000) fs.rmSync(path.join(root, old), { recursive: true, force: true });
    } catch {}
    const dir = path.join(root, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      file = path.join(dir, path.basename(String(name || "文件")).replace(/[<>:"/\\|?*]/g, "_") || "文件");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(text.slice(comma + 1), /;base64/i.test(text.slice(0, comma)) ? "base64" : "utf8"));
    sendJson(res, 200, { path: file });
  }
  return {
    routes: {
      "POST /api/stage": locate,
      "POST /api/stage/bookmarks": bookmarks,
      "POST /api/stage/upload": upload,
      "POST /api/stage/reveal": reveal,
      "POST /api/stage/open": open,
      "POST /api/stage/home": home,
      "POST /api/stage/install": install
    }
  };
};
module.exports.browserOf = browserOf;
module.exports.prepareBrowser = prepareBrowser;
module.exports.prepareMcp = prepareMcp;
module.exports.builtinConfig = builtinConfig;
module.exports.installStage = installStage;
module.exports.stageState = stageState;
module.exports.isPlaywright = isPlaywright;
