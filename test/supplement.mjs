// 补言：作答途中再寄来的话——没有下一回合时落笔后作为新的一问送出；停了就放回案上；占位框在逐帧重画里不重建
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const lastAssistant = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`;
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "on", mode: "chat", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const type = text =>
  evalJs(`(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); })(document.querySelector("#chatInput")); true`);
const enter = () =>
  evalJs(
    `document.querySelector("#chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); true`
  );

// ---- 第一问慢慢流一块 html：占位框是同一个节点、手稿的笔画随行数增加；途中补一句，落笔后它成了下一问
await evalJs(
  `document.querySelector("#welcomeInput").value = "SLOWHTML 画个页"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`!!${lastAssistant}?.querySelector(".viz-pending")`, 20000);
await evalJs(`${lastAssistant}.querySelector(".viz-pending").dataset.probe = "same"; true`);
const ink1 = await evalJs(`parseFloat(${lastAssistant}.querySelector(".viz-ink-fill").style.width)`);
await waitFor(`parseFloat(${lastAssistant}.querySelector(".viz-ink-fill")?.style.width || 0) > ${ink1}`, 5000);
check(
  "pending viz box keeps the same node across frames and its ink stroke advances; no line-count copy",
  await evalJs(
    `(v => v.dataset.probe === "same" && parseFloat(v.querySelector(".viz-ink-fill").style.width) > ${ink1} && !v.textContent.includes("行") && v.style.getPropertyValue("--phase").endsWith("ms"))(${lastAssistant}.querySelector(".viz-pending"))`
  )
);
await type("PLAIN 补一句");
check("seal turns 寄 while the reply runs", (await evalJs(`document.querySelector("#chatSend").dataset.glyph`)) === "寄");
await enter();
await sleep(100);
check(
  "supplement queued: 补言 step pending in the trail, box cleared",
  await evalJs(
    `!!${lastAssistant}.querySelector('.tool-step-note[data-status="running"]') && document.querySelector("#chatInput").value === ""`
  )
);
await waitFor(
  `document.querySelectorAll('#messages .message.assistant').length === 2 && ${lastAssistant}.dataset.status === "complete"`,
  20000
);
const turns = await evalJs(
  `(c => ({ users: c.messages.filter(m => m.role === "user").map(m => m.content), notes: (c.messages[1].steps || []).length, reply: c.messages.at(-1).content }))(JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0])`
);
check(
  "no next round to hand it to: the supplement became the next question and got its own reply; the pending step was withdrawn",
  turns.users.join("|") === "SLOWHTML 画个页|PLAIN 补一句" && turns.notes === 0 && turns.reply.startsWith("正文回答"),
  JSON.stringify(turns)
);

// ---- 途中补了一句又按了停：这一答没写完，补言放回案上
await type("SLOWHTML 再画");
await enter();
await waitFor(
  `document.querySelectorAll('#messages .message.assistant').length === 3 && !!${lastAssistant}.querySelector(".viz-pending")`,
  20000
);
await type("留着的话");
await enter();
await sleep(80);
check("queued again", await evalJs(`!!${lastAssistant}.querySelector('.tool-step-note[data-status="running"]')`));
await evalJs(`document.querySelector("#chatSend").click(); true`);
await sleep(300);
check(
  "stopping puts the unsent supplement back into the composer and drops the step",
  await evalJs(
    `${lastAssistant}.dataset.status === "stopped" && document.querySelector("#chatInput").value === "留着的话" && !${lastAssistant}.querySelector(".tool-step-note") && document.querySelectorAll('#messages .message').length === 6`
  ),
  await evalJs(`JSON.stringify([${lastAssistant}.dataset.status, document.querySelector("#chatInput").value])`)
);
close();
