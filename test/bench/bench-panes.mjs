// 实测：同样 K 段对话，多开标签页 vs 主页面 + iframe 分栏，比内存、空闲 CPU、打开延迟、同时作答
// 用法：node test/bench/bench-panes.mjs <tabs|iframe> <K>
// 只在 Linux 上跑（读 /proc、按 smaps_rollup 求 PSS），需要 YAN_TEST_BROWSER 指向 Chromium/Chrome；
// 是基准脚本，不是 test/run.mjs 的用例。数据全为合成对话，不碰真实存储。
// 2026-10 的结果见 docs/bench/iframe-vs-tabs.{json,csv}（87ed348 上测得）。
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [mode, Kraw] = process.argv.slice(2);
const K = Number(Kraw);
const HERE = path.dirname(fileURLToPath(import.meta.url)),
  ROOT = path.join(HERE, "..", ".."),
  TMP = path.join("/tmp", `bench-${mode}-${K}`);
const BRIDGE = 8799,
  DEBUG = 9333,
  PAGE = `http://127.0.0.1:${BRIDGE}/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const kids = [];
const start = (cmd, args, extra = {}) => {
  const c = spawn(cmd, args, { stdio: ["ignore", "ignore", "ignore"], ...extra });
  kids.push(c);
  return c;
};
process.on("exit", () => kids.forEach(k => k.kill("SIGKILL")));
const waitPort = async port => {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
      return;
    } catch {
      await sleep(150);
    }
  }
  throw Error("port " + port);
};
const server = start(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, YAN_PORT: String(BRIDGE), YAN_HOME: path.join(TMP, ".yan"), YAN_NO_EXTERNAL: "1", YAN_BUILTIN_SKILLS: "" }
});
start(process.execPath, [path.join(HERE, "..", "fake-llm.mjs")], { cwd: ROOT });
await waitPort(BRIDGE);
await waitPort(8798);

// 30 段对话，每段 40 条、每条约 1.5 KB：约 1.8 MB 的历史
const at = "Thu 2026-09-24 8:00 AM CST (UTC+08:00)";
const filler = "这是用来撑起体量的正文，含一些代码与说明。".repeat(70);
const N_CONV = 30;
for (let i = 0; i < N_CONV; i++) {
  const messages = [];
  for (let j = 0; j < 20; j++) {
    messages.push({ id: `b${i}-u${j}`, role: "user", content: `问${j} ${filler}`, timestamp: at });
    messages.push({ id: `b${i}-a${j}`, role: "assistant", content: `答${j} ${filler}`, status: "complete", timestamp: at, modelName: "假模型" });
  }
  await fetch(PAGE + "api/chats/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root: "", savedAt: Date.now() + i, conversation: { id: `b${i}`, title: `段${i}`, createdAt: at, updatedAt: new Date().toISOString(), profileId: "p1", forks: [], threads: [], messages } })
  });
}

const browser = start(process.env.YAN_TEST_BROWSER, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--lang=zh-CN",
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${path.join(TMP, "profile")}`, "about:blank"
]);
await waitPort(DEBUG);
const ver = await (await fetch(`http://127.0.0.1:${DEBUG}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const evalIn = async (sid, expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sid);
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || "eval");
  return r.result.value;
};
const waitIn = async (sid, expr, timeout = 60000) => {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    try {
      if (await evalIn(sid, expr)) return Date.now() - t;
    } catch {}
    await sleep(50);
  }
  throw Error("timeout " + expr.slice(0, 80));
};
const newTab = async url => {
  const { targetId } = await send("Target.createTarget", { url, newWindow: true });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: mode === "iframe" ? 2400 : 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  return sessionId;
};
const closeBlank = async () => {
  const { targetInfos } = await send("Target.getTargets");
  for (const t of targetInfos) if (t.type === "page" && t.url === "about:blank") await send("Target.closeTarget", { targetId: t.targetId });
};

// 种 localStorage：一份假模型
const seed = await newTab(PAGE + "preview.html");
await sleep(800);
await evalIn(
  seed,
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, lastView: "chat", lastConversationId: "b0" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], memory: { enabled: false, items: [] }, drafts: {} })); true`
);
await closeBlank();
{ const { targetInfos } = await send("Target.getTargets"); for (const t of targetInfos) if (t.type === "page" && t.url.includes("preview.html")) await send("Target.closeTarget", { targetId: t.targetId }); }

const ready = `typeof __yanState === "function" && (__yanState().conversations.length >= ${N_CONV}) && !!document.querySelector("#messages .message.assistant")`;
const opens = [];
let main, docs; // docs: 每段对话所在的 { sid, doc 表达式 }
const t0 = Date.now();
main = await newTab(PAGE);
await waitIn(main, ready);
opens.push(Date.now() - t0);
if (mode === "tabs") {
  docs = [{ sid: main, doc: "document" }];
  for (let i = 1; i < K; i++) {
    const t = Date.now();
    const sid = await newTab(PAGE);
    await waitIn(sid, ready);
    await evalIn(sid, `document.querySelector('#history [data-conversation="b${i}"] .history-open').click(); true`);
    await waitIn(sid, `document.querySelector("#messages")?.textContent.includes("答19") && __yanState().settings.lastConversationId === "b${i}"`);
    opens.push(Date.now() - t);
    docs.push({ sid, doc: "document" });
  }
} else {
  docs = [{ sid: main, doc: "document" }];
  for (let i = 1; i < K; i++) {
    const t = Date.now();
    await evalIn(main, `__yanSplit.add("b${i}")`);
    const doc = `document.querySelector('.split-panel[data-slot="${i - 1}"] .split-frame').contentDocument`;
    await waitIn(main, `(() => { const w = document.querySelector('.split-panel[data-slot="${i - 1}"] .split-frame')?.contentWindow; return !!w?.__yanPane?.id() && (w.__yanState?.().conversations.length||0) >= ${N_CONV} && !!w.document.querySelector("#messages .message.assistant"); })()`);
    opens.push(Date.now() - t);
    docs.push({ sid: main, doc });
  }
}

// 进程统计
const chromePids = () =>
  readdirSync("/proc")
    .filter(p => /^\d+$/.test(p))
    .filter(p => {
      try {
        return readFileSync(`/proc/${p}/cmdline`, "utf8").includes(`bench-${mode}-${K}/profile`);
      } catch {
        return false;
      }
    });
const pss = pids =>
  pids.reduce((s, p) => {
    try {
      const m = readFileSync(`/proc/${p}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m);
      return s + (m ? Number(m[1]) : 0);
    } catch {
      return s;
    }
  }, 0);
const jiffies = pids =>
  pids.reduce((s, p) => {
    try {
      const f = readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ");
      return s + Number(f[11]) + Number(f[12]);
    } catch {
      return s;
    }
  }, 0);
const renderers = () => chromePids().filter(p => readFileSync(`/proc/${p}/cmdline`, "utf8").includes("--type=renderer")).length;
const heap = async () => {
  const sids = [...new Set(docs.map(d => d.sid))];
  let used = 0;
  for (const sid of sids) {
    await send("HeapProfiler.collectGarbage", {}, sid).catch(() => {});
    const r = await send("Runtime.getHeapUsage", {}, sid);
    used += r.usedSize;
  }
  return used;
};

await sleep(10000); // 稳下来
const pids = chromePids();
const memPss = pss(pids),
  heapUsed = await heap();
const serverPid = String(server.pid);
const c0 = jiffies(chromePids()),
  s0 = jiffies([serverPid]);
await sleep(20000);
const idleChrome = (jiffies(chromePids()) - c0) / 100 / 20,
  idleServer = (jiffies([serverPid]) - s0) / 100 / 20;

// 同时作答：K 段一起发 SLOWTEXT（单段理想约 8 秒）
const c1 = jiffies(chromePids());
const ts = Date.now();
await Promise.all(
  docs.map(d =>
    evalIn(d.sid, `(d => { const i = d.querySelector("#chatInput"); i.value = "SLOWTEXT 实测"; i.dispatchEvent(new Event("input")); d.querySelector("#chatSend").click(); return true; })(${d.doc})`)
  )
);
const done = await Promise.all(
  docs.map(d => waitIn(d.sid, `(d => [...d.querySelectorAll("#messages .message.assistant")].pop()?.textContent.includes("第20段"))(${d.doc})`, 90000).then(() => Date.now() - ts, () => -1))
);
const streamCpu = (jiffies(chromePids()) - c1) / 100 / ((Date.now() - ts) / 1000);
// 作答中的交互延迟：在第一页输入框敲字后到下一帧
console.log(
  JSON.stringify({
    mode,
    K,
    renderers: renderers(),
    pssMB: +(memPss / 1024).toFixed(1),
    jsHeapMB: +(heapUsed / 1048576).toFixed(1),
    openMs: opens,
    idleChromeCores: +idleChrome.toFixed(3),
    idleServerCores: +idleServer.toFixed(3),
    streamDoneMs: done,
    streamChromeCores: +streamCpu.toFixed(2)
  })
);
process.exit(0);
