// 录（记忆）：提示只在启用时进；remember / replaces / recall / search_conversations / read_conversation；设置页可改可删；关闭后不再提供
import { connect, check, sleep, PAGE, WORK, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
const mainDone = n =>
  `document.querySelectorAll('#messages .message.assistant').length === ${n} && [...document.querySelectorAll('#messages .message.assistant')].at(-1)?.dataset.status === "complete"`;
const lastText = () =>
  evalJs(
    `[...[...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelectorAll('.markdown')].map(n => n.textContent.trim()).join(" ")`
  );
const memory = () => evalJs(`__yanState().memory`);
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
// 预置一段旧对话，供 search_conversations / read_conversation 查
const old = {
  id: "0123456789abcdef-0123-4567-89ab-0123456789ab",
  title: "旧谈一则",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:10:00.000Z",
  profileId: "p1",
  forks: [],
  threads: [],
  messages: [
    { id: "u1", role: "user", content: "请解释术语 X", createdAt: "2026-09-01T08:00:00.000Z", status: "complete" },
    {
      id: "a1",
      role: "assistant",
      content: "术语 X 的意思是旧谈里的秘密 OLDSECRET。",
      createdAt: "2026-09-01T08:01:00.000Z",
      status: "complete"
    }
  ]
};
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [${JSON.stringify(old)}], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
check(
  "memory defaults to enabled with no items",
  await evalJs(`(m => !m || (m.enabled === true && m.items.length === 0))(__yanState().memory)`)
);
const sendMain = async (text, n, input = "#chatInput", button = "#chatSend") => {
  await evalJs(
    `document.querySelector("${input}").value = ${JSON.stringify(text)}; document.querySelector("${input}").dispatchEvent(new Event("input")); document.querySelector("${button}").click(); true`
  );
  await waitFor(mainDone(n), 40000);
};
await sendMain("MEMORY go", 1, "#welcomeInput", "#welcome .send-trigger");
const text = await lastText();
check("memory hint in system prompt", text.includes("MEM|hint:yes"), text);
check("remember → replaces merged into one entry", text.includes("已记入 [m") && text.includes("已更新 [m"), text);
const mem = await memory();
check(
  "store holds exactly one merged item with source",
  mem.items.length === 1 && mem.items[0].text === "用户偏好 PowerShell 而非 bash，且要求中文交流" && !!mem.items[0].source?.conversationId,
  JSON.stringify(mem.items)
);
check("recall returns the merged item with its category", /▸ \[m[a-z0-9]+\] \d{4}-\d{2}-\d{2}｜偏好｜用户偏好 PowerShell/.test(text), text);
check("an overlong item is sent back, not cut", text.includes("超过 2000 字") && (await memory()).items.length === 1, text);
check("recall with no arguments lists the categories", text.includes("▸ 偏好（1 条，最近"), text);
check("the item is filed under its category", (await memory()).items[0].category === "偏好");
check(
  "search_conversations finds the old talk, not the current one",
  text.includes("「旧谈一则」共 2 条") && !text.includes("MEMORY go"),
  text
);
check(
  "read_conversation returns the old transcript",
  text.includes("「旧谈一则」2026-09-01") &&
    (await evalJs(
      `[...document.querySelectorAll('#messages .tool-step')].some(s => s.dataset.status === "done" && s.textContent.includes("翻旧谈") && s.textContent.includes("旧谈一则"))`
    )),
  text
);
const labels = await evalJs(`[...document.querySelectorAll('#messages .tool-step .tool-label')].map(n => n.textContent).join("|")`);
check("step cards labeled in the house style", labels === "记入|记入|翻记忆|查旧谈|翻旧谈|记入|翻记忆", labels);
check("no approval was asked", await evalJs(`!document.querySelector('#messages .tool-step[data-status="pending"]')`));
// 出处：翻过的记忆与旧谈列在回复底部，点开各归其处
const sources = await evalJs(
  `(d => d ? { count: d.querySelector("summary small").textContent, cards: [...d.querySelectorAll(".source-card")].map(c => c.querySelector("strong").textContent + "|" + c.querySelector("small").textContent + "|" + (c.querySelector(".source-read") ? "read" : "")) } : null)([...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".source-stack"))`
);
check(
  "sources card lists the old talk (read) and the memory",
  !!sources &&
    sources.count === "2 条" &&
    sources.cards[0] === "旧谈一则|旧谈 · 九月一日|read" &&
    sources.cards[1] === "用户偏好 PowerShell 而非 bash，且要求中文交流|记忆|",
  JSON.stringify(sources)
);
await evalJs(
  `[...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".source-stack").open = true; document.querySelector('#messages [data-open-memory]').click(); true`
);
await sleep(300);
check(
  "memory card opens the memory settings tab",
  await evalJs(
    `!document.querySelector("#settingsModal").classList.contains("hidden") && document.querySelector(".tab-btn.active").dataset.tab === "memory"`
  )
);
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sleep(300);
await evalJs(
  `[...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".source-stack").open = true; document.querySelector('#messages [data-open-talk]').click(); true`
);
await sleep(400);
check(
  "talk card opens that conversation",
  await evalJs(
    `document.querySelector("#history .active, #history [aria-current]")?.textContent.includes("旧谈一则") || document.querySelector("#messages .message.assistant .markdown")?.textContent.includes("OLDSECRET")`
  )
);
await evalJs(
  `[...document.querySelectorAll("#history [data-id], #history .history-item")].find(n => n.textContent.includes("MEMORY go"))?.click(); true`
);
await sleep(400);
// 设置页：记忆栏、改、删
await evalJs(`document.querySelector("#openSettings")?.click() || document.querySelector('[data-open-settings]')?.click(); true`);
await sleep(200);
await evalJs(`document.querySelector('.tab-btn[data-tab="memory"]').click(); true`);
await sleep(200);
check(
  "memory tab renders with seal and count",
  await evalJs(
    `(h => h.querySelector(".settings-mark path") && h.querySelector("h2")?.textContent === "记忆" && h.querySelector(".settings-meta")?.textContent === "1 / 324 条 · 1 类" && h.querySelectorAll(".memory-cat[data-memory-cat]").length === 1 && h.querySelector(".memory-cat.active") && h.querySelectorAll(".memory-item").length === 1 && !h.querySelector(".memory-item textarea"))(document.querySelector("#settingsContent"))`
  )
);
await evalJs(`document.querySelector('#settingsContent [data-memory-cat="偏好"]').click(); true`);
await sleep(150);
check("opening a category lists its items", await evalJs(`document.querySelectorAll("#settingsContent .memory-item").length === 1`));
// 条目平时一行摘要，点开才摊开全文、露出来源与小画；点「改」才换成输入框
await evalJs(`document.querySelector("#settingsContent .memory-row").click(); true`);
await sleep(100);
check(
  "an item opens in place and shows its source conversation",
  await evalJs(
    `!!document.querySelector('#settingsContent .memory-item.open .memory-body') && !!document.querySelector('#settingsContent [data-memory-open]')`
  )
);
await shot("memory-settings.png");
await evalJs(`document.querySelector("#settingsContent [data-memory-edit]").click(); true`);
await sleep(100);
await evalJs(
  `(a => { a.value = "改过的记忆"; a.dispatchEvent(new Event("input")); })(document.querySelector("#settingsContent .memory-text")); true`
);
await sleep(400);
check("editing the text saves", (await memory()).items[0].text === "改过的记忆");
await evalJs(
  `(a => { a.value = "长".repeat(2005); a.dispatchEvent(new Event("input")); })(document.querySelector("#settingsContent .memory-text")); true`
);
check(
  "an overlong manual edit stays in the field and does not overwrite the saved memory",
  (await memory()).items[0].text === "改过的记忆" &&
    (await evalJs(
      `(a => a.value.length === 2005 && !a.validity.valid && a.validationMessage.includes("2000"))(document.querySelector("#settingsContent .memory-text"))`
    ))
);
await evalJs(`document.querySelector("#settingsContent [data-memory-edit]").click(); true`);
check(
  "an invalid edit cannot be completed",
  await evalJs(`document.querySelector("#settingsContent .memory-text")?.value.length === 2005`)
);
await evalJs(
  `(a => { a.value = "改过的记忆"; a.dispatchEvent(new Event("input")); })(document.querySelector("#settingsContent .memory-text")); true`
);
check("shortening the edit clears the error", await evalJs(`document.querySelector("#settingsContent .memory-text").validity.valid`));
await evalJs(`document.querySelector("#addMemory").click(); true`);
await sleep(100);
await evalJs(
  `(a => { a.value = "手写的一条"; a.dispatchEvent(new Event("input")); })(document.querySelector('#settingsContent .memory-item:last-child .memory-text') || [...document.querySelectorAll("#settingsContent .memory-text")].find(a => !a.value)); true`
);
await sleep(400);
check("hand-written item added", (await memory()).items.length === 2 && (await memory()).items.some(i => i.text === "手写的一条"));
await evalJs(`document.querySelector('#settingsContent .memory-item [data-memory-delete]').click(); true`);
await sleep(200);
check("delete removes one", (await memory()).items.length === 1);
// 归入别类：摊开一条，点那枚小画弹出各类，另起一类即就地写名、回车落定
await evalJs(`document.querySelector("#settingsContent .memory-row").click(); true`);
await sleep(100);
await evalJs(`document.querySelector("#settingsContent [data-memory-move]").click(); true`);
await sleep(150);
check(
  "the category menu is the app's own pop, above the settings window",
  await evalJs(
    `(p => !!p && getComputedStyle(p).zIndex === "60" && !!p.querySelector('[data-menu="new"]'))(document.querySelector(".chip-pop.floating"))`
  )
);
await evalJs(`document.querySelector('.chip-pop.floating [data-menu="new"]').click(); true`);
await sleep(100);
await evalJs(
  `(i => { i.value = "工作"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })(document.querySelector("#settingsContent input.memory-move")); true`
);
await sleep(200);
check(
  "an item can be filed under another category; the emptied one goes away",
  (await memory()).items[0].category === "工作" &&
    (await evalJs(
      `[...document.querySelectorAll("#settingsContent .memory-cat span")].map(n => n.textContent).join() === "工作" && document.querySelectorAll("#settingsContent .memory-item").length === 1`
    ))
);
// 另起一类：写名回车即在新类里手记第一条；第一条没写就离开，这一类随之消失
await evalJs(`document.querySelector("#newMemoryCat").click(); true`);
await evalJs(
  `(i => { i.value = "新类"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })(document.querySelector("#settingsContent input.memory-cat-new")); true`
);
await sleep(150);
check(
  "a new category opens with its first item being written",
  await evalJs(
    `document.querySelector("#settingsContent .memory-cat.active span")?.textContent === "新类" && !!document.activeElement?.matches(".memory-text")`
  )
);
await evalJs(`document.activeElement.blur(); true`);
await sleep(150);
check(
  "leaving its first item empty drops the new category",
  (await memory()).items.length === 1 &&
    (await evalJs(`![...document.querySelectorAll("#settingsContent .memory-cat span")].some(n => n.textContent === "新类")`))
);
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sleep(300);
// 同一轮里重复 recall 不复用缓存
await sendMain("MEMORY-TWICE", 2);
const twice = await lastText();
check(
  "second recall in the same turn sees the new entry",
  twice.includes("没有相关条目 ▸ 已记入") && /▸ \[m[a-z0-9]+\] \d{4}-\d{2}-\d{2}｜杂记｜twice 关键词的记忆/.test(twice),
  twice
);
check("the system prompt names the categories", twice.includes("TWICE|cats:yes"), twice);
check(
  "no memory step was served from cache",
  await evalJs(
    `[...[...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelectorAll('.tool-step .tool-meta')].every(n => !n.textContent.includes("复用"))`
  )
);
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(200);
await evalJs(`document.querySelector('.tab-btn[data-tab="memory"]').click(); true`);
await sleep(200);
// 关闭记忆：提示与工具都不再给
await evalJs(`document.querySelector('[data-setting="memoryEnabled"][data-value="false"]').click(); true`);
await sleep(200);
check("toggle persists", (await memory()).enabled === false && (await memory()).items.length === 2);
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sleep(300);
await sendMain("MEMORY-OFF", 3);
const off = await lastText();
check("disabled: no hint, no memory tools", off === "OFF|hint:no|tools:0", off);
close();
