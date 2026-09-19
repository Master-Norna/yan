// 上下文：右下角的实时计数随输入翻动、点开可压缩前文；压缩后的请求只带摘要；右侧导航条按问跳转
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "", contextWindow: 20000 }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const ask = async (selector, text, sendSel) => {
  await evalJs(
    `document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(text)}; document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event("input")); document.querySelector(${JSON.stringify(sendSel)}).click(); true`
  );
};
await ask("#welcomeInput", "PLAIN 第一问", "#welcome .send-trigger");
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`);
check(
  "gauge shows after the first reply",
  await evalJs(
    `!document.querySelector("#contextGauge").classList.contains("hidden") && /^\\d/.test(document.querySelector("#contextGauge .context-gauge-value").textContent)`
  )
);
check("no outline with a single question", await evalJs(`document.querySelector("#outline").classList.contains("hidden")`));
check(
  "gauge shows the model window as a ratio",
  (
    await evalJs(
      `document.querySelector("#contextGauge .context-gauge-window").textContent + "|" + document.querySelector("#contextGauge").classList.contains("has-window") + "|" + document.querySelector("#contextGauge").style.getPropertyValue("--ratio")`
    )
  ).startsWith("/ 20k|true|")
);
const before = await evalJs(`document.querySelector("#contextGauge .context-gauge-value").textContent`);
await evalJs(
  `document.querySelector("#chatInput").value = "字".repeat(600); document.querySelector("#chatInput").dispatchEvent(new Event("input")); true`
);
await sleep(500);
const typing = await evalJs(`document.querySelector("#contextGauge .context-gauge-value").textContent`);
check("typing grows the count live", typing !== before, `${before} → ${typing}`);
await ask("#chatInput", "PLAIN 第二问", "#chatSend");
await waitFor(
  `document.querySelectorAll(".message.assistant").length === 2 && [...document.querySelectorAll(".message.assistant")].at(-1).dataset.status === "complete"`
);
await ask("#chatInput", "PLAIN 第三问 " + "长".repeat(400), "#chatSend");
await waitFor(
  `document.querySelectorAll(".message.assistant").length === 3 && [...document.querySelectorAll(".message.assistant")].at(-1).dataset.status === "complete"`
);
// 导航条
check("outline lists one item per question", (await evalJs(`document.querySelectorAll("#outline .outline-item").length`)) === 3);
check(
  "outline labels carry the first words",
  (await evalJs(`[...document.querySelectorAll("#outline .outline-label")].map(n => n.textContent).join("|")`)).startsWith(
    "PLAIN 第一问|PLAIN 第二问|PLAIN 第三问"
  )
);
await sleep(300);
check(
  "last question active when scrolled to bottom",
  await evalJs(`[...document.querySelectorAll("#outline .outline-item")].at(-1).classList.contains("active")`)
);
await evalJs(`document.querySelector("#outline .outline-item").click(); true`);
let jumped = false;
try {
  await waitFor(
    `(() => { const a = document.querySelector("#messages .message.user"); const r = a.getBoundingClientRect(), h = document.querySelector("#chatScroll").getBoundingClientRect(); return r.top >= h.top - 4 && r.top < h.top + 120 && document.querySelector("#outline .outline-item").classList.contains("active"); })()`,
    4000
  );
  jumped = true;
} catch {}
check(
  "clicking jumps to that question and marks it",
  jumped,
  await evalJs(
    `(() => { const a = document.querySelector("#messages .message.user"); const r = a.getBoundingClientRect(), h = document.querySelector("#chatScroll").getBoundingClientRect(); return JSON.stringify({ top: r.top - h.top, active: document.querySelector("#outline .outline-item.active")?.textContent, flash: a.className }); })()`
  )
);
await shot("context.png");
// 压缩
const gaugeBefore = await evalJs(`document.querySelector("#contextGauge .context-gauge-value").textContent`);
await evalJs(`document.querySelector("#contextGauge").click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`);
check(
  "gauge click asks before compacting",
  (
    await evalJs(`document.querySelector("#confirmTitle").textContent + "|" + document.querySelector("#confirmBody").textContent`)
  ).startsWith("把前文压成摘要？|此前的 3 问 3 答")
);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
check(
  "gauge shows 压缩中 while working (or has already finished)",
  await evalJs(
    `document.querySelector("#contextGauge .context-gauge-label").textContent === "压缩中" || !!document.querySelector(".context-divider.has-summary, .context-divider.compacting")`
  )
);
await waitFor(`!!document.querySelector(".context-divider.has-summary")`, 15000);
const summary = await evalJs(`document.querySelector(".context-summary-body").textContent`);
check("summary written on the divider", /用户在测试压缩，此前 3 问/.test(summary), summary);
await waitFor(`!document.querySelector("#contextGauge").dataset.busy`, 5000);
check(
  "gauge label restored after compacting",
  (await evalJs(`document.querySelector("#contextGauge .context-gauge-label").textContent`)) === "上下文"
);
check("divider summary is folded by default", await evalJs(`!document.querySelector(".context-summary").open`));
check(
  "compacted messages fold away on the page",
  (await evalJs(
    `document.querySelectorAll("#messages > .compacted").length + "|" + [...document.querySelectorAll("#messages .message")].filter(n => getComputedStyle(n).display === "none").length`
  )) === "6|6"
);
await evalJs(`document.querySelector("[data-toggle-compacted]").click(); true`);
check(
  "toggle shows them again",
  (await evalJs(
    `document.querySelectorAll("#messages > .compacted").length + "|" + document.querySelector("[data-toggle-compacted]").textContent`
  )) === "0|收起前文"
);
await evalJs(`document.querySelector("[data-toggle-compacted]").click(); true`);
await sleep(300);
const gaugeAfter = await evalJs(`document.querySelector("#contextGauge .context-gauge-value").textContent`);
check(
  "count drops after compaction",
  parseFloat(gaugeAfter) < parseFloat(gaugeBefore) || /k$/.test(gaugeBefore) !== /k$/.test(gaugeAfter),
  `${gaugeBefore} → ${gaugeAfter}`
);
await ask("#chatInput", "BIND 之后", "#chatSend");
await waitFor(
  `document.querySelectorAll(".message.assistant").length === 4 && [...document.querySelectorAll(".message.assistant")].at(-1).dataset.status === "complete"`
);
const after = await evalJs(`[...document.querySelectorAll(".message.assistant .assistant-block > .markdown")].at(-1).textContent`);
check("next request carries only the summary pair and the new question", /n:4/.test(after), after);
// 导航条只列压缩分隔之后的问（折着的前文不列）；「展开前文」后再列全
check(
  "outline lists only the questions after the compaction divider while the rest is folded",
  await evalJs(
    `document.querySelectorAll("#outline .outline-item").length === 0 && document.querySelector("#outline").classList.contains("hidden")`
  )
);
await evalJs(`document.querySelector("[data-toggle-compacted]").click(); true`);
check(
  "unfolding the compacted part brings all questions back to the outline",
  (await evalJs(`document.querySelectorAll("#outline .outline-item").length`)) === 4
);
await evalJs(`document.querySelector("[data-toggle-compacted]").click(); true`);
check("folding again hides them", (await evalJs(`document.querySelector("#outline").classList.contains("hidden")`)) === true);
close();
