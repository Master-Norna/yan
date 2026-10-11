// 补言：作答途中再寄来的话——等模型说到落点（段落尾；代码围栏里不停）才停这一轮、把话递上让它改道，已写的留着；没等到落点流就到头的作下一问；停了就放回案上；占位框在逐帧重画里不重建
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
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
  `(c => ({ users: c.messages.filter(m => m.role === "user").map(m => m.content), notes: (c.messages.at(-1).steps || []).map(s => [s.name, s.status, s.result, s.at]), reply: c.messages.at(-1).content }))(__yanState().conversations[0])`
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
// 那一步挪到递上的地方（停下的段落尾），不留在到达处：往后重装历史按它拆开这一答，先后才与模型当时读到的一样
check(
  "the delivered note sits where the round stopped, right before what the model wrote after reading it",
  steer.reply.slice(steer.notes[0][3]).startsWith("\n\n正文回答") && /。$/.test(steer.reply.slice(0, steer.notes[0][3])),
  JSON.stringify(steer.notes)
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

const ask = text =>
  evalJs(
    `document.querySelector("#newChat").click(); setTimeout(() => { document.querySelector("#welcomeInput").value = ${JSON.stringify(text)}; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
  );

// ---- 帮手在后台做：主模型说完「等回报」这一答就收尾，没有谁醒着等。这时寄出的话是新的一问、当场作答；
// 帮手做完，回报另起一答，页面上是一道细线（不是用户的气泡）
const convOf = text => `__yanState().conversations.find(c => c.messages[0]?.content === ${JSON.stringify(text)})`;
await ask("BGNOTE");
await waitFor(`${lastAssistant}?.textContent.includes("等回报") && ${lastAssistant}.dataset.status === "complete"`, 10000);
const idle = await evalJs(
  `({ helper: ${lastAssistant}.querySelector(".tool-step-delegate")?.dataset.status, seal: document.querySelector("#chatSend").dataset.glyph, bar: document.querySelector("#helperBar:not(.hidden)")?.textContent || "", tip: document.querySelector("#history .history-item.active .history-state")?.title || "" })`
);
check(
  "with only waiting left the answer closes; the helper keeps working, the bar and sidebar still show it, the seal stops it",
  idle.helper === "running" && idle.seal === "止" && idle.bar.includes("慢活") && idle.tip === "帮手在后台做",
  JSON.stringify(idle)
);
await type("BG-NOTE-TEXT 顺便改个名");
check("with words on the desk the seal sends instead", (await evalJs(`document.querySelector("#chatSend").dataset.glyph`)) === "寄");
await enter();
await waitFor(`${lastAssistant}.textContent.includes("收到补言｜reports:0") && ${lastAssistant}.dataset.status === "complete"`, 3000).catch(
  () => {}
);
check(
  "the words become a new question, answered at once while the helper is still out",
  await evalJs(
    `${lastAssistant}.textContent.includes("收到补言｜reports:0") && ${convOf("BGNOTE")}.messages.filter(m => m.role === "user").length === 2`
  )
);
await waitFor(
  `${lastAssistant}.textContent.includes("BGNOTE done｜reports:1") && ${lastAssistant}.dataset.status === "complete"`,
  15000
).catch(() => {});
const relay = await evalJs(
  `(c => ({ roles: c.messages.map(m => m.role + (m.relay ? ":relay" : "")).join(","), line: document.querySelector("#messages .message.relay")?.textContent || "", bubble: !!document.querySelector("#messages .message.relay .user-bubble"), outline: document.querySelectorAll("#outline .outline-item").length, meta: document.querySelector("#chatMeta")?.textContent || "" }))(${convOf("BGNOTE")})`
);
check(
  "the report wakes a new answer behind a thin line naming the helper",
  relay.roles === "user,assistant,user,assistant,user:relay,assistant" && relay.line.includes("帮手「慢活」回报") && !relay.bubble,
  JSON.stringify(relay)
);
check("the relay line is not counted as a question", relay.outline === 2 && relay.meta.includes("两问"), JSON.stringify(relay));
await evalJs(`document.querySelector("#messages .message.relay .relay-name").click(); true`);
await sleep(200);
check(
  "clicking the name on the line opens that helper's run",
  await evalJs(
    `!document.querySelector("#helperModal").classList.contains("hidden") && document.querySelector("#helperTitle").textContent === "慢活"`
  )
);
await evalJs(`document.querySelector("#helperClose").click(); true`);

// ---- 主模型给后台的帮手递话：帮手说到落点时读到、改口回报。递话这一步在行迹里也是一枚签，标「已更新」，点开翻到递去的那句话
await ask("HELPERTALK");
await waitFor(`${lastAssistant}?.dataset.status === "complete" && ${lastAssistant}.textContent.includes("HELPERTALK done")`, 15000).catch(
  () => {}
);
const talk = await evalJs(
  `(c => ({ text: document.querySelector("#messages").textContent, sub: c.messages.flatMap(m => m.steps || []).find(s => s.name === "delegate")?.sub, card: (d => d && { kind: d.dataset.kind, fresh: !!d.querySelector(".helper-fresh"), ref: d.dataset.ref, note: d.dataset.note, text: d.textContent })(document.querySelector('#messages .tool-step-delegate[data-kind="传话"]')) }))(${convOf("HELPERTALK")})`
);
check(
  "main model's message reaches the running helper at a natural break, and it changes course",
  talk.text.includes("收到改向｜乙") && talk.sub?.status === "complete" && talk.sub.content.includes("慢活第1句"),
  JSON.stringify({ text: talk.text.slice(-240), sub: talk.sub?.status })
);
check(
  "the passed word is a card in the trail marked 已更新, pointing at the helper and the note",
  talk.card?.fresh && talk.card.ref === "call_hp0" && !!talk.card.note && talk.card.text.includes("TALK-TEXT"),
  JSON.stringify(talk.card)
);
await evalJs(`document.querySelector('#messages .tool-step-delegate[data-kind="传话"] > .tool-step-head').click(); true`);
await sleep(300);
const panelNote = await evalJs(
  `(n => n && { label: n.querySelector(".tool-label").textContent, status: n.dataset.status, text: n.textContent, open: n.closest("details")?.open })(document.querySelector('#helperModal .tool-step[data-tool="helper_note"]'))`
);
check(
  "clicking it opens the helper with the passed words in its timeline, delivered",
  !!panelNote &&
    panelNote.label.endsWith("传话") &&
    panelNote.status === "done" &&
    panelNote.text.includes("TALK-TEXT") &&
    panelNote.open !== false,
  JSON.stringify(panelNote)
);
await evalJs(`document.querySelector("#helperClose").click(); true`);

// ---- 主模型叫停帮手：只停它一个，已做的照未完成回报（叫停得快，回报常赶在这一答收尾前到，就在这一答里递上）
await ask("HELPERSTOP");
await waitFor(`${lastAssistant}?.dataset.status === "complete" && ${lastAssistant}.textContent.includes("HELPERSTOP done")`, 15000).catch(
  () => {}
);
const halt = await evalJs(
  `(c => ({ text: c.messages.at(-1).content, sub: c.messages.flatMap(m => m.steps || []).find(s => s.name === "delegate")?.sub?.status, card: document.querySelector('#messages .tool-step-delegate[data-kind="叫停"]')?.textContent || "", line: document.querySelector("#messages .message.relay")?.textContent || "" }))(${convOf("HELPERSTOP")})`
);
check(
  "main model stops a helper; its partial report still comes back",
  halt.text.includes("已按吩咐叫停") && halt.sub === "stopped" && halt.card.includes("已叫停"),
  JSON.stringify(halt)
);

// ---- 续派：帮手收了工，主模型再交给它一件。在当前行迹里另起一枚「续派」签（已更新），帮手记得上一趟，回报照样另起一答
await ask("HELPERAGAIN");
await waitFor(`${lastAssistant}?.dataset.status === "complete" && ${lastAssistant}.textContent.includes("HELPERAGAIN done")`, 20000).catch(
  () => {}
);
const again = await evalJs(
  `(c => ({ text: c.messages.at(-1).content, runs: c.messages.flatMap(m => m.steps || []).filter(s => s.sub).map(s => s.name + ":" + s.status + ":" + s.sub.task.slice(0, 10) + ":" + (s.sub.helper === c.messages.flatMap(m => m.steps || []).find(x => x.name === "delegate")?.sub.helper)), card: (d => d && { fresh: !!d.querySelector(".helper-fresh"), status: d.dataset.status })(document.querySelector('#messages .tool-step-delegate[data-kind="续派"]')) }))(${convOf("HELPERAGAIN")})`
);
check(
  "a finished helper is sent again: a new run of the same helper, which remembers its last run",
  again.runs.length === 2 &&
    again.runs[1].startsWith("helper:done:AGAIN-TEXT") &&
    again.runs[1].endsWith(":true") &&
    again.text.includes("再做回报｜seen:yes|first:yes"),
  JSON.stringify(again)
);
check("the re-dispatch is its own card marked 已更新", again.card?.fresh && again.card.status === "done", JSON.stringify(again.card));
await evalJs(`document.querySelector('#messages .tool-step-delegate[data-kind="续派"] > .tool-step-head').click(); true`);
await sleep(300);
const againPanel = await evalJs(
  `({ task: document.querySelector("#helperTaskText").textContent, nav: document.querySelector("#helperNav .helper-nav-count")?.textContent || "", report: document.querySelector("#helperModal .sub-report")?.textContent || "" })`
);
check(
  "its panel shows the new task and report, and pages with the first run",
  againPanel.task.startsWith("AGAIN-TEXT") && againPanel.nav === "2/2" && againPanel.report.startsWith("再做回报"),
  JSON.stringify(againPanel)
);
await evalJs(`document.querySelector("#helperClose").click(); true`);

// ---- 这一答收了尾、帮手还在做：案上空着按印即叫停帮手，不回报、也不另起一答
await ask("BGLONG");
await waitFor(`${lastAssistant}?.textContent.includes("等回报") && ${lastAssistant}.dataset.status === "complete"`, 10000);
await evalJs(`document.querySelector("#chatSend").click(); true`);
await sleep(600);
const halted = await evalJs(
  `(c => ({ step: c.messages.flatMap(m => m.steps || []).find(s => s.name === "delegate"), n: c.messages.length, seal: document.querySelector("#chatSend").dataset.glyph }))(${convOf("BGLONG")})`
);
check(
  "with the answer closed, the seal stops the helper outright: no report, no new answer",
  halted.step?.status === "error" && halted.step.result === "已停止" && halted.n === 2 && halted.seal !== "止",
  JSON.stringify({ status: halted.step?.status, result: halted.step?.result, n: halted.n, seal: halted.seal })
);

// ---- 想得很久：补言默认等它开口；点那一步上的折箭头，不等落点当场递上
await ask("SLOWTHINK");
await waitFor(`!!${lastAssistant}?.querySelector(".reasoning")`, 10000);
await type("PLAIN 改道");
await enter();
await sleep(400);
check(
  "while it thinks, the supplement waits with a send-now arrow beside the spinner",
  await evalJs(
    `(s => !!s && s.dataset.status === "running" && !!s.querySelector(".note-now + .tool-state.spinning"))(${lastAssistant}.querySelector(".tool-step-note"))`
  )
);
await evalJs(`${lastAssistant}.querySelector(".tool-step-note").scrollIntoView({ block: "center" }); true`);
await shot("note-now.png");
await evalJs(`${lastAssistant}.querySelector(".note-now").click(); true`);
const forced = await waitFor(`${lastAssistant}.querySelector(".tool-step-note")?.dataset.status === "done"`, 1500).then(
  () => true,
  () => false
);
check("the arrow delivers it right away", forced);
await waitFor(`${lastAssistant}.dataset.status !== "streaming"`, 15000);
const turned = await evalJs(`${lastAssistant}.textContent`);
check(
  "the model turned to the supplement instead of finishing the old thought",
  turned.includes("正文回答") && !turned.includes("SLOWTHINK done"),
  turned.slice(0, 200)
);
close();
