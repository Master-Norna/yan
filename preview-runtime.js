(() => {
  "use strict";
  let scriptUrls = [];
  const previewId = location.hash.slice(1);
  const notify = (state, detail = "") =>
    parent.postMessage({ type: "yan-preview-state", id: previewId, state, detail: String(detail).slice(0, 240) }, "*");
  function clearScriptUrls() {
    for (const url of scriptUrls) URL.revokeObjectURL(url);
    scriptUrls = [];
  }
  function showError(error) {
    let box = document.querySelector("#yan-preview-error");
    if (!box) {
      box = document.createElement("div");
      box.id = "yan-preview-error";
      Object.assign(box.style, {
        position: "fixed",
        left: "10px",
        right: "10px",
        bottom: "10px",
        zIndex: "2147483647",
        padding: "9px 11px",
        border: "1px solid #b75b4a",
        borderRadius: "8px",
        background: "#fff7f3",
        color: "#8d3f33",
        font: "12px/1.5 system-ui,sans-serif",
        whiteSpace: "pre-wrap"
      });
      document.body.append(box);
    }
    box.textContent = `运行错误：${String(error?.message || error).slice(0, 220)}`;
    notify("error", error?.message || error);
  }
  window.addEventListener("error", event => showError(event.error || event.message));
  window.addEventListener("unhandledrejection", event => showError(event.reason || "Promise rejected"));
  async function run(source) {
    clearScriptUrls();
    const parsed = new DOMParser().parseFromString(String(source || ""), "text/html");
    const scripts = [...parsed.querySelectorAll("script")]
      .map(node => ({ code: node.textContent || "", type: (node.type || "text/javascript").toLowerCase(), external: !!node.src }))
      .filter(item => ["text/javascript", "application/javascript", "module"].includes(item.type));
    if (scripts.some(item => item.external)) throw Error("交互内容含外部脚本；请把 JavaScript 直接写在 HTML 内");
    parsed.querySelectorAll("script,base,meta[http-equiv],iframe,object,embed").forEach(node => node.remove());
    document.head.querySelectorAll("[data-preview-style]").forEach(node => node.remove());
    for (const style of parsed.head.querySelectorAll("style")) {
      const node = document.createElement("style");
      node.dataset.previewStyle = "";
      node.textContent = style.textContent;
      document.head.append(node);
    }
    document.title = parsed.title || "言 · 交互预览";
    for (const name of ["class", "style", "dir"]) document.documentElement.removeAttribute(name);
    for (const name of ["class", "style", "dir"])
      if (parsed.documentElement.hasAttribute(name)) document.documentElement.setAttribute(name, parsed.documentElement.getAttribute(name));
    document.documentElement.lang = parsed.documentElement.lang || "zh-CN";
    for (const { name } of [...document.body.attributes]) document.body.removeAttribute(name);
    for (const { name, value } of [...parsed.body.attributes]) if (!/^on/i.test(name)) document.body.setAttribute(name, value);
    document.body.innerHTML = parsed.body.innerHTML || source;
    for (const item of scripts) {
      if (!item.code.trim()) continue;
      const url = URL.createObjectURL(new Blob([item.code], { type: "text/javascript" }));
      scriptUrls.push(url);
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        if (item.type === "module") script.type = "module";
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(Error("脚本无法执行"));
        document.body.append(script);
      });
    }
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    window.dispatchEvent(new Event("load"));
    notify("ready");
  }
  // run_js：在一个 Worker 里跑模型给的代码，收集 console 输出与返回值；超时就把 Worker 整个杀掉。
  // CSP 不许 eval / new Function，所以代码不是运行时求值，而是直接拼进 Worker 的脚本（blob 脚本是许可的）：
  // 先按「单个表达式」拼——脚本解析不过（还没发出 loaded 就出错）就按「语句块」再拼一次，用 return 交回结果
  const COMPUTE_PRELUDE = String.raw`"use strict";
const logs = [];
const fmt = value => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return String(value.stack || value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  try {
    const text = JSON.stringify(value, (k, v) => (typeof v === "bigint" ? String(v) + "n" : v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v), 2);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
};
const push = level => (...args) => {
  if (logs.reduce((n, line) => n + line.length, 0) > 20000) return;
  logs.push((level ? level + " " : "") + args.map(fmt).join(" "));
};
self.console = { log: push(""), info: push(""), debug: push(""), table: push(""), warn: push("[warn]"), error: push("[error]") };
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "navigator"])
  try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch {}
self.postMessage({ type: "loaded" });
`;
  const COMPUTE_EPILOGUE = String.raw`
(async () => {
  const started = Date.now();
  let value, error = null;
  try { value = await __main(); } catch (err) { error = String((err && err.stack) || err).slice(0, 2000); }
  self.postMessage({ type: "result", ok: !error, logs: logs.join("\n"), value: value === undefined ? undefined : fmt(value), error, ms: Date.now() - started });
})();`;
  const computeSource = (code, asExpression) =>
    COMPUTE_PRELUDE +
    (asExpression ? `const __main = async () => (\n${code}\n);` : `const __main = async () => {\n${code}\n};`) +
    COMPUTE_EPILOGUE;
  function compute(job) {
    const reply = data => parent.postMessage({ ...data, type: "yan-compute-result", id: job.id }, "*");
    const attempt = asExpression => {
      let worker;
      try {
        worker = new Worker(URL.createObjectURL(new Blob([computeSource(job.code, asExpression)], { type: "text/javascript" })));
      } catch (error) {
        return reply({ ok: false, error: `沙箱无法启动：${error.message || error}` });
      }
      let loaded = false;
      const timer = setTimeout(() => {
        worker.terminate();
        reply({ ok: false, error: `超时（${Math.round(job.timeout / 1000)} 秒）：已终止` });
      }, job.timeout);
      worker.onmessage = event => {
        if (event.data?.type === "loaded") return void (loaded = true);
        clearTimeout(timer);
        worker.terminate();
        reply(event.data);
      };
      worker.onerror = event => {
        event.preventDefault(); // 不让它再冒到本页的 window.error 去报「运行错误」
        clearTimeout(timer);
        worker.terminate();
        // 还没 loaded 就出错：脚本没解析过。表达式写法不成就按语句块再来；语句块也不成才是真的语法错
        if (!loaded && asExpression) return attempt(false);
        reply({ ok: false, error: String(event.message || "运行出错") });
      };
    };
    attempt(true);
  }
  window.addEventListener("message", event => {
    if (event.source !== parent || event.data?.id !== previewId) return;
    if (event.data.type === "yan-preview-render") run(event.data.html).catch(showError);
    else if (event.data.type === "yan-compute") compute(event.data);
  });
  parent.postMessage({ type: "yan-preview-ready", id: previewId }, "*");
})();
