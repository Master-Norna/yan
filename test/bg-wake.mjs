// 后台指令结束即叫醒：挂上就能收尾，不必轮询。只剩等待的，结束时另起一答（两答之间一道细线）；
// 布置完还在干别的，结果递进这一答，行迹里落一小步「回报」；等待期间刷新页面，重新等上，照样叫醒
import { mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
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
    `(w => { document.querySelector("#newChat").click(); __yanState().settings.pendingWorkdir = w; })(__yanState().settings.pendingWorkdir); setTimeout(() => { document.querySelector("#welcomeInput").value = ${JSON.stringify(text)}; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
  );
const conv = text => `__yanState().conversations.find(c => c.messages[0]?.content === ${JSON.stringify(text)})`;
const shape = text => evalJs(`${conv(text)}?.messages.map(m => m.role + (m.relay ? ":relay" : "")).join(",") || ""`);

// ---- 只剩等待：挂上就收尾，第一答里没有 check_command；结束时另起一答，细线写「后台 bgN 已结束」
await ask("BGWAKE");
await waitFor(`${conv("BGWAKE")}?.messages[1]?.status === "complete"`, 15000);
const first = await evalJs(
  `(m => ({ steps: m.steps.map(s => s.name + ":" + (s.result || "")), bg: m.steps[0]?.bg?.state, text: m.content }))(${conv("BGWAKE")}.messages[1])`
);
check(
  "the first answer closes right after hanging the command, no polling",
  first.steps.length === 1 &&
    /^run_command:后台 bg\d+ · 进行中/.test(first.steps[0]) &&
    first.bg === "running" &&
    first.text.includes("挂上了"),
  JSON.stringify(first)
);
await waitFor(
  `${conv("BGWAKE")}.messages.at(-1)?.content.includes("BGWAKE done") && ${conv("BGWAKE")}.messages.at(-1).status === "complete"`,
  20000
).catch(() => {});
const woke = await evalJs(
  `(c => ({ last: c.messages.at(-1).content, line: document.querySelector("#messages .message.relay")?.textContent || "", seal: document.querySelector("#messages .message.relay .seal")?.textContent || "", card: c.messages[1].steps[0].result, bg: c.messages[1].steps[0].bg?.state }))(${conv("BGWAKE")})`
);
check(
  "when it ends a new answer wakes, behind a thin line, with the exit code and output",
  (await shape("BGWAKE")) === "user,assistant,user:relay,assistant" &&
    /^后台 bg\d+ 已结束$/.test(woke.line.replace(/^候/, "")) &&
    woke.seal === "候" &&
    woke.last.includes("BGWAKE done｜woke") &&
    woke.last.includes("退出码 0") &&
    woke.last.includes("wake-ok") &&
    woke.last.includes("上一答的行迹"),
  JSON.stringify(woke)
);
check("the command's own card now says it ended", /^后台 bg\d+ · 已结束 · 退出码 0/.test(woke.card) && woke.bg === "done", woke.card);
await evalJs(`document.querySelector("#messages .message.relay .relay-name").click(); true`);
await sleep(400);
check(
  "clicking the line goes back to the step that hung it, opening the trail",
  await evalJs(`(c => !!c && !!c.closest(".tool-stack")?.open)(document.querySelector('#messages .tool-step[data-tool="run_command"]'))`)
);

// ---- 布置完还在干别的：结果递进这一答，行迹里它到达的那一刻落一小步「回报」，不另起一答
await ask("BGBUSY");
await waitFor(
  `${conv("BGBUSY")}?.messages.at(-1)?.status === "complete" && ${conv("BGBUSY")}.messages.at(-1).content.includes("BGBUSY done")`,
  30000
).catch(() => {});
const busy = await evalJs(
  `(m => ({ text: m.content, steps: m.steps.map(s => s.name + ":" + s.status + ":" + (s.result || "")), card: (d => d && { text: d.textContent, status: d.dataset.status })(document.querySelector('#messages .tool-step[data-tool="relay_note"]')), lines: document.querySelectorAll("#messages .message.relay").length }))(${conv("BGBUSY")}.messages.at(-1))`
);
check(
  "with other work going on, the result lands in the same answer as a small step in the trail",
  (await shape("BGBUSY")) === "user,assistant" &&
    busy.text.includes("BGBUSY done｜inline") &&
    busy.steps.some(s => s === "relay_note:done:") &&
    busy.steps.filter(s => s.startsWith("list_files")).length >= 1 &&
    busy.card?.text.includes("已结束") &&
    busy.lines === 0,
  JSON.stringify(busy)
);
await shot("bg-busy.png");

// ---- 等着的时候刷新页面：开页后重新等上，结束照样叫醒（桥接那头只报一回）
await ask("BGRELOAD");
await waitFor(`${conv("BGRELOAD")}?.messages[1]?.status === "complete"`, 15000);
await sleep(600);
await send("Page.navigate", { url: PAGE });
await sleep(1500);
await waitFor(`${conv("BGRELOAD")}?.messages.at(-1)?.content.includes("BGRELOAD done")`, 20000).catch(() => {});
await sleep(1500);
check(
  "a reload while waiting re-attaches; the end still wakes exactly one new answer",
  (await shape("BGRELOAD")) === "user,assistant,user:relay,assistant" &&
    (await evalJs(`${conv("BGRELOAD")}.messages.at(-1).content.includes("BGRELOAD done｜woke")`)),
  await shape("BGRELOAD")
);
close();
