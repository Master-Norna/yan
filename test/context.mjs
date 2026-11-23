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
check(
  "the outline only reacts over its ticks: the hidden labels take no room",
  (await evalJs(`document.querySelector("#outline").getBoundingClientRect().width`)) <= 30
);
// 一问一整行、上下相接：两道短横之间的空也落在某一问上；首句平时不接点按，指针上了条之后才接得住
const labelHit = () =>
  evalJs(
    `(() => { const label = document.querySelector("#outline .outline-label"), r = label.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".outline-item") === label.closest(".outline-item"); })()`
  );
check(
  "the space between two ticks still belongs to a question",
  await evalJs(
    `(() => { const [a, b] = [...document.querySelectorAll("#outline .outline-tick")], ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return !!document.elementFromPoint(ra.right - 2, (ra.bottom + rb.top) / 2)?.closest(".outline-item"); })()`
  )
);
check("a hidden label takes no click", !(await labelHit()));
const tick = await evalJs(
  `(r => ({ x: r.right - 2, y: r.top + r.height / 2 }))(document.querySelector("#outline .outline-tick").getBoundingClientRect())`
);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tick.x, y: tick.y });
await sleep(250);
await waitFor(`document.querySelector("#outline").matches(":hover")`, 3000).catch(() => {});
await sleep(250);
check("once the pointer is on the rail, a label is clickable", await labelHit());
await shot("outline-hover.png");
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 400 });
// 从对话翻到卷宗：导航条跟着对话那一栏收起
await evalJs(`document.querySelector("#openLibrary").click(); true`);
await sleep(200);
check(
  "the outline does not follow into the archive page",
  await evalJs(`getComputedStyle(document.querySelector("#outline")).display === "none"`)
);
await evalJs(`document.querySelector("#openLibrary").click(); true`);
await sleep(300);
await sleep(300);
check(
  "last question active when scrolled to bottom",
  await evalJs(`[...document.querySelectorAll("#outline .outline-item")].at(-1).classList.contains("active")`)
);
// 收窄视口后直接滚到第二问，不走点击导航的强制高亮路径。
const middle = await evalJs(`(() => {
  const host = document.querySelector("#chatScroll"), second = document.querySelectorAll("#messages .message.user")[1];
  const maxHeight = host.style.maxHeight;
  // 与手动上滚一样先退出跟随，免得缩视口触发 ResizeObserver 又把位置拉回底部。
  host.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
  host.style.maxHeight = "140px";
  const line = host.getBoundingClientRect().top + Math.min(120, host.clientHeight * .25);
  host.scrollTo({ top: host.scrollTop + second.getBoundingClientRect().top - line + 4, behavior: "instant" });
  return { id: second.dataset.message, maxHeight };
})()`);
await waitFor(`document.querySelector("#outline .outline-item.active")?.dataset.target === ${JSON.stringify(middle.id)}`);
check(
  "scrolling to a middle question highlights it without a click or bottom override",
  await evalJs(`(() => {
    const host = document.querySelector("#chatScroll"), [, second, third] = document.querySelectorAll("#messages .message.user");
    const line = host.getBoundingClientRect().top + Math.min(120, host.clientHeight * .25);
    return host.scrollTop > 0 && host.scrollHeight - host.scrollTop - host.clientHeight >= 8 &&
      second.getBoundingClientRect().top <= line && third.getBoundingClientRect().top > line &&
      document.querySelector("#outline .outline-item.active")?.dataset.target === second.dataset.message;
  })()`)
);
await evalJs(`document.querySelector("#chatScroll").style.maxHeight = ${JSON.stringify(middle.maxHeight)}; true`);
const grabber = await evalJs(`(() => {
  const host = document.querySelector("#chatScroll"), rail = document.querySelector("#chatScrollGrabber"), composer = document.querySelector("#composerArea");
  host.scrollTop = 0;
  const r = rail.getBoundingClientRect(), c = composer.getBoundingClientRect();
  rail.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 77, clientX: r.right - 2, clientY: r.bottom - 3 }));
  rail.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 77, clientX: r.right - 2, clientY: r.bottom - 3 }));
  return { active: rail.classList.contains("active"), width: r.width, overlapsComposer: r.bottom > c.top, top: host.scrollTop, max: host.scrollHeight - host.clientHeight };
})()`);
check(
  "transparent right-edge grabber reaches past the composer and drags to the bottom",
  grabber.active && grabber.width >= 12 && grabber.overlapsComposer && grabber.max > 0 && grabber.top >= grabber.max - 2,
  JSON.stringify(grabber)
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
  ).startsWith("撮要前文？|此前的 3 问 3 答")
);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
check(
  "gauge shows 撮要中 while working (or has already finished)",
  await evalJs(
    `document.querySelector("#contextGauge .context-gauge-label").textContent === "撮要中" || !!document.querySelector(".context-divider.has-summary, .context-divider.compacting")`
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
// 旧版硬切照样截断请求，但不把撮要之后、硬切之前的问从页面或导航藏起来。
await evalJs(`(() => {
  const c = __yanState().conversations.find(c => c.messages.some(m => m.role === "context" && m.summary));
  c.messages.push({ id: "legacy-cut", role: "context", content: "", timestamp: new Date().toISOString() });
  return true;
})()`);
await ask("#chatInput", "BIND 硬切之后", "#chatSend");
await waitFor(
  `document.querySelectorAll(".message.assistant").length === 5 && [...document.querySelectorAll(".message.assistant")].at(-1).dataset.status === "complete"`
);
const afterCut = await evalJs(`[...document.querySelectorAll(".message.assistant .assistant-block > .markdown")].at(-1).textContent`);
check("legacy cut sends only the new question and system prompt", /\|n:2$/.test(afterCut.trim()), afterCut);
check(
  "legacy cut does not replace the summary as the page and outline folding boundary",
  await evalJs(`document.querySelectorAll("#messages > .compacted").length === 6 &&
    document.querySelectorAll("#outline .outline-item").length === 2 &&
    getComputedStyle(document.querySelector("[data-message=legacy-cut]")).display !== "none"`)
);
close();
