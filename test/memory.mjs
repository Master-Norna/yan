// 录（记忆）：专司「记忆」配好时整份记忆进系统提示、每段头一问时定格；主模型没有记与忘；查旧谈（关键词与最近）、翻旧谈；
// 一答落定即交专司「记忆」整理、不等离开（只给用户的话与答复、照增删改清单改、只交新近的）；设置页可改可删；专司里关掉即不带不记
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
const FAKE = "http://127.0.0.1:8798";
const mainDone = n =>
  `document.querySelectorAll('#messages .message.assistant').length === ${n} && [...document.querySelectorAll('#messages .message.assistant')].at(-1)?.dataset.status === "complete"`;
const lastText = () =>
  evalJs(
    `[...[...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelectorAll('.markdown')].map(n => n.textContent.trim()).join(" ")`
  );
const memory = () => evalJs(`__yanState().memory`);
const tidyAsks = async () => (await fetch(`${FAKE}/tidy-asks`)).json();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
// 预置一段旧对话，供查旧谈、翻旧谈；它在记忆开起之前，离开它不拿去整理
const old = {
  id: "0123456789abcdef-0123-4567-89ab-0123456789ab",
  title: "旧谈一则",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:10:00.000Z",
  profileId: "p1",
  forks: [],
  threads: [],
  messages: [
    { id: "u1", role: "user", content: "请解释术语 X", timestamp: "2026-09-01T08:00:00.000Z", status: "complete" },
    {
      id: "a1",
      role: "assistant",
      content: "术语 X 的意思是旧谈里的秘密 OLDSECRET。",
      timestamp: "2026-09-01T08:01:00.000Z",
      status: "complete"
    }
  ]
};
const duty = { on: true, api: "openai", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", model: "tidy", modelList: [] },
  seed = [
    ["m0001", "用户偏好中文交流"],
    ["m0002", "用户偏好 PowerShell"]
  ].map(([id, text]) => ({
    id,
    text,
    category: "偏好",
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    source: null
  }));
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false, dutyMemory: ${JSON.stringify(duty)} }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [${JSON.stringify(old)}], memory: { since: "2026-10-01T00:00:00.000Z", items: ${JSON.stringify(seed)} }, library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await tidyAsks();
const sendMain = async (text, n, input = "#chatInput", button = "#chatSend") => {
  await evalJs(
    `document.querySelector("${input}").value = ${JSON.stringify(text)}; document.querySelector("${input}").dispatchEvent(new Event("input")); document.querySelector("${button}").click(); true`
  );
  await waitFor(mainDone(n), 40000);
};
const openTalk = title =>
  evalJs(
    `[...document.querySelectorAll("#history [data-conversation]")].find(n => n.textContent.includes(${JSON.stringify(title)})).querySelector(".history-open").click(); true`
  );
const newChat = async () => {
  await evalJs(`document.querySelector("#newChat").click(); true`);
  await waitFor(`!document.querySelector("#welcome").classList.contains("hidden")`);
};

await sendMain("MEMORY go", 1, "#welcomeInput", "#welcome .send-trigger");
check(
  "memory rides in the system prompt; no memory tools; search, read and recent all work",
  (await lastText()) === "MEM|body:yes|memtools:0|search:yes|read:yes|recent:yes|self:no",
  await lastText()
);
const labels = await evalJs(`[...document.querySelectorAll('#messages .tool-step .tool-label')].map(n => n.textContent).join("|")`);
check("step cards labeled in the house style", labels === "查旧谈|翻旧谈|查旧谈", labels);
const sources = await evalJs(
  `(d => d ? [...d.querySelectorAll(".source-card")].map(c => c.querySelector("strong").textContent + "|" + (c.querySelector(".source-read") ? "read" : "")) : null)([...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".source-stack"))`
);
check("sources list the old talk, read", JSON.stringify(sources) === JSON.stringify(["旧谈一则|read"]), JSON.stringify(sources));

// 一答落定：人还在这段，也即交专司「记忆」整理，照清单改
await waitFor(`__yanState().memory.items.some(i => i.text === "用户在做言的记忆模块")`, 20000);
const asks = await tidyAsks();
check("an answer settling tidies the chat without leaving it", asks.length === 1, JSON.stringify(asks.length));
check(
  "the tidier sees the memory and the user's and model's words, not tool output",
  asks[0].user.includes("【用户】MEMORY go") && asks[0].user.includes("MEM|body:yes") && !asks[0].user.includes("OLDSECRET"),
  asks[0]?.user
);
// 交给整理的是整份现有记忆
const listed = asks[0].user.split("\n").filter(line => /^\[m/.test(line));
check(
  "the tidier sees every item, with its id",
  listed.length === 2 && listed.some(l => l.includes("[m0001]")) && listed.some(l => l.includes("[m0002]")),
  JSON.stringify(listed)
);
const tidied = await memory();
check(
  "add, update and delete land; an unknown id is skipped",
  tidied.items.length === 2 &&
    tidied.items.some(i => i.text === "用户偏好 PowerShell 而非 bash" && i.category === "偏好" && !!i.source?.conversationId) &&
    tidied.items.some(i => i.text === "用户在做言的记忆模块" && i.category === "工作") &&
    !tidied.items.some(i => i.id === "m0001" || i.text.includes("认不得")),
  JSON.stringify(tidied.items)
);
check(
  "the chat records how far it was tidied",
  await evalJs(
    `(c => !!c.memoryAt && c.memoryAt === c.messages.at(-1).timestamp)(__yanState().conversations.find(c => c.messages.some(m => m.content === "MEMORY go")))`
  )
);
check("a notice says what changed", await evalJs(`document.querySelector("#toast").textContent === "记忆：记下 1 条、改 1 条、删 1 条"`));

// 同一段里再问：系统提示仍是头一问时那份，此后整理的都不进去（缓存接得上）；答完只整理这一问
await sendMain("MEMORY-SNAP", 2);
check("the memory is frozen for the chat at its first ask", (await lastText()) === "SNAP|bash:no|work:no|zh:yes", await lastText());
await waitFor(
  `(c => c.memoryAt === c.messages.at(-1).timestamp)(__yanState().conversations.find(c => c.messages.some(m => m.content === "MEMORY go")))`
);
const again = await tidyAsks();
check(
  "the next answer tidies only what is new",
  again.length === 1 && again[0].user.includes("【用户】MEMORY-SNAP") && !again[0].user.includes("【用户】MEMORY go"),
  JSON.stringify(again.map(a => a.user.slice(-80)))
);

// 新起一段：带的是整理过的记忆
await newChat();
await sendMain("MEMORY-SNAP", 1, "#welcomeInput", "#welcome .send-trigger");
await waitFor(`[...document.querySelectorAll('#messages .message.assistant')].at(-1)?.textContent.includes("SNAP|")`);
check("a new chat carries the tidied memory", (await lastText()) === "SNAP|bash:yes|work:yes|zh:no", await lastText());
await waitFor(
  `__yanState().conversations.every(c => !c.messages.some(m => m.content === "MEMORY-SNAP") || c.memoryAt === c.messages.at(-1).timestamp)`
);
await tidyAsks();
// 来回换段：离开不再整理
await openTalk("MEMORY go");
await sleep(300);
await openTalk("旧谈一则");
await sleep(800);
check("leaving a chat does not tidy it", (await tidyAsks()).length === 0);

// 设置页：记忆栏、改、删
await evalJs(`document.querySelector("#openSettings")?.click() || document.querySelector('[data-open-settings]')?.click(); true`);
await sleep(200);
await evalJs(`document.querySelector('.tab-btn[data-tab="memory"]').click(); true`);
await sleep(200);
check(
  "memory tab renders with seal, count, length and the duty state",
  await evalJs(
    `(h => h.querySelector(".settings-mark path") && h.querySelector("h2")?.textContent === "记忆" && /^2 条 · \\d+ 字 · 2 类$/.test(h.querySelector(".settings-meta")?.textContent) && h.querySelector(".setting-copy strong")?.textContent === "带进对话" && h.querySelectorAll(".memory-cat[data-memory-cat]").length === 2 && !h.querySelector(".memory-item textarea"))(document.querySelector("#settingsContent"))`
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
check(
  "editing the text saves",
  (await memory()).items.some(i => i.text === "改过的记忆")
);
await evalJs(`document.querySelector("#settingsContent [data-memory-edit]").click(); true`);
await sleep(100);
await evalJs(`document.querySelector("#addMemory").click(); true`);
await sleep(100);
await evalJs(
  `(a => { a.value = "手写的一条"; a.dispatchEvent(new Event("input")); })([...document.querySelectorAll("#settingsContent .memory-text")].find(a => !a.value)); true`
);
await sleep(400);
check("hand-written item added", (await memory()).items.length === 3 && (await memory()).items.some(i => i.text === "手写的一条"));
await evalJs(`document.activeElement.blur(); true`);
await sleep(150);
await evalJs(
  `[...document.querySelectorAll("#settingsContent .memory-item")].find(n => n.textContent.includes("手写的一条")).querySelector("[data-memory-delete], .memory-row").click(); true`
);
await sleep(100);
await evalJs(`document.querySelector('#settingsContent .memory-item.open [data-memory-delete]')?.click(); true`);
await sleep(200);
check("delete removes one", (await memory()).items.length === 2);
// 归入别类：摊开一条，点那枚小画弹出各类，另起一类即就地写名、回车落定
await evalJs(`document.querySelector('#settingsContent [data-memory-cat="偏好"]').click(); true`);
await sleep(100);
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
  `(i => { i.value = "杂项"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })(document.querySelector("#settingsContent input.memory-move")); true`
);
await sleep(200);
check(
  "an item can be filed under another category; the emptied one goes away",
  (await memory()).items.some(i => i.category === "杂项") &&
    (await evalJs(`![...document.querySelectorAll("#settingsContent .memory-cat span")].some(n => n.textContent === "偏好")`))
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
  (await memory()).items.length === 2 &&
    (await evalJs(`![...document.querySelectorAll("#settingsContent .memory-cat span")].some(n => n.textContent === "新类")`))
);
// 「专司」一钮直达专司那一栏，记忆卡摊开着；在那里关掉
await evalJs(`document.querySelector("#memoryDuty").click(); true`);
await sleep(200);
check(
  "the duty button opens the memory card under duties",
  await evalJs(`document.querySelector(".tab-btn.active").dataset.tab === "duty" && document.querySelector('[data-duty="memory"]').open`)
);
await evalJs(`document.querySelector('[data-duty-on="memory"][data-value="false"]').click(); true`);
await sleep(200);
check(
  "turning it off persists, items kept",
  (await evalJs(`__yanState().settings.dutyMemory.on === false`)) && (await memory()).items.length === 2
);
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sleep(300);
await newChat();
await sendMain("MEMORY-OFF", 1, "#welcomeInput", "#welcome .send-trigger");
await waitFor(`[...document.querySelectorAll('#messages .message.assistant')].at(-1)?.textContent.includes("OFF|")`);
check(
  "off: no memory, no memory tools, past chats still searchable",
  (await lastText()) === "OFF|body:no|memtools:0|talks:2",
  await lastText()
);
await openTalk("旧谈一则");
await sleep(800);
check("off: leaving a chat does not tidy it", (await tidyAsks()).length === 0);
close();
