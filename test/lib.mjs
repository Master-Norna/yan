// 端到端用例共用的一小套工具：连上无头浏览器的调试口、在页面里求值、等待条件、记一条 PASS / FAIL
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DEBUG = "http://127.0.0.1:9333";
export const STAGE_DEBUG_PORT = 9334;
export const MODEL_DEBUG = `http://127.0.0.1:${STAGE_DEBUG_PORT}`;
export const PAGE = "http://127.0.0.1:8799/";
export const TMP = path
  .join(path.dirname(fileURLToPath(import.meta.url)), ".tmp")
  .split(path.sep)
  .join("/");
export const WORK = `${TMP}/work`;
// 测试桥接的存储根（YAN_HOME）：对话、卷宗、配置都在这里
export const HOME = `${TMP}/.yan`;
export const ARCHIVE = `${HOME}/卷宗`;
export const CHATS = `${HOME}/对话`;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const check = (label, ok, detail = "") => console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
// 用量簿（存储根/用量.json）里某一类各日之和：页面攒几秒才报给桥接，等它报上来（见 src/16-api.js 的 noteUsage）
export async function usageOf(kind, timeout = 8000) {
  const started = Date.now();
  for (;;) {
    let n = 0;
    try {
      n = Object.values(JSON.parse(readFileSync(`${HOME}/用量.json`, "utf8")).days || {}).reduce(
        (sum, row) => sum + (Number(row[kind]) || 0),
        0
      );
    } catch {}
    if (n > 0 || Date.now() - started > timeout) return n;
    await sleep(300);
  }
}

export async function connect() {
  let ws,
    seq = 0;
  const pending = new Map();
  const raw = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  // 开页、刷新后等页面开好（boot 末尾 bindEvents 绑上点击）再交回：侧栏读完磁盘就先画出来，事件要等问过租约才绑上，
  // CI 的机器慢，固定等一两秒常常还没好，先点就白点。Page.reload 还不等新页接手就返回，紧接着求值会落在旧页上，所以先在旧页记一笔。
  // 开不好（桥接没起之类）的等满就照旧往下，由用例自己断言
  const send = async (method, params = {}) => {
    const isNavigate = method === "Page.navigate";
    const targetUrl = isNavigate ? String(params.url || "") : "";
    const onPage = isNavigate && targetUrl.startsWith(PAGE);
    const isHtml = onPage && /\.html\b/.test(targetUrl.slice(PAGE.length));
    const app =
      method === "Page.reload"
        ? await evalJs(`location.href.startsWith(${JSON.stringify(PAGE)}) && !location.pathname.endsWith(".html")`).catch(() => false)
        : onPage && !isHtml;
    if (!app && !isHtml) return raw(method, params);
    await evalJs(`window.__leaving = true`).catch(() => {});
    const result = await raw(method, params);
    // 换页那一下求值可能撞上旧的执行上下文刚销毁：报错当作没好，接着等
    for (const t = Date.now(); Date.now() - t < 15000; await sleep(120)) {
      const ready = isHtml
        ? await evalJs(`!window.__leaving && document.readyState === "complete" && location.href === ${JSON.stringify(targetUrl)}`).catch(
            () => false
          )
        : await evalJs(`!window.__leaving && typeof document.querySelector("#openLibrary")?.onclick === "function"`).catch(() => false);
      if (ready) break;
    }
    return result;
  };
  const evalJs = async (expression, awaitPromise = true) => {
    const r = await raw("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const waitFor = async (expression, timeout = 20000) => {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      if (await evalJs(expression)) return true;
      await sleep(120);
    }
    throw Error("timeout: " + expression);
  };
  const shot = async name => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    mkdirSync(TMP, { recursive: true });
    writeFileSync(`${TMP}/${name}`, Buffer.from(data, "base64"));
  };
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(DEBUG + "/json/version");
      break;
    } catch {
      await sleep(250);
    }
  }
  const targets = await (await fetch(DEBUG + "/json")).json();
  const page = targets.find(t => t.type === "page") || (await (await fetch(DEBUG + "/json/new?about:blank", { method: "PUT" })).json());
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown")
      console.log("  [exception]", JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type))
      console.log(
        `  [console.${m.params.type}]`,
        m.params.args
          .map(a => a.value ?? a.description)
          .join(" ")
          .slice(0, 300)
      );
  };
  await send("Page.enable");
  // 默认中文，不依赖执行机器的系统语言；i18n 用例仍可显式切换语言。
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(navigator, "language", { get: () => "zh-CN", configurable: true }); Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh"], configurable: true });`
  });
  await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1380, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, evalJs, waitFor, shot, close: () => ws.close() };
}
