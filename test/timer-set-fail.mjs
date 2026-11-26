// 候 · 设约的回执没到手：桥接已经记下这一约、页面却没拿到编号。页面补一句按对话与步骤撤，
// 桥接那头跟着撤掉——不留「漏壶里没有、重答切版也撤不掉、周期还照排」的孤约。
// 补的这一句是补账，不是作答的一步：桥接收下却一直不回话，也不能把这一答的收尾拖住（收尾不落，续写就永远等在那儿）
import { mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
// 页面的 set_timer 走总线：让这一次的总线回话读到完（桥接确实处理了），再把结果丢掉，模拟回执没到手。
// 总线没连上时同一趟走直连 fetch（01-bridge.js 的 busReady 降级），因此两种发法都要认——
// CI 的机器慢，EventSource 常在开页 3 秒窗口里没连上，这一趟就走了直连。
// __timerHang：桥接收下补的那句撤约却一直不回话——回应只跟着 signal 断，正是卡住的那一头。
// 开关存在 localStorage：开页对齐配置后会重载一回，放在 window 上的标志会被重置
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const real = window.fetch;
    // 这一趟是不是往 path 去的：经总线时 url 是 /api/bus/send、真路径在 body 里；直连时 url 就是 path
    const reaching = (url, body, path) => (url.includes("/api/bus/send") && body.includes(path)) || url.includes(path);
    window.fetch = async function (input, init) {
      const url = String(typeof input === "string" ? input : input?.url || "");
      const body = typeof init?.body === "string" ? init.body : "";
      if (localStorage.getItem("__timerDrop") && reaching(url, body, "/api/timer/set")) {
        localStorage.removeItem("__timerDrop"); // 只丢这一次
        const res = await real.call(this, input, init);
        await Promise.race([res.text().catch(() => ""), new Promise(done => setTimeout(done, 3000))]);
        throw new TypeError("Failed to fetch");
      }
      if (localStorage.getItem("__timerHang") && reaching(url, body, "/api/timer/cancel")) {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }), 60000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(init.signal.reason);
          });
        });
      }
      return real.call(this, input, init);
    };
  })();`
});
mkdirSync(WORK, { recursive: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const arm = (...keys) =>
  evalJs(
    `["__timerDrop", "__timerHang"].forEach(k => localStorage.removeItem(k)); ${JSON.stringify(keys)}.forEach(k => localStorage.setItem(k, "1")); true`
  );
const ask = text =>
  evalJs(
    `(w => { document.querySelector("#newChat").click(); __yanState().settings.pendingWorkdir = w; })(__yanState().settings.pendingWorkdir); setTimeout(() => { document.querySelector("#welcomeInput").value = ${JSON.stringify(text)}; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
  );
const conv = text => `__yanState().conversations.find(c => c.messages[0]?.content === ${JSON.stringify(text)})`;

// ---- 回执没到手：页面补一句撤约，桥接那头跟着撤，漏壶里不留
await arm("__timerDrop");
await ask("TIMERDROP");
await waitFor(`${conv("TIMERDROP")}?.messages[1]?.status === "complete"`, 20000).catch(() => {});
const box = await evalJs(
  `(m => ({ steps: (m?.steps || []).map(s => ({ name: s.name, status: s.status, timer: s.timer || null })), text: String(m?.content || ""), rows: document.querySelectorAll("#clepsydra .clepsydra-row").length }))(${conv("TIMERDROP")}?.messages[1])`
);
check(
  "the set_timer step fails and hangs no timer",
  box.steps[0]?.name === "set_timer" && box.steps[0].status === "error" && !box.steps[0].timer,
  JSON.stringify(box)
);
// 补的那句不等它回话，所以撤约可能略晚一步到；等到约簿空下来为止
const gone = await waitFor(
  `fetch("/api/timer/list", { method: "POST", body: "{}" }).then(r => r.json()).then(d => d.timers.length === 0)`,
  8000
).catch(() => false);
const list = await (await fetch(PAGE + "api/timer/list", { method: "POST", body: "{}" })).json();
check("the bridge drops the timer it had already written: no orphan left", gone === true, JSON.stringify(list));
check("the clepsydra lists nothing", box.rows === 0, JSON.stringify(box.rows));
await shot("timer-set-fail.png");

// ---- 桥接卡着不回：这一答照样收尾。补的那句若被等着，收尾不落、续写就永远等在这儿
await arm("__timerDrop", "__timerHang");
await ask("TIMERHANG");
const settled = await waitFor(
  `(m => !!m && m.status !== "streaming" && !("startedAt" in m) && typeof m.durationMs === "number")((${conv("TIMERHANG")} || {}).messages?.[1])`,
  12000
).catch(() => false);
const hang = await evalJs(
  `(m => m && ({ status: m.status, startedAt: m.startedAt ?? null, durationMs: m.durationMs ?? null, steps: (m.steps || []).map(s => s.status) }))((${conv("TIMERHANG")} || {}).messages?.[1])`
);
check("a bridge that never answers the compensating cancel must not hold the answer open", settled === true, JSON.stringify(hang));
await close();
