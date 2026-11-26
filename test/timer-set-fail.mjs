// 候 · 设约的回执没到手：桥接已经记下这一约、页面却没拿到编号。页面补一句按对话与步骤撤，
// 桥接那头跟着撤掉——不留「漏壶里没有、重答切版也撤不掉、周期还照排」的孤约
import { mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
// 页面的 set_timer 走总线：让这一次的总线回话读到完（桥接确实处理了），再把结果丢掉，模拟回执没到手
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const real = window.fetch;
    window.__dropTimerSet = true;
    window.fetch = async function (input, init) {
      const url = String(typeof input === "string" ? input : input?.url || "");
      const body = typeof init?.body === "string" ? init.body : "";
      const res = await real.call(this, input, init);
      if (window.__dropTimerSet && url.includes("/api/bus/send") && body.includes("/api/timer/set")) {
        window.__dropTimerSet = false;
        await Promise.race([res.text().catch(() => ""), new Promise(done => setTimeout(done, 3000))]);
        throw new TypeError("Failed to fetch");
      }
      return res;
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
const conv = text => `__yanState().conversations.find(c => c.messages[0]?.content === ${JSON.stringify(text)})`;
await evalJs(
  `(w => { document.querySelector("#newChat").click(); __yanState().settings.pendingWorkdir = w; })(__yanState().settings.pendingWorkdir); setTimeout(() => { document.querySelector("#welcomeInput").value = "TIMERDROP"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
);
await waitFor(`${conv("TIMERDROP")}?.messages[1]?.status === "complete"`, 20000).catch(() => {});
const box = await evalJs(
  `(m => ({ steps: (m?.steps || []).map(s => ({ name: s.name, status: s.status, timer: s.timer || null })), text: String(m?.content || ""), rows: document.querySelectorAll("#clepsydra .clepsydra-row").length }))(${conv("TIMERDROP")}?.messages[1])`
);
check(
  "the set_timer step fails and hangs no timer",
  box.steps[0]?.name === "set_timer" && box.steps[0].status === "error" && !box.steps[0].timer,
  JSON.stringify(box)
);
const list = await (await fetch(PAGE + "api/timer/list", { method: "POST", body: "{}" })).json();
check("the bridge drops the timer it had already written: no orphan left", list.timers.length === 0, JSON.stringify(list));
check("the clepsydra lists nothing", box.rows === 0, JSON.stringify(box.rows));
await shot("timer-set-fail.png");
await close();
