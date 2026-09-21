// 旁注：划选 → 旁注 → 面板；上下文只到所注消息；正文不受污染；收起 / 重开 / 刷新后仍在；编辑后锚点标记为另一版本
import { connect, check, sleep, PAGE, WORK, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
const mainDone = n =>
  `document.querySelectorAll('#messages .message.assistant').length === ${n} && [...document.querySelectorAll('#messages .message.assistant')].at(-1)?.dataset.status === "complete"`;
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const sendMain = async (text, n, input = "#chatInput", button = "#chatSend") => {
  await evalJs(
    `document.querySelector("${input}").value = ${JSON.stringify(text)}; document.querySelector("${input}").dispatchEvent(new Event("input")); document.querySelector("${button}").click(); true`
  );
  await waitFor(mainDone(n));
};
await sendMain("PLAIN one", 1, "#welcomeInput", "#welcome .send-trigger");
await sendMain("PLAIN MAINSECRET", 2);
// 划选第一条回复里的「术语 X」
await evalJs(
  `(() => { const p = document.querySelector('#messages .message.assistant .markdown p'); const t = p.firstChild; const r = document.createRange(); const i = t.data.indexOf("术语 X"); r.setStart(t, i); r.setEnd(t, i + 4); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`
);
await waitFor(`!document.querySelector("#quoteTip").classList.contains("hidden")`);
check(
  "tip offers 引用 and 旁注",
  (await evalJs(`[...document.querySelectorAll("#quoteTip [data-tip]")].map(b => b.textContent).join("|")`)) === "引用|旁注"
);
await evalJs(`document.querySelector('#quoteTip [data-tip="note"]').click(); true`);
await sleep(300);
check(
  "panel opens with anchor excerpt",
  await evalJs(
    `!document.querySelector("#sidePanel").classList.contains("hidden") && document.querySelector("#sideAnchor").textContent === "术语 X" && !!document.querySelector(".side-empty")`
  )
);
check(
  "note mark on the anchored message only",
  await evalJs(
    `document.querySelectorAll("#messages .note-mark").length === 1 && !!document.querySelector('#messages .message.assistant .note-mark')`
  )
);
check("header shows 旁注 count", (await evalJs(`document.querySelector("#chatMeta [data-open-notes]")?.textContent`)) === "旁注 1");
await evalJs(`document.querySelector("#sideInput").value = "SIDE why"; document.querySelector("#sideSend").click(); true`);
await waitFor(`[...document.querySelectorAll('#sideMessages .message.assistant')].at(-1)?.dataset.status === "complete"`);
const sideText = await evalJs(`[...document.querySelectorAll('#sideMessages .message.assistant .markdown')].at(-1).textContent.trim()`);
check(
  "side context: system note, quoted anchor, no later main content, lookup-only tools",
  sideText === "SIDE|sys:yes|quote:yes|secret:no|tools:search_web+fetch_page+run_js+recall+search_conversations+read_conversation|n:4",
  sideText
);
check("main line untouched", await evalJs(`document.querySelectorAll('#messages .message').length === 4`));

check(
  "side actions: copy / edit on the question, copy / regenerate on the reply (no retract, no note, no branch)",
  (await evalJs(`[...document.querySelectorAll('#sideMessages [data-action]')].map(b => b.dataset.action).join()`)) ===
    "copy,edit,copy,regenerate"
);
// 正文下一问不带旁注
await sendMain("PLAIN check", 3);
check(
  "no leak into main request",
  (await evalJs(`[...document.querySelectorAll('#messages .message.assistant .markdown')].at(-1).textContent`)).includes("leak:no")
);
// 收起再由「注」标重开；刷新后旁注仍在
await evalJs(`document.querySelector("#sideClose").click(); true`);
await sleep(300);
check(
  "panel closed keeps mark",
  await evalJs(
    `document.querySelector("#sidePanel").classList.contains("hidden") && document.querySelectorAll("#messages .note-mark").length === 1`
  )
);
await evalJs(`document.querySelector("#messages .note-mark").click(); true`);
await sleep(250);
check(
  "mark reopens thread with history",
  await evalJs(
    `!document.querySelector("#sidePanel").classList.contains("hidden") && document.querySelectorAll("#sideMessages .message").length === 2`
  )
);
await send("Page.navigate", { url: PAGE });
await sleep(1300);
check(
  "reload lands back in the conversation that was open, not on the welcome page",
  await evalJs(
    `!document.querySelector("#chat").classList.contains("hidden") && document.querySelector("#welcome").classList.contains("hidden")`
  )
);
await evalJs(`document.querySelector("#history [data-conversation] .history-open").click(); true`);
await sleep(400);
check(
  "thread persists across reload",
  await evalJs(
    `(() => { const s = __yanState(); const c = s.conversations[0]; return c.threads.length === 1 && c.threads[0].messages.length === 2 && c.messages.length === 6; })()`
  )
);
check(
  "mark visible after reload, panel closed",
  await evalJs(
    `document.querySelectorAll("#messages .note-mark").length === 1 && document.querySelector("#sidePanel").classList.contains("hidden")`
  )
);

// 落点：锚文本被包成 mark，点它打开旁注；面板开着时高亮
check(
  "inline mark on the anchored passage",
  await evalJs(
    `(m => !!m && m.textContent === "术语 X" && m.nextElementSibling?.matches("sup.note-ref") && m.nextElementSibling.textContent === "1")(document.querySelector("#messages mark.note-anchor"))`
  )
);
await evalJs(`document.querySelector('#messages mark.note-anchor').click(); true`);
await sleep(250);
check(
  "clicking the mark reopens the note",
  await evalJs(
    `!document.querySelector("#sidePanel").classList.contains("hidden") && document.querySelector("#sideAnchor").textContent === "术语 X"`
  )
);
check(
  "mark highlighted while its note is open",
  await evalJs(`document.querySelector('#messages mark.note-anchor').classList.contains("active")`)
);
await evalJs(`document.querySelector("#sideClose").click(); true`);
await sleep(250);
check("closing clears highlight", await evalJs(`!document.querySelector('#messages mark.note-anchor.active')`));
await evalJs(`document.querySelector('#messages mark.note-anchor').click(); true`);
await sleep(250);
check(
  "panel shows the conversation model",
  (await evalJs(`document.querySelector("#sidePanel .model-trigger .model-name").textContent`)) === "假模型"
);
// 回复动作里的「旁注」打开的是目录：列着这段对话里的旁注，不列范围、不设输入；「＋」另起一条——没划选就是就整条回复而谈，
// 同一条回复上可以起几条
await evalJs(`document.querySelector("#sideClose").click(); true`);
await sleep(200);
const before = await evalJs(`__yanState().conversations[0].threads.length`);
await evalJs(`[...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector('[data-action="note"]').click(); true`);
await sleep(300);
check(
  "reply action opens the index: one entry, a ＋ row, no anchor, no composer",
  await evalJs(
    `document.querySelector("#sidePanel").dataset.mode === "index" && document.querySelectorAll("#sideMessages .side-index-item").length === 1 && !!document.querySelector("#sideMessages [data-side-new]") && document.querySelector("#sideAnchor").classList.contains("hidden") && getComputedStyle(document.querySelector("#sidePanel .side-composer")).display === "none"`
  )
);
check(
  "index entry shows the anchored passage and where it sits",
  await evalJs(
    `(i => i.querySelector("strong").textContent === "术语 X" && i.querySelector("small").textContent.startsWith("第一答 · 一问"))(document.querySelector("#sideMessages .side-index-item"))`
  )
);
await evalJs(`getSelection().removeAllRanges(); document.querySelector("#sideMessages [data-side-new]").click(); true`);
await sleep(300);
check(
  "＋ without a selection starts a whole-reply note on that reply: thread mode, no anchor bar",
  (await evalJs(
    `document.querySelector("#sidePanel").dataset.mode === "thread" && document.querySelector("#sideAnchor").classList.contains("hidden") && !!document.querySelector(".side-empty")`
  )) && (await evalJs(`__yanState().conversations[0].threads.at(-1).anchor.text === ""`))
);
await evalJs(`document.querySelector("#sideInput").value = "SIDE whole"; document.querySelector("#sideSend").click(); true`);
await waitFor(`[...document.querySelectorAll('#sideMessages .message.assistant')].at(-1)?.dataset.status === "complete"`);
const wholeText = await evalJs(`[...document.querySelectorAll('#sideMessages .message.assistant .markdown')].at(-1).textContent.trim()`);
check("whole-reply note: no quote, system note present", wholeText.includes("sys:yes|quote:no"), wholeText);
await evalJs(`document.querySelector("#sideBack").click(); true`);
await sleep(250);
check(
  "‹ 目录 returns to the index with both entries; whole-reply entry leads with its first question",
  await evalJs(
    `document.querySelector("#sidePanel").dataset.mode === "index" && [...document.querySelectorAll("#sideMessages .side-index-item strong")].map(n => n.textContent).join("|") === "术语 X|SIDE whole"`
  )
);
await evalJs(`document.querySelector("#sideMessages [data-side-new]").click(); true`);
await sleep(300);
check(
  "a second whole-reply note on the same reply is allowed; the reply's mark counts 2",
  (await evalJs(`__yanState().conversations[0].threads.length`)) === before + 2 &&
    (await evalJs(`[...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".note-mark").textContent`)) ===
      "注 2"
);
await evalJs(
  `document.querySelector("#sideClose").click(); [...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".note-mark").click(); true`
);
await sleep(250);
check(
  "a mark with several notes opens the index",
  await evalJs(
    `document.querySelector("#sidePanel").dataset.mode === "index" && document.querySelectorAll("#sideMessages .side-index-item").length === 3`
  )
);
await evalJs(`[...document.querySelectorAll("#sideMessages [data-side-open]")].at(-1).click(); true`);
await sleep(250);
await evalJs(`document.querySelector("#sideInput").value = "SIDE whole"; document.querySelector("#sideSend").click(); true`);
await waitFor(`[...document.querySelectorAll('#sideMessages .message.assistant')].at(-1)?.dataset.status === "complete"`);
// 旁注里的问可编辑、答可重新生成；旁注不留版本，改了就是改了
const sideCount = () => evalJs(`document.querySelectorAll("#sideMessages .message").length`);
await evalJs(
  `[...document.querySelectorAll('#sideMessages .message.assistant')].at(-1).querySelector('[data-action="regenerate"]').click(); true`
);
await waitFor(`[...document.querySelectorAll('#sideMessages .message.assistant')].at(-1)?.dataset.status === "complete"`);
check(
  "side reply can be regenerated in place (still 2 messages, n counts the same context)",
  (await sideCount()) === 2 &&
    /^SIDE\|sys:yes\|quote:no/.test(
      await evalJs(`[...document.querySelectorAll('#sideMessages .message.assistant .markdown')].at(-1).textContent.trim()`)
    )
);
await evalJs(`document.querySelector('#sideMessages .message.user [data-action="edit"]').click(); true`);
await sleep(150);
check("side question opens an editor", await evalJs(`!!document.querySelector('#sideMessages .message-edit-input')`));
await evalJs(
  `document.querySelector('#sideMessages .message-edit-input').value = "SIDE edited"; document.querySelector('#sideMessages [data-action="save-edit"]').click(); true`
);
await waitFor(`[...document.querySelectorAll('#sideMessages .message.assistant')].at(-1)?.dataset.status === "complete"`);
check(
  "edited side question is re-asked, reply replaced",
  (await sideCount()) === 2 &&
    (await evalJs(`document.querySelector('#sideMessages .message.user .user-bubble').textContent`)) === "SIDE edited"
);
// 又一条划选的旁注 + 面板导航
await evalJs(
  `(() => { const p = document.querySelectorAll('#messages .message.assistant .markdown p')[1]; const t = p.firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 4); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`
);
await waitFor(`!document.querySelector("#quoteTip").classList.contains("hidden")`);
await evalJs(`document.querySelector('#quoteTip [data-tip="note"]').click(); true`);
await sleep(300);
check(
  "fourth thread, nav shows 4/4",
  await evalJs(
    `document.querySelector("#sideNav").textContent.includes("4/4") && document.querySelectorAll("#messages .note-mark").length === 3`
  )
);
await evalJs(`for (let i = 0; i < 3; i++) document.querySelector('#sideNav [data-side-nav="-1"]').click(); true`);
await sleep(200);
check(
  "nav back to first thread",
  await evalJs(
    `document.querySelector("#sideAnchor").textContent === "术语 X" && document.querySelectorAll("#sideMessages .message").length === 2`
  )
);
// 编辑第一问 → 第一条回复移入另一版本 → 锚点标为 lost，正文标记消失，切回版本后恢复
await evalJs(`document.querySelector("#sideClose").click(); true`);
await sleep(200);
await evalJs(`document.querySelector('#messages .message.user [data-action="edit"]').click(); true`);
await sleep(200);
await evalJs(
  `const ta = document.querySelector(".message-edit-input"); ta.value = "PLAIN edited"; document.querySelector('[data-action="save-edit"]').click(); true`
);
await waitFor(
  `[...document.querySelectorAll('#messages .message.assistant')].at(-1)?.dataset.status === "complete" && document.querySelectorAll('#messages .message').length === 2`
);
// 旁注跟着所注的那一问一答走：这条分支上没有它们，标记、计数、目录里都不见；换回去就都回来
check(
  "after edit: notes bound to the replaced messages are out of sight (no marks, no 旁注 count)",
  await evalJs(
    `document.querySelectorAll("#messages .note-mark").length === 0 && !document.querySelector("#chatMeta [data-open-notes]") && __yanState().conversations[0].threads.length === 4`
  )
);
await evalJs(`document.querySelector('#messages [data-action="branch-prev"]').click(); true`);
await sleep(400);
check(
  "switching branch back revives marks and the count",
  await evalJs(
    `document.querySelectorAll("#messages .note-mark").length === 3 && document.querySelectorAll("#messages mark.note-anchor").length === 2 && document.querySelector("#chatMeta [data-open-notes]")?.textContent === "旁注 4"`
  )
);
await evalJs(`document.querySelector("#chatMeta [data-open-notes]").click(); true`);
await sleep(200);
check(
  "header count opens the index listing all four",
  await evalJs(
    `document.querySelector("#sidePanel").dataset.mode === "index" && document.querySelectorAll("#sideMessages .side-index-item").length === 4`
  )
);
await evalJs(`document.querySelector("#sideMessages [data-side-open]").click(); true`);
await sleep(200);
check(
  "first entry opens the 术语 X note, anchor live",
  await evalJs(
    `document.querySelector("#sideAnchor").textContent === "术语 X" && !document.querySelector("#sideAnchor").classList.contains("lost")`
  )
);
await evalJs(`document.querySelector('#messages [data-action="branch-next"]').click(); true`);
await sleep(400);
check(
  "switching away while a note is open falls back to the (empty) index",
  await evalJs(
    `document.querySelector("#sidePanel").dataset.mode === "index" && document.querySelectorAll("#sideMessages .side-index-item").length === 0 && !!document.querySelector("#sideMessages [data-side-new]")`
  )
);
await evalJs(`document.querySelector('#messages [data-action="branch-prev"]').click(); true`);
await sleep(400);
check(
  "switching back restores the note that was open",
  await evalJs(
    `document.querySelector("#sidePanel").dataset.mode === "thread" && document.querySelector("#sideAnchor").textContent === "术语 X"`
  )
);
await shot("side-normal.png");
await evalJs(`document.querySelector("#sideExpand").click(); true`);
await sleep(400);
check(
  "阔 fills the whole page",
  await evalJs(
    `document.querySelector("#sidePanel").classList.contains("wide") && Math.round(document.querySelector("#sidePanel").getBoundingClientRect().width) === innerWidth && document.querySelector("#sideExpand").textContent === "窄"`
  )
);
await shot("side.png");
// 与已有旁注重叠的划选：划过了它的小标（脚注号），那个数字不算正文；两条旁注各自落得上，里面那条嵌在外面那条里
await evalJs(
  `(() => { const p = document.querySelector("#messages mark.note-anchor").closest("p"); const first = p.firstChild, last = p.lastChild; const r = document.createRange(); r.setStart(first, first.data.indexOf("一个")); r.setEnd(last, last.data.indexOf("需要") + 2); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`
);
await waitFor(`!document.querySelector("#quoteTip").classList.contains("hidden")`);
await evalJs(`document.querySelector('#quoteTip [data-tip="note"]').click(); true`);
await sleep(300);
const overlap = await evalJs(
  `(p => ({ anchor: document.querySelector("#sideAnchor").textContent, threads: new Set([...p.querySelectorAll("mark.note-anchor")].map(m => m.dataset.thread)).size, refs: [...p.querySelectorAll("sup.note-ref")].map(n => n.textContent).join(), text: p.textContent }))(document.querySelector("#messages mark.note-anchor").closest("p"))`
);
check(
  "overlapping note: sup digit dropped from anchor, both notes marked, prose intact",
  overlap.anchor === "一个术语 X 需要" &&
    overlap.threads === 2 &&
    overlap.refs === "1,2" &&
    overlap.text.replace(/[12]/g, "") === "正文回答：这里有一个术语 X 需要留意。",
  JSON.stringify(overlap)
);
// 旁注里查阅：工具轮次照跑，步骤画在这条旁注回复的行迹里，最终正文带着工具结果；两轮用量相加
await evalJs(`document.querySelector("#sideInput").value = "SIDELOOK"; document.querySelector("#sideSend").click(); true`);
await waitFor(`[...document.querySelectorAll('#sideMessages .message.assistant')].at(-1)?.dataset.status === "complete"`);
const look = await evalJs(
  `(a => ({ text: a.querySelector(".markdown").textContent.trim(), steps: [...a.querySelectorAll(".tool-step")].map(s => s.dataset.status).join() }))([...document.querySelectorAll("#sideMessages .message.assistant")].at(-1))`
);
check(
  "side note ran a lookup round and answered from it",
  look.text.endsWith("SIDELOOK|call_sl") && look.steps === "done",
  JSON.stringify(look)
);
const lookCost = await evalJs(
  `(() => { const s = __yanState(); const t = s.conversations[0].threads.find(t => t.messages.some(m => m.content && m.content.includes("SIDELOOK|"))); return t.messages.at(-1).tokenCount; })()`
);
check("side note cost sums both rounds", lookCost === 16, JSON.stringify(lookCost));
// 旁注的「寄」：没写字时素色，写了字才上印色；思绪在写时亲手收起，不会被下一帧再打开
await evalJs(`(i => { i.value = ""; i.dispatchEvent(new Event("input")); })(document.querySelector("#sideInput")); true`);
check("side seal is muted while the box is empty", await evalJs(`document.querySelector("#sideSend").classList.contains("empty")`));
await evalJs(`(i => { i.value = "SIDETHINK"; i.dispatchEvent(new Event("input")); })(document.querySelector("#sideInput")); true`);
check("side seal takes ink once there is text", await evalJs(`!document.querySelector("#sideSend").classList.contains("empty")`));
await evalJs(`document.querySelector("#sideSend").click(); true`);
await waitFor(
  `(d => d?.dataset.state === "live" && d.open)([...document.querySelectorAll("#sideMessages .message.assistant")].at(-1)?.querySelector(".reasoning"))`,
  3000
);
await evalJs(
  `[...document.querySelectorAll("#sideMessages .message.assistant")].at(-1).querySelector(".reasoning > summary").click(); true`
);
await sleep(450);
check(
  "closing live thinking in a side note stays closed while it keeps streaming",
  await evalJs(
    `(d => d.dataset.state === "live" && !d.open)([...document.querySelectorAll("#sideMessages .message.assistant")].at(-1).querySelector(".reasoning"))`
  ),
  await evalJs(
    `(d => d.dataset.state + "/" + d.open)([...document.querySelectorAll("#sideMessages .message.assistant")].at(-1).querySelector(".reasoning"))`
  )
);
await waitFor(`[...document.querySelectorAll("#sideMessages .message.assistant")].at(-1)?.dataset.status === "complete"`);
check("side seal muted again after sending", await evalJs(`document.querySelector("#sideSend").classList.contains("empty")`));
// 同一条回复里同样的词出现两次，注的是第二处：重画后仍落在第二处（记着第几次出现）
await evalJs(`document.querySelector("#sideClose").click(); true`);
await sendMain("PLAIN SAMEWORD", 4);
await evalJs(
  `(() => { const p = [...document.querySelectorAll('#messages .message.assistant .markdown p')].at(-1); const t = p.firstChild; const r = document.createRange(); const i = t.data.indexOf("StructRAG", t.data.indexOf("StructRAG") + 1); r.setStart(t, i); r.setEnd(t, i + 9); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`
);
await waitFor(`!document.querySelector("#quoteTip").classList.contains("hidden")`);
await evalJs(`document.querySelector('#quoteTip [data-tip="note"]').click(); true`);
await sleep(300);
const twice = await evalJs(
  `(p => { const m = p.querySelector("mark.note-anchor"); const r = document.createRange(); r.setStart(p, 0); r.setEnd(m, 0); return { before: r.toString(), mark: m.textContent, occurrence: __yanState().conversations[0].threads.at(-1).anchor.occurrence }; })([...document.querySelectorAll('#messages .message.assistant .markdown p')].at(-1))`
);
check(
  "note on the second occurrence lands on the second occurrence after re-render",
  twice.mark === "StructRAG" && twice.before.includes("StructRAG") && twice.occurrence === 1,
  JSON.stringify(twice)
);
close();
