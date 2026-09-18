// 端到端用例共用的一小套工具：连上无头浏览器的调试口、在页面里求值、等待条件、记一条 PASS / FAIL
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DEBUG = "http://127.0.0.1:9333";
export const PAGE = "http://127.0.0.1:8799/";
export const TMP = path
  .join(path.dirname(fileURLToPath(import.meta.url)), ".tmp")
  .split(path.sep)
  .join("/");
export const WORK = `${TMP}/work`;
export const ARCHIVE = `${TMP}/archive`;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const check = (label, ok, detail = "") => console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);

export async function connect() {
  let ws,
    seq = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evalJs = async (expression, awaitPromise = true) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
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
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1380, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, evalJs, waitFor, shot, close: () => ws.close() };
}
