// 补言：作答途中再寄来的话——模型正写着就掐断这一轮、把话递上让它改道，已写的留着；停了就放回案上；占位框在逐帧重画里不重建
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

// ---- 第一问慢慢流一块 html：占位框是同一个节点、草图上每来一行蘸一笔朱；途中补一句，流被掐断，同一答里接着写
await evalJs(
  `document.querySelector("#welcomeInput").value = "SLOWHTML 画个页"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`!!${lastAssistant}?.querySelector(".viz-pending")`, 20000);
await evalJs(`${lastAssistant}.querySelector(".viz-pending").dataset.probe = "same"; true`);
const lines1 = await evalJs(`Number(${lastAssistant}.querySelector(".viz-pending").dataset.lines)`);
await waitFor(`Number(${lastAssistant}.querySelector(".viz-pending")?.dataset.lines || 0) > ${lines1}`, 5000);
check(
  "pending viz box keeps the same node across frames, a sketch stroke flashes on new lines; no line-count copy",
  await evalJs(
    `(v => v.dataset.probe === "same" && [...v.querySelectorAll(".viz-sketch path")].some(p => p.getAnimations().some(a => !(a instanceof CSSAnimation))) && !v.textContent.includes("行") && v.style.getPropertyValue("--phase").endsWith("ms"))(${lastAssistant}.querySelector(".viz-pending"))`
  )
);
await type("PLAIN 补一句");
check("seal turns 寄 while the reply runs", (await evalJs(`document.querySelector("#chatSend").dataset.glyph`)) === "寄");
await enter();
check("composer cleared as the supplement leaves", (await evalJs(`document.querySelector("#chatInput").value`)) === "");
await waitFor(
  `document.querySelectorAll('#messages .message.assistant').length === 1 && ${lastAssistant}.dataset.status === "complete"`,
  20000
);
const turns = await evalJs(
  `(c => ({ users: c.messages.filter(m => m.role === "user").map(m => m.content), notes: (c.messages[1].steps || []).map(s => [s.name, s.status, s.result]), reply: c.messages.at(-1).content }))(JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0])`
);
check(
  "steer: the stream was cut, the supplement handed over at once and the same reply went on from there; the note step is ticked",
  turns.users.join("|") === "SLOWHTML 画个页" &&
    turns.notes.length === 1 &&
    turns.notes[0][1] === "done" &&
    /改道/.test(turns.notes[0][2]) &&
    turns.reply.includes("```html") &&
    turns.reply.endsWith("正文回答：这里有一个术语 X 需要留意。"),
  JSON.stringify(turns)
);
check("the note step shows in the trail, ticked", await evalJs(`!!${lastAssistant}.querySelector('.tool-step-note[data-status="done"]')`));

// ---- 途中补了一句又按了停：这一答没写完，补言放回案上
await type("SLOWHTML 再画");
await enter();
await waitFor(
  `document.querySelectorAll('#messages .message.assistant').length === 2 && !!${lastAssistant}.querySelector(".viz-pending")`,
  20000
);
// 停下来的一答里补言不该被递出去：先按停，再看案上——这里用一条不会被假模型接着答的方式：补言与停止几乎同时
await type("留着的话");
await evalJs(`document.querySelector("#chatSend").click(); document.querySelector("#chatSend").click(); true`);
await sleep(300);
check(
  "stopping right after a supplement puts the unsent words back into the composer and drops the step",
  await evalJs(
    `${lastAssistant}.dataset.status === "stopped" && document.querySelector("#chatInput").value === "留着的话" && !${lastAssistant}.querySelector(".tool-step-note") && document.querySelectorAll('#messages .message').length === 4`
  ),
  await evalJs(`JSON.stringify([${lastAssistant}.dataset.status, document.querySelector("#chatInput").value])`)
);
close();
