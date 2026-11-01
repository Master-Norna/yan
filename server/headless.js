// 言 · 桥接 · 检索与翻网页用的无头浏览器：直接请求被搜索引擎认作脚本（回答非所问的十条）、网页要跑脚本才出内容、站点拒了直接请求时，
// 交给它像人一样开一页再取。用本机的 Edge / Chrome（server/platform.js 找），配置目录在系统临时目录（server.js 定），Cookie 留着、像常客。
// 按需才起，闲三分钟即关；与游目的浏览器无关（那个归 Playwright 起、归执事用）。
// 每一页的请求都经 Fetch 拦一道：图、媒体、字体不取（只要字），其余照地址门禁逐个查——跳转、页里脚本发的请求都算，打不到本机与内网。
// WebSocket 不经 Fetch，这一路拦不住；页面的脚本只能盲发、读不到回话，且本机桥接与游目的调试口都只认自己的来源，不在此另设一道
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { browserFiles, killTree, killTreeSync, OWN_GROUP } = require("./platform.js");
const createPublicProxy = require("./headless-proxy.js");

const MAX_TABS = 3,
  IDLE_MS = 3 * 60 * 1000,
  HTML_LIMIT = 3 * 1024 * 1024,
  SKIPPED = new Set(["Image", "Media", "Font"]);
let home = () => null,
  current = null,
  starting = null,
  idleTimer = null,
  busy = 0;
const waiting = [];

function configure(options) {
  home = options.home;
}
function executable() {
  const files = browserFiles();
  for (const name of ["msedge", "chrome"]) {
    const hit = files[name].find(file => fs.existsSync(file));
    if (hit) return hit;
  }
  return null;
}
// 本机没有 Edge / Chrome 的（Mac 上可能），这一路就不走
function available() {
  return !!home() && !!executable();
}

// 一条连到浏览器的 WebSocket，各页以 flatten 的会话挂在上面
function connect(endpoint) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint),
      pending = new Map(),
      listeners = new Map();
    let seq = 0;
    const browser = {
      ws,
      send(method, params = {}, sessionId) {
        if (ws.readyState !== 1) return Promise.reject(Error("浏览器已断开"));
        const id = ++seq;
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((ok, fail) => pending.set(id, { ok, fail }));
      },
      listen(sessionId, handler) {
        listeners.set(sessionId, handler);
        return () => listeners.delete(sessionId);
      }
    };
    ws.onopen = () => resolve(browser);
    ws.onerror = () => reject(Error("连不上浏览器的调试口"));
    ws.onmessage = ({ data }) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message.id) {
        const call = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) call?.fail(Error(message.error.message));
        else call?.ok(message.result);
      } else if (message.sessionId)
        try {
          listeners.get(message.sessionId)?.(message);
        } catch {}
    };
    ws.onclose = () => {
      for (const call of pending.values()) call.fail(Error("浏览器已断开"));
      pending.clear();
      if (current?.ws === ws) current = null;
    };
  });
}

// 上回桥接没收拾就退了的浏览器还占着这个配置目录：新起的会把参数转交给它、自己退出。先照它留下的 DevToolsActivePort 接回去
async function adopt(dir) {
  try {
    const [port, route] = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/);
    if (!/^\d+$/.test(port) || !route?.startsWith("/devtools/browser/")) return null;
    return await connect(`ws://127.0.0.1:${port}${route}`);
  } catch {
    return null;
  }
}
async function launch() {
  const file = executable(),
    dir = home();
  if (!file || !dir) throw Error("本机没有 Edge 或 Chrome");
  fs.mkdirSync(dir, { recursive: true });
  const adopted = await adopt(dir);
  if (adopted) {
    // 旧实例的代理属于上回桥接，不能接着用；先让 Cookie 落盘，再带这次的代理重新起。
    await adopted.send("Browser.close").catch(() => {});
    adopted.ws.close();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const proxy = await createPublicProxy();
  const child = spawn(
    file,
    [
      "--headless=new",
      `--proxy-server=${proxy.url}`,
      "--proxy-bypass-list=<-loopback>",
      "--edge-skip-compat-layer-relaunch",
      "--remote-debugging-port=0",
      `--user-data-dir=${dir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disk-cache-size=33554432",
      "--mute-audio",
      "about:blank"
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, ...OWN_GROUP }
  );
  const endpoint = await new Promise((resolve, reject) => {
    let said = "",
      done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(Error("浏览器 15 秒没起来")), 15000);
    // 一直读着：管道满了浏览器会卡在写日志上
    child.stderr.on("data", chunk => {
      if (done) return;
      said += chunk;
      const hit = said.match(/DevTools listening on (ws:\/\/\S+)/);
      if (hit) finish(null, hit[1]);
    });
    child.once("error", error => finish(error));
    child.once("exit", code => finish(Error(`浏览器起来就退了（${code}）`)));
  }).catch(error => {
    proxy.close();
    killTree(child);
    throw error;
  });
  const browser = await connect(endpoint).catch(error => {
    proxy.close();
    killTree(child);
    throw error;
  });
  child.once("exit", () => proxy.close());
  browser.ws.addEventListener("close", () => proxy.close());
  return Object.assign(browser, { child, proxy });
}
async function ensure() {
  if (current) return current;
  starting ||= launch().finally(() => (starting = null));
  current = await starting;
  // 无头的 UA 里写着 HeadlessChrome，有的站一眼认出：换回平常的写法
  current.userAgent ||= String((await current.send("Browser.getVersion")).userAgent).replace("HeadlessChrome", "Chrome");
  return current;
}
// 关之前先 Browser.close：让它把 Cookie 落了盘再走
function shutdown() {
  const browser = current;
  current = null;
  if (!browser) return;
  browser.send("Browser.close").catch(() => {});
  setTimeout(() => {
    try {
      browser.ws.close();
    } catch {}
    killTree(browser.child);
  }, 2000).unref?.();
}
process.on("exit", () => killTreeSync(current?.child));

// 至多同开三页；排着的直接接过腾出的那一格，不另计数
async function acquire() {
  clearTimeout(idleTimer);
  if (busy < MAX_TABS) busy++;
  else await new Promise(resolve => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) return next();
  if (--busy) return;
  idleTimer = setTimeout(shutdown, IDLE_MS);
  idleTimer.unref?.();
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// 开一页、等它出内容、取回整页 HTML。gate 是地址门禁（web.js 的 assertPublicUrl），不过的请求一律不发。
// waitFor：等这个选择器出现（检索结果页，不必等整页载完）；不给就等载完、再等正文字数停住不涨（要跑脚本才出内容的页）
/** @param {string} url @param {{ gate?: (url: URL) => Promise<unknown>, waitFor?: string, timeout?: number }} [options] */
async function render(url, { gate, waitFor = "", timeout = 20000 } = {}) {
  const deadline = Date.now() + timeout;
  await acquire();
  try {
    const browser = await ensure(),
      { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    try {
      const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true }),
        send = (method, params) => browser.send(method, params, sessionId);
      let loaded = null;
      const onLoad = new Promise(resolve => (loaded = resolve));
      const unlisten = browser.listen(sessionId, ({ method, params }) => {
        if (method === "Page.loadEventFired") loaded();
        if (method !== "Fetch.requestPaused") return;
        const { requestId, request, resourceType } = params,
          refuse = () => send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
        if (SKIPPED.has(resourceType)) return void refuse();
        let target;
        try {
          target = new URL(request.url);
        } catch {
          return void refuse();
        }
        gate(target).then(() => send("Fetch.continueRequest", { requestId }).catch(() => {}), refuse);
      });
      try {
        await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
        await send("Emulation.setUserAgentOverride", { userAgent: browser.userAgent, acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.7" });
        await send("Page.enable");
        const navigation = await send("Page.navigate", { url });
        if (navigation.errorText) throw Error(`网页打不开（${navigation.errorText}）`);
        const probe = async expression =>
          (await send("Runtime.evaluate", { expression, returnByValue: true }).catch(() => null))?.result?.value;
        if (waitFor) {
          const check = `!!document.querySelector(${JSON.stringify(waitFor)})`;
          while (Date.now() < deadline && !(await probe(check))) await pause(200);
        } else {
          // load 迟迟不来的（长连接、广告位）不死等：至多十秒，之后看字数
          await Promise.race([onLoad, pause(Math.max(0, Math.min(10000, deadline - Date.now())))]);
          let last = -1;
          for (;;) {
            const size = Number(await probe("document.body ? document.body.innerText.length : 0")) || 0;
            if ((size === last && size > 0) || Date.now() + 500 > deadline) break;
            last = size;
            await pause(500);
          }
        }
        const page = await probe(
          `({ html: document.documentElement.outerHTML.slice(0, ${HTML_LIMIT}), url: location.href, title: document.title })`
        );
        if (!page) throw Error("没能取回网页内容");
        return page;
      } finally {
        unlisten();
      }
    } finally {
      browser.send("Target.closeTarget", { targetId }).catch(() => {});
    }
  } finally {
    release();
  }
}

module.exports = { configure, available, render };
