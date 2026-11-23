// 言 · 看台：模型所用的那个浏览器（playwright 等以 --remote-debugging-port 起的 Edge / Chrome），页面直接连它的调试口看画面、递点按。
// 看画面时，桥接代问调试地址并给出首个页面目标；调试口的 /json 不给页面跨源读。
// 调试口与配置目录不另设：从那个 MCP 服务的参数里读——直接写在参数里的（--cdp-endpoint、--user-data-dir），或写在 --config 那份文件里的。
// 标签页、画面、输入由页面（src/26-stage/）直连处理；本模块还负责补接法、管理自带依赖与读收藏。
// 另读一份收藏：看台只转网页，浏览器自己的收藏栏看不到；收藏存在浏览器配置目录的 Default/Bookmarks 里。
// 纸签的「用系统浏览器打开」：交给系统默认的浏览器（经 url.dll，不经 cmd——网址里的 & 会被当成命令分隔）；游目显示不了的本机文件交给本机程序
// 下载签的「打开所在文件夹」：在资源管理器里显出那个文件；没记着路径的按名字找，再找不着开那个服务存下载的目录（Playwright 默认是工作目录下的 .playwright-mcp）
"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn, execFile } = require("node:child_process");
const { fasterSide, pickSource } = require("./mirror.js");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { sendJson, readJson, openWithSystem, sendFile } = require("./http.js");
const platform = require("./platform.js");
const { stylesAt } = require("./build.js");

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
    // --config 是相对路径时按服务的工作目录解析——起服务时（prepareBrowser）就是这么找的，
    // 两边基准得一致，不然页面问调试口时读不到那份配置，端口、配置目录、下载目录全回落
    const config = arg("--config");
    if (config) file = JSON.parse(fs.readFileSync(path.resolve(cwd || ".", config), "utf8")).browser || {};
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
// 漏一项就有一样不灵。言本就是起这个 MCP 服务的那一方：起它时把这几项补进去——在人原有的 --config 上合并（保留既有选项，并补游目必需的项），
// 合并好的写到存储根的「游目」目录里，参数里的 --config 换成它。认得的只有 Playwright 的 MCP；别的服务原样起
const PLAYWRIGHT = /@playwright[\\/]mcp|playwright-mcp|mcp-server-playwright/i;
/** @param {{ command?: string, args?: unknown[] }} config */
const isPlaywright = config => !!config?.command && PLAYWRIGHT.test([config.command, ...(config.args || [])].join(" "));
/**
 * @param {Record<string, any>} config MCP 服务的配置
 * @param {{ root: string, bridgePort: number, offscreen?: (port: number) => void }} where 存储根、桥接的端口；offscreen：窗口由言挪到屏幕外时告知调试口（桥接据此让它不占任务栏，见 server/taskbar.js）
 * @returns {Record<string, any>} 要起的配置（不是 Playwright 的原样递回）
 */
function prepareBrowser(config, where) {
  const { root, bridgePort } = where;
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
    // 服务退出可能连浏览器一并结束；原生恢复气泡不在游目的网页画面里，不能让它挡着下次打开。
    if (!extra.includes("--hide-crash-restore-bubble")) extra.push("--hide-crash-restore-bubble");
    // 无头的不必挪；人自己定了窗口位置的照人的
    if (!args.includes("--headless") && launch.headless !== true && !extra.some(item => item.startsWith("--window-position="))) {
      extra.push("--window-position=-32000,-32000");
      where.offscreen?.(port);
    }
  }
  // 模型的浏览器开不了言自己：页面能改设置，开了就能关审查、改权限，等于自己给自己松绑。与指令不调桥接同理（sandbox.js）。
  // 只列这两个名字：桥接只听 127.0.0.1，也只认这两个 Host（server.js 的 trustedHost）。挡的是开页与跳转，不挡 run_code 里直发的请求，那条与 node -e 一样不往下堵
  // 结果里的文件（下载、快照、截图）写全路径：相对的是相对服务的工作目录，模型拿自己的工具找不着，下载签也显不出那个文件。人写了的照人的
  file.filePaths ??= "absolute";
  const network = (file.network ||= {});
  network.blockedOrigins = [
    ...new Set([...(network.blockedOrigins || []), `http://127.0.0.1:${bridgePort}`, `http://localhost:${bridgePort}`])
  ];
  // 按内容取名：同时起几个 Playwright 服务（游目自带的、人另接的），各读各的；同一份接法才共用一个文件
  const text = JSON.stringify(file, null, 2),
    dir = path.join(root, "游目"),
    out = path.join(dir, `playwright-${crypto.createHash("sha1").update(text).digest("hex").slice(0, 8)}.json`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== text) fs.writeFileSync(out, text);
  } catch (error) {
    // 接法写不成时不能退回人写的那一份：它没有 blockedOrigins，模型的浏览器就能打开言、改权限、关审查（11-03 那次），
    // 而页面看不出任何差别。宁可这个服务起不来，让 /api/mcp/list 把原因报出来（盘满、根在只读位置、游目被同名文件占着）
    throw Error(
      `游目的浏览器接法写不进 ${dir}（${error.message}）：缺了它，模型能在浏览器里打开言改设置，故不降级启动；腾出位置或改存储根后重试`
    );
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
//   下载/  下载落在这里（--output-dir）。Playwright 自己起名的过程文件（页面快照、控制台记录、没给名的截图）也可落这里；符合过程文件命名且修改已超过一天的，在指定入口顺手清（见 sweepOutputs）
//   工作/  服务的工作目录：模型给了名字的截图、存下的页面落在这里，不与言自己的家当混着
//   内核/  选「自带内核」用的 Chromium 装在这里（PLAYWRIGHT_BROWSERS_PATH），不是 Edge / Chrome 启动失败后的兜底
//   playwright-*.json  接法（prepareBrowser 写的，按内容取名）
const BROWSERS = ["msedge", "chrome", "chromium"];
/** @param {string} root 存储根 */
function stageHome(root) {
  const home = path.join(root, "游目");
  return {
    home,
    deps: path.join(home, "依赖"),
    profile: path.join(home, "浏览器"),
    output: path.join(home, "下载"),
    work: path.join(home, "工作"),
    engine: path.join(home, "内核"),
    cli: path.join(home, "依赖", "node_modules", "@playwright", "mcp", "cli.js")
  };
}
// 自带服务准备接法、或显出下载目录的兜底分支才扫：只按顶层名字和修改时间认过程文件，不查来源或引用。
// 名字形如「前缀-ISO 时刻.扩展名」（时刻里的 : 与 . 换成 -）；download- 打头的不算。
const AUTO_OUTPUT = /^(?!download-)[a-z]+(?:-[a-z]+)*-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.[a-z0-9]+$/,
  OUTPUT_GRACE_MS = 24 * 60 * 60 * 1000;
/** @param {string} dir 存下载的目录 @param {RegExp} [pattern] 只清名字合这一式的（默认照过程文件的规矩） */
function sweepOutputs(dir, pattern = AUTO_OUTPUT) {
  const cutoff = Date.now() - OUTPUT_GRACE_MS;
  try {
    for (const name of fs.readdirSync(dir))
      if (pattern.test(name))
        try {
          const file = path.join(dir, name);
          if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
        } catch {}
  } catch {}
}
// ---------- 本机文档摊在游目里看 ----------
// 浏览器只会把 Office 文档当下载：人点开一个 docx，只落得本机 Word 弹出窗口，在游目里看不见内容。要看内容就得把言的抽取搬过来——
// 页面取原件（raw）、用与预览同一套抽正文（src/13-files/30-extract.js），正文交给 docpage；这里包成一份自足的文档页落进 工作/，
// 页面再以 file:// 打开。样式取自言自己的 styles/，与言里的预览同一副样子，改一处两处都变。
// 只认下面六种：抽得出正文的现代 Office 与 ODF。旧格式 doc/xls/ppt 抽不出、压缩包也无正文，仍交本机程序。
// raw 是个窄口——页面万一被人借手，也只读得走这六种，读不到密钥、配置这类东西
const DOC_VIEWABLE = new Set([".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".ipynb"]),
  DOCPAGE_STYLES = ["00-base.css", "30-chat/40-markdown.css", "85-components.css"],
  // 摊开的文档页的名字（docpage 写的那一份）。工作/ 里还落着模型给人起的名字（报告、截图），清理只认这一式
  DOCPAGE_FILE = /^view-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.html$/,
  DOC_RAW_MAX = 256 * 1024 * 1024;
// 进 HTML 的两处（题名、链接）照规矩逃掉
const escapeHtml = (/** @type {string} */ text) =>
  String(text || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
// 文档页的壳：一张素纸铺满整屏，窗外是案。纸上不加纸纹——纸纹是预览浮层那张小纸的（.file-viewer-text 的 background），
// 整屏读的时候嫌花；正文照文档排法 16px / 1.8，浮层那份是 14px / 1.85（窄纸密排），铺满整屏读着吃力。
// 版心仍是 860：纸 860 + 两侧各 40 的内边距。
// 正文里那颗「以本机程序打开」在这儿换成指向原件的链接：独立页里没有预览浮层那套事件，按钮点了没谁接；
// 链接反倒真能用——点了仍是「人开的本机文件」，页面那头照样消掉下载、交本机程序
/** @param {string} name @param {string} inner @param {string} [href] 原件的 file: 地址 */
function docPageHtml(name, inner, href = "") {
  const title = escapeHtml(name),
    // 认两种写法：页面里写的是不带值的 data-viewer-open，过了 innerHTML 会补成 data-viewer-open=""
    nonce = crypto.randomBytes(16).toString("base64"),
    body = href
      ? inner.replace(
          /<button type="button" class="viewer-open-link" data-viewer-open(?:="[^"]*")?>([^<]*)<\/button>/g,
          (_, text) => `<a href="${escapeHtml(href)}">${text}</a>`
        )
      : inner;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>${title}</title>
<style>
${stylesAt(DOCPAGE_STYLES)}
/* ---- 文档页自补的一层：纸面 ---- */
html { height: 100%; }
body.docpage { margin: 0; min-height: 100%; overflow: auto; background: var(--paper-2); color: var(--ink); font-family: var(--body); -webkit-font-smoothing: antialiased; }
.docpage-paper { box-sizing: border-box; max-width: 940px; min-height: 100vh; margin: 0 auto; padding: 44px 40px 80px; background: var(--paper); }
.docpage .file-viewer-text { box-sizing: border-box; width: 100%; min-height: 0; padding: 0; border: 0; background: none; font-size: 16px; line-height: 1.8; }
.docpage .file-viewer-text > .file-viewer-note:first-child { margin-top: 0; }
.docpage .viewer-tabs { margin: 0 0 14px; }
/* 工作表页签要真把别的表收起来：.hidden 那条规则在设置页那一片（styles/70-settings/30-panels.css），文档页没带它 */
.docpage .hidden { display: none !important; }
.docpage a { overflow-wrap: anywhere; }
</style>
</head>
<body class="docpage">
<main class="docpage-paper">
${body}
</main>
<script nonce="${nonce}">
// 工作表的页签：文档页里没有预览浮层那套事件，就地绑一份（只这一件事，别的照旧不动）
document.addEventListener("click", event => {
  const tab = event.target.closest("[data-viewer-tab]");
  if (!tab) return;
  const box = tab.closest(".file-viewer-wide") || document;
  for (const one of box.querySelectorAll("[data-viewer-tab]")) one.classList.toggle("active", one === tab);
  for (const panel of box.querySelectorAll("[data-viewer-panel]")) panel.classList.toggle("hidden", panel.dataset.viewerPanel !== tab.dataset.viewerTab);
});
</script>
</body>
</html>
`;
}
// 下载存成的名字：Playwright 按浏览器给的名存，名里的 ASCII 符号与空格换成 -（照它的 sanitizeForFilePath）
/** @param {string} name */
function savedName(name) {
  const clean = (/** @type {string} */ text) => text.replace(/[\x00-\x2C\x2E-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F]+/g, "-"),
    dot = name.lastIndexOf(".");
  return dot < 0 ? clean(name) : `${clean(name.slice(0, dot))}.${clean(name.slice(dot + 1))}`;
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
    cwd: at.work,
    env: browser === "chromium" ? { PLAYWRIGHT_BROWSERS_PATH: at.engine } : {}
  };
}
/** 起 MCP 服务前：游目自己的那个先拼成整条，Playwright 的再补接法 @param {Record<string, any>} config @param {{ root: string, bridgePort: number, offscreen?: (port: number) => void }} where */
function prepareMcp(config, where) {
  if (!config?.stage) return prepareBrowser(config, where);
  const { stage, ...rest } = config,
    built = { ...rest, ...builtinConfig(stage, where.root) };
  const at = stageHome(where.root);
  try {
    for (const dir of [at.profile, at.output, at.work]) fs.mkdirSync(dir, { recursive: true });
  } catch {}
  sweepOutputs(at.output);
  // 摊开的文档页（view-*.html）照同一条规矩清：一天后的不再有用。只认这一式——工作/ 是模型给人存东西的地方，别的一件不动
  sweepOutputs(at.work, DOCPAGE_FILE);
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
// 本机有哪几个浏览器：Edge、Chrome 看常见的安装处，自带内核看「内核」目录。
// 内核认版本：驱动要的是 playwright-core 的 browsers.json 里那一版（chromium-<revision>）。更新驱动后要的版本常变，
// 旧版留在目录里也起不来——只看有没有 chromium-* 会报「已安装」，点开却是 Playwright 的「未安装」
function localBrowsers(root) {
  const has = (/** @type {string[]} */ list) => list.some(file => !!file && fs.existsSync(file)),
    files = platform.browserFiles(),
    at = stageHome(root);
  let chromium = false;
  try {
    const { browsers } = JSON.parse(fs.readFileSync(path.join(at.deps, "node_modules", "playwright-core", "browsers.json"), "utf8"));
    const revision = browsers.find((/** @type {any} */ item) => item.name === "chromium")?.revision;
    chromium = !!revision && fs.existsSync(path.join(at.engine, `chromium-${revision}`));
  } catch {}
  return {
    msedge: has(files.msedge),
    chrome: has(files.chrome),
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
// 装内核时多久没有一点进展算卡住：测速那几秒两边都没测准（刚连上时常卡一下）就会挑错源，挑错了靠这个换另一个源重来。
// 进展看下载的那个文件长没长，不只看输出：Playwright 每下完一成才吐一行，慢的线（一百来 KB/s）一成要两三分钟，
// 只看输出会把下着的当卡住，两个源都掐掉（11-08 实测）
const STALL_MS = 90000;
/** @param {string} dir @returns {number} 目录里（连子目录）文件的总字节 */
function bytesIn(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true }))
      if (entry.isFile()) total += fs.statSync(path.join(entry.parentPath, entry.name)).size;
  } catch {}
  return total;
}
/**
 * 跑一趟安装，跑完才回；吐出的「n% of」报给 onProgress
 * @param {string} file @param {string[]} args @param {Record<string, string>} env @param {string} cwd
 * @param {{ stall?: number, grows?: string, onProgress?: (percent: number) => void }} [options]
 *   stall：多久没有进展即结束它、以 stalled 退回；grows：下载落在这个目录里，里头的文件在长也算进展
 * @returns {Promise<string>}
 */
function runInstall(file, args, env, cwd, { stall = 0, grows = "", onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    // npm 在 Windows 上是 .cmd，得经 shell 起；参数都是言自己写的，没有外来的字
    // 路径里有空格（D:\Program Files\npm.cmd）：经 shell 起时整条加引号
    const shell = /\.cmd$/i.test(file) || file === "npm",
      child = spawn(shell ? `"${file}"` : file, args, {
        cwd,
        env: { ...process.env, ...env },
        shell,
        windowsHide: true,
        ...platform.OWN_GROUP
      });
    let tail = "",
      /** @type {NodeJS.Timeout | undefined} */ timer;
    const watch = () => {
      if (!stall) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        clearInterval(meter);
        // 下载在它另起的子进程里，连根结束
        platform.killTree(child);
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
    let size = 0;
    const meter =
      stall && grows
        ? setInterval(() => {
            const now = bytesIn(grows);
            if (now !== size) watch();
            size = now;
          }, 3000)
        : undefined;
    const done = () => {
      clearTimeout(timer);
      clearInterval(meter);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", error => {
      done();
      reject(error);
    });
    child.on("close", code => {
      done();
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
  // Playwright 把压缩包下到系统临时目录下另起的一格里：给它一个言自己的临时目录，好看下着的文件长没长；装完连同半截的包一起清掉
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yan-engine-")),
    run = (/** @type {Record<string, string>} */ host) =>
      runInstall(file, args, { ...env, ...host, TEMP: tmp, TMP: tmp, TMPDIR: tmp }, at.deps, {
        stall: STALL_MS,
        grows: tmp,
        onProgress
      }).catch(error => {
        // 被结束的那一趟留着 Playwright 的目录锁，不清掉下一趟（换源重来、或人再点一次）要干等它过期
        if (error.stalled) fs.rmSync(path.join(at.engine, "__dirlock"), { recursive: true, force: true });
        throw error;
      });
  try {
    return await run(first);
  } catch (error) {
    if (!(/** @type {any} */ (error).stalled)) throw error;
    onProgress?.(0);
    return await run(other);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
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
    const get = path =>
      fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) }).then(r => /** @type {any} */ (r.json()));
    try {
      const [version, list] = await Promise.all([get("/json/version"), get("/json/list")]);
      // 借 /json/list 的首个 page 作为页面选项的提示，不另查浏览器实际前台
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
  // 装依赖（@playwright/mcp）或自带内核：等安装结束再回
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
  // 网页交给系统浏览器；本机文件（游目显示不了、浏览器要当下载的）交给本机程序，可执行的不开。测试里不真去开（YAN_NO_EXTERNAL）
  async function open(req, res) {
    const url = String((await readJson(req)).url || "");
    if (/^file:\/\//i.test(url)) {
      try {
        if (!process.env.YAN_NO_EXTERNAL) openWithSystem(fileURLToPath(url));
      } catch (error) {
        return sendJson(res, 400, { error: String(/** @type {any} */ (error).message || error) });
      }
      return sendJson(res, 200, { ok: true });
    }
    if (!/^https?:\/\//i.test(url)) return sendJson(res, 400, { error: "只有网页（http / https）能交给系统浏览器" });
    if (!process.env.YAN_NO_EXTERNAL) platform.openUrl(url);
    sendJson(res, 200, { ok: true });
  }
  // 原件直取：GET /api/stage/raw?url=file:///…，页面抽正文用。Office/ODF 六种加 ipynb（#169）、只认盘上的普通文件：
  // 路径从 file: 地址解出来；在碰文件系统前先挡掉远程主机与 UNC。
  async function raw(req, res) {
    let file = "";
    try {
      const url = new URL(new URL(req.url, "http://127.0.0.1").searchParams.get("url") || "");
      // WHATWG 已把 file://localhost 归为无主机名；Windows 对其余主机名会解成 UNC，而不是拒绝。
      if (url.hostname) throw Error("Not local");
      file = fileURLToPath(url);
      if (/^[\\/]{2}/.test(file)) throw Error("Not local");
    } catch {
      return sendJson(res, 400, { error: "只认本机文件的地址" });
    }
    // 名字叫 .docx、实际链到别处去的（符号链接、快捷方式）：按真正要读的那一份再认一遍，这个口只保证读得走这六种
    const real = await fs.promises.realpath(file).catch(() => "");
    if (!real || /^[\\/]{2}/.test(real) || !DOC_VIEWABLE.has(path.extname(real).toLowerCase()))
      return sendJson(res, 400, { error: "这一类文档摊不开" });
    const stat = await fs.promises.stat(real).catch(() => null);
    if (!stat?.isFile()) return sendJson(res, 404, { error: "文件不在了" });
    if (stat.size > DOC_RAW_MAX) return sendJson(res, 413, { error: "这件太大，摊不开" });
    try {
      await sendFile(req, res, real, { name: path.basename(file) });
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: String(/** @type {any} */ (error)?.message || error) });
    }
  }
  // 把页面抽好的正文包成一份文档页，落进 工作/（名字照过程文件的规矩，一天后由 sweepOutputs 清），回它的 file: 地址。
  // 只收预览器那几层正文容器：这个口只用来摊文档，别的东西不往盘上写
  async function docpage(req, res) {
    const body = await readJson(req).catch(() => ({})),
      inner = String(/** @type {any} */ (body).body || "");
    if (!/^<div class="file-viewer-(text|slides)/.test(inner)) return sendJson(res, 400, { error: "只收本机抽出来的正文" });
    const work = stageHome(root()).work,
      file = path.join(work, `view-${new Date().toISOString().replace(/[:.]/g, "-")}.html`);
    // 原件地址只作那颗「以本机程序打开」的去处：收它但只当链接写进去
    const href = /^file:\/\//i.test(String(/** @type {any} */ (body).url || "")) ? String(/** @type {any} */ (body).url) : "";
    try {
      fs.mkdirSync(work, { recursive: true });
      sweepOutputs(work, DOCPAGE_FILE);
      fs.writeFileSync(file, docPageHtml(String(/** @type {any} */ (body).name || ""), inner, href), "utf8");
    } catch (error) {
      return sendJson(res, 500, { error: `写不成文档页：${String(/** @type {any} */ (error)?.message || error).slice(0, 200)}` });
    }
    sendJson(res, 200, { url: pathToFileURL(file).href });
  }
  // 只显出、不打开：下载来的可能是程序，开它要人自己在资源管理器里点。
  // 没记着路径的（人点的下载，之后执事没再动手，结果里没报存到哪）按名字在存下载的目录里找；找不着才开整个目录
  async function reveal(req, res) {
    const body = await readJson(req),
      service = serviceOf(body, root()),
      { output } = browserOf(service.args, service.cwd),
      name = path.basename(String(body.name || "")),
      target = [String(body.path || ""), ...(output && name ? [path.join(output, name), path.join(output, savedName(name))] : [])].find(
        file => file && fs.existsSync(file)
      );
    if (target) {
      platform.reveal(target);
      return sendJson(res, 200, { ok: true });
    }
    if (!output || !fs.existsSync(output)) return sendJson(res, 404, { error: "还没有下载过，或找不到存下载的目录" });
    if (body.stage) sweepOutputs(output);
    platform.openPath(output);
    sendJson(res, 200, { ok: true });
  }
  return {
    routes: {
      "POST /api/stage": locate,
      "POST /api/stage/bookmarks": bookmarks,
      "POST /api/stage/reveal": reveal,
      "POST /api/stage/open": open,
      "POST /api/stage/docpage": docpage,
      "GET /api/stage/raw": raw,
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
module.exports.sweepOutputs = sweepOutputs;
module.exports.docPageHtml = docPageHtml;
module.exports.DOC_VIEWABLE = DOC_VIEWABLE;
module.exports.DOCPAGE_FILE = DOCPAGE_FILE;
module.exports.savedName = savedName;
