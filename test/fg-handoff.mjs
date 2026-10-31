// 前台指令转入后台：等满 timeout 还没完不掐，编号转入后台接着跑，模型当即拿回结果；跑着时补言也当场转入，补言随之递上。
// 两种都在指令结束时照后台指令的路子叫醒模型
import { mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(WORK, { recursive: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const ask = text =>
  evalJs(
    `document.querySelector("#newChat").click(); setTimeout(() => { document.querySelector("#welcomeInput").value = ${JSON.stringify(text)}; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
  );
const conv = text => `__yanState().conversations.find(c => c.messages[0]?.content === ${JSON.stringify(text)})`;
const firstAnswer = text =>
  evalJs(
    `(m => ({ text: m.content, card: m.steps.find(s => s.name === "run_command")?.result || "", bg: m.steps.find(s => s.name === "run_command")?.bg?.state }))(${conv(text)}.messages[1])`
  );

// ---- 等满 timeout：一秒就交回「转入后台」，指令照跑，三秒后结束叫醒
await ask("FGWAIT");
await waitFor(`${conv("FGWAIT")}?.messages[1]?.status === "complete"`, 15000);
const waited = await firstAnswer("FGWAIT");
check(
  "past its timeout the command moves to the background instead of being killed",
  /^转入后台 bg\d+ · /.test(waited.card) && waited.bg === "running" && waited.text.includes("还没结束，已转入后台接着跑"),
  JSON.stringify(waited)
);
await waitFor(
  `${conv("FGWAIT")}.messages.at(-1)?.content.includes("FGWAIT done") && ${conv("FGWAIT")}.messages.at(-1).status === "complete"`,
  20000
).catch(() => {});
const woke = await evalJs(`(c => ({ last: c.messages.at(-1).content, card: c.messages[1].steps[0].result }))(${conv("FGWAIT")})`);
check(
  "when it ends the model is woken with its output",
  woke.last.includes("FGWAIT done｜woke") && woke.last.includes("wake-ok") && /^后台 bg\d+ · 已结束 · 退出码 0/.test(woke.card),
  JSON.stringify(woke)
);

// ---- 补言：指令跑着时插话，不等它跑完（四秒），当场转入后台，补言随之递上
await ask("FGSTEER");
await waitFor(`${conv("FGSTEER")}?.messages[1]?.steps?.some(s => s.name === "run_command" && s.status === "running")`, 15000);
await sleep(500);
const t0 = Date.now();
await evalJs(
  `(i => { i.value = "FGSTEER-NOTE 先看看别的"; i.dispatchEvent(new Event("input")); })(document.querySelector("#chatInput")); true`
);
await evalJs(
  `document.querySelector("#chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); true`
);
await waitFor(`${conv("FGSTEER")}.messages[1].content.includes("挂上了")`, 10000).catch(() => {});
const took = Date.now() - t0,
  steered = await firstAnswer("FGSTEER");
check(
  "an interjection moves the running command to the background and is delivered at once",
  steered.bg === "running" &&
    /^转入后台 bg\d+ · /.test(steered.card) &&
    steered.text.includes("｜steer｜") &&
    steered.text.includes("有话递给你"),
  JSON.stringify({ took, ...steered })
);
await waitFor(`${conv("FGSTEER")}.messages.at(-1)?.content.includes("FGSTEER done")`, 20000).catch(() => {});
check(
  "the handed-off command still finishes and wakes the model",
  await evalJs(`(c => c.messages.at(-1).content.includes("wake-ok"))(${conv("FGSTEER")})`)
);
await close();
