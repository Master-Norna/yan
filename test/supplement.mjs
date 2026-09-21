// 补言：作答途中再寄来的话——等模型说到落点（段落尾；代码围栏里不停）才停这一轮、把话递上让它改道，已写的留着；没等到落点流就到头的作下一问；停了就放回案上；占位框在逐帧重画里不重建
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

// ---- 第一问慢慢流一块 html：占位框是同一个节点、草图上每来一行蘸一笔朱；途中补一句——正在代码围栏里，不停它；
// 流很快到头、没有下一回合，补言落笔后成了下一问
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
await sleep(100);
check(
  "supplement pending: 补言 step waiting in the trail, composer cleared",
  await evalJs(
    `!!${lastAssistant}.querySelector('.tool-step-note[data-status="running"]') && document.querySelector("#chatInput").value === ""`
  )
);
// 围栏一闭合就是落点：流若还没到头就停在那儿引路（同一答里接着写）；流先到头了就作下一问。两种都对，看谁先到
await waitFor(
  `[...document.querySelectorAll('#messages .message.assistant')].every(m => m.dataset.status === "complete") && (document.querySelectorAll('#messages .message.assistant').length === 2 || !!${lastAssistant}.querySelector('.tool-step-note[data-status="done"]'))`,
  20000
);
const turns = await evalJs(
  `(c => ({ users: c.messages.filter(m => m.role === "user").map(m => m.content), notes: (c.messages[1].steps || []).map(s => [s.name, s.status, s.result]), reply: c.messages.at(-1).content }))(__yanState().conversations[0])`
);
check(
  "inside the fence the reply is not stopped; the supplement is handed over at the fence close (same reply) or, if the stream ended first, as the next question",
  turns.users.length === 2
    ? turns.users[1] === "PLAIN 补一句" && turns.notes.length === 0 && turns.reply.startsWith("正文回答")
    : turns.notes.length === 1 && /引路/.test(turns.notes[0][2]) && /```\n\n正文回答：这里有一个术语 X 需要留意。$/.test(turns.reply),
  JSON.stringify(turns)
);

// ---- 一段一段慢慢说的正文：补言到了，等到段落尾才停下这一轮，把话递上，同一答里接着写
await type("SLOWTEXT 慢慢说");
await enter();
const before = await evalJs(`document.querySelectorAll('#messages .message.assistant').length`);
await waitFor(
  `document.querySelectorAll('#messages .message.assistant').length === ${before + 1} && (${lastAssistant}?.textContent || "").includes("第2段")`,
  20000
);
await type("PLAIN 补一句");
await enter();
await waitFor(
  `document.querySelectorAll('#messages .message.assistant').length === ${before + 1} && ${lastAssistant}.dataset.status === "complete"`,
  30000
);
const steer = await evalJs(
  `(c => ({ users: c.messages.filter(m => m.role === "user").map(m => m.content), notes: (c.messages.at(-1).steps || []).map(s => [s.name, s.status, s.result]), reply: c.messages.at(-1).content }))(__yanState().conversations[0])`
);
const cutParagraphs = (steer.reply.match(/第\d+段/g) || []).length;
check(
  "steer: the round stopped at a paragraph end, the supplement handed over and the same reply went on; the note step is ticked",
  steer.users.at(-1) === "SLOWTEXT 慢慢说" &&
    steer.notes.length === 1 &&
    steer.notes[0][1] === "done" &&
    /引路/.test(steer.notes[0][2]) &&
    cutParagraphs >= 2 &&
    cutParagraphs < 20 &&
    /再说一句。\n\n正文回答：这里有一个术语 X 需要留意。$/.test(steer.reply),
  JSON.stringify(steer)
);
check("the note step shows in the trail, ticked", await evalJs(`!!${lastAssistant}.querySelector('.tool-step-note[data-status="done"]')`));

// ---- 途中补了一句又按了停：围栏里不会停它，补言一直待寄；这一答没写完就按停，补言放回案上
await type("SLOWHTML 再画");
await enter();
await waitFor(
  `document.querySelectorAll('#messages .message.assistant').length === ${before + 2} && !!${lastAssistant}.querySelector(".viz-pending")`,
  20000
);
await type("留着的话");
await enter();
await sleep(80);
check("pending again", await evalJs(`!!${lastAssistant}.querySelector('.tool-step-note[data-status="running"]')`));
await evalJs(`document.querySelector("#chatSend").click(); true`);
await sleep(300);
check(
  "stopping puts the unsent supplement back into the composer and drops the step",
  await evalJs(
    `${lastAssistant}.dataset.status === "stopped" && document.querySelector("#chatInput").value === "留着的话" && !${lastAssistant}.querySelector(".tool-step-note") && document.querySelectorAll('#messages .message.assistant').length === ${before + 2}`
  ),
  await evalJs(`JSON.stringify([${lastAssistant}.dataset.status, document.querySelector("#chatInput").value])`)
);
close();
