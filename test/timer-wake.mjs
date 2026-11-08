// 候 · 等时刻：set_timer 挂上就收尾，书眉的漏列着它、写几时到；到点另起一答（细线「候「…」到点」），签了结、漏里撤去
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

// ---- 等时刻
await ask("TIMERWAKE");
await waitFor(`${conv("TIMERWAKE")}?.messages[1]?.status === "complete"`, 15000);
const first = await evalJs(
  `(m => ({ step: m.steps[0]?.name, timer: m.steps[0]?.timer, text: m.content, rows: [...document.querySelectorAll("#clepsydra .clepsydra-row")].length, hidden: document.querySelector("#clepsydra").classList.contains("hidden") }))(${conv("TIMERWAKE")}.messages[1])`
);
check(
  "set_timer hangs a wait and the answer closes",
  first.step === "set_timer" && /^t\d+$/.test(first.timer?.id || "") && first.timer.state === "waiting" && first.text.includes("约好了"),
  JSON.stringify(first)
);
await evalJs(`document.querySelector("#clepsydra .clepsydra-btn").click(); true`);
await sleep(200);
const row = await evalJs(`(r => r && ({ text: r.textContent, title: r.title }))(document.querySelector("#clepsydra .clepsydra-row"))`);
check(
  "the clepsydra lists it by its note and when it's due",
  !first.hidden && /^看一眼构建\d{1,2}:\d{2}›$/.test(row?.text || "") && /t\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(row?.title || ""),
  JSON.stringify(row)
);
await evalJs(`document.querySelector("#clepsydra .clepsydra-btn").click(); true`);
await waitFor(
  `${conv("TIMERWAKE")}.messages.at(-1)?.content.includes("TIMERWAKE woke") && ${conv("TIMERWAKE")}.messages.at(-1).status === "complete"`,
  20000
).catch(() => {});
const woke = await evalJs(
  `(c => ({ shape: c.messages.map(m => m.role + (m.relay ? ":relay" : "")).join(","), last: c.messages.at(-1).content, line: document.querySelector("#messages .message.relay")?.textContent || "", state: c.messages[1].steps[0].timer.state, clepsydra: document.querySelector("#clepsydra").classList.contains("hidden") }))(${conv("TIMERWAKE")})`
);
check(
  "when it's due a new answer wakes behind a thin line, the note delivered; the wait is settled and leaves the clepsydra",
  woke.shape === "user,assistant,user:relay,assistant" &&
    woke.line === "候候「看一眼构建」到点" &&
    woke.last.includes("到点") &&
    woke.last.includes("看一眼构建") &&
    woke.state === "done" &&
    woke.clepsydra,
  JSON.stringify(woke)
);

// 几条一起回来（桥接重启，三条后台同时止）：每条一道细线叠着排，都不出栏；比栏还长的那条截断，全名在悬停里
const id = await evalJs(`(c => {
  const step = c.messages[1].steps[0].id,
    lost = gist => ({ step, title: "bg1", ok: false, kind: "bg", lost: true, gist });
  c.messages.find(m => m.relay).relay = [lost("重启预览"), lost("为子目录中文稿开独立预览"), lost("很长".repeat(200))];
  return c.id;
})(${conv("TIMERWAKE")})`);
await evalJs(
  `(w => { document.querySelector("#newChat").click(); __yanState().settings.pendingWorkdir = w; })(__yanState().settings.pendingWorkdir); true`
);
await sleep(300);
await evalJs(`document.querySelector('[data-conversation="${id}"] .history-open').click(); true`);
await waitFor(`document.querySelectorAll("#messages .message.relay .relay-line").length === 3`, 5000).catch(() => {});
const crowded = await evalJs(`[...document.querySelectorAll("#messages .message.relay .relay-line")].map(line => {
  const name = line.querySelector(".relay-name"), box = line.getBoundingClientRect(), right = name.getBoundingClientRect().right;
  return { text: line.textContent.slice(0, 20), seal: line.querySelector(".seal").textContent, high: Math.round(box.height), inside: right <= box.right + 1 && line.scrollWidth <= line.clientWidth + 1, title: name.title.endsWith("随桥接重启而止 · 回到所在一步") };
})`);
check(
  "several back at once stack one thin line each, each with its seal, all inside the column; the over-long one truncated with its full name on hover",
  crowded.length === 3 &&
    crowded.every(l => l.seal === "候" && l.inside && l.high < 30 && l.title) &&
    crowded[0].text === "候后台「重启预览」随桥接重启而止",
  JSON.stringify(crowded)
);

await shot("timer-wake.png");
await close();
