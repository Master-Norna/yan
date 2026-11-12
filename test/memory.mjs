// 录（记忆）：专司「记忆优化」配好时整份记忆进系统提示（一类一段）、每段头一问时定格；remember 写一类的全文、写空即删；
// 查旧谈（关键词与最近）、翻旧谈；记忆改过后一答落定即交专司「记忆优化」理一遍（只读记忆、照清单改那几类），没改过不理；
// 旧版一条一事的同类几条读入时并成一类；设置页一类一份全文，可改、改空即删、改名并类；专司里关掉即不带不记
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
const tuneAsks = async () => (await fetch(`${FAKE}/tidy-asks`)).json();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
// 预置一段旧对话，供查旧谈、翻旧谈
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
// 旧版一条一事：同类两条（一条还带着出处），读入时并成「偏好」一类；tunedAt 晚于它们，开页时不算改过
const duty = { on: true, api: "openai", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", model: "tidy", modelList: [] },
  seed = [
    {
      id: "m0001",
      text: "用户偏好中文交流",
      category: "偏好",
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
      source: null
    },
    {
      id: "m0002",
      text: "用户偏好中文交流",
      category: "偏好",
      createdAt: "2026-10-03T00:00:00.000Z",
      updatedAt: "2026-10-03T00:00:00.000Z",
      source: { conversationId: "gone", title: "早没了的对话" }
    }
  ];
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false, dutyMemory: ${JSON.stringify(duty)} }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [${JSON.stringify(old)}], memory: { tunedAt: "2026-10-05T00:00:00.000Z", items: ${JSON.stringify(seed)} }, library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await tuneAsks();
check(
  "old one-fact items of a category merge into one, without their source",
  await evalJs(
    `(m => m.items.length === 1 && m.items[0].category === "偏好" && m.items[0].text === "用户偏好中文交流" && !("source" in m.items[0]))(__yanState().memory)`
  )
);
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
  "memory rides in the system prompt by category; remember rewrites, adds and drops a category; search, read and recent work",
  (await lastText()) === "MEM|body:yes|forget:no|rewrote:yes|added:yes|dropped:yes|search:yes|read:yes|recent:yes|self:no",
  await lastText()
);
const labels = await evalJs(`[...document.querySelectorAll('#messages .tool-step .tool-label')].map(n => n.textContent).join("|")`);
check("step cards labeled in the house style", labels === "记入|记入|记入|查旧谈|翻旧谈|查旧谈", labels);
const sources = await evalJs(
  `(d => d ? [...d.querySelectorAll(".source-card")].map(c => c.querySelector("strong").textContent + "|" + (c.querySelector(".source-read") ? "read" : "")) : null)([...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".source-stack"))`
);
check("sources list the old talk, read", JSON.stringify(sources) === JSON.stringify(["旧谈一则|read"]), JSON.stringify(sources));

// 这一答改过记忆：落定即交专司「记忆优化」，只读记忆本身，照清单改那几类
await waitFor(`__yanState().memory.items.some(i => i.category === "工作")`, 20000);
const asks = await tuneAsks();
check("memory changed in an answer gets optimized once it settles", asks.length === 1, JSON.stringify(asks.length));
check(
  "the optimizer reads the memory by category, not the chat",
  asks[0].user.includes("「偏好」\n用户偏好中文交流\n用户偏好 PowerShell") &&
    !asks[0].user.includes("MEMORY go") &&
    !asks[0].user.includes("杂记"),
  asks[0]?.user
);
const tuned = await memory();
check(
  "its rewrites land per category",
  tuned.items.length === 2 &&
    tuned.items.some(i => i.category === "偏好" && i.text === "用户偏好中文交流；命令用 PowerShell 而非 bash") &&
    tuned.items.some(i => i.category === "工作" && i.text === "用户在做言的记忆模块") &&
    !!tuned.tunedAt,
  JSON.stringify(tuned)
);
check("a notice says how many categories", await evalJs(`document.querySelector("#toast").textContent === "记忆：理过 2 类"`));

// 同一段里再问：系统提示仍是头一问时那份（缓存接得上）；这一答没改记忆，不再理
await sendMain("MEMORY-SNAP", 2);
check("the memory is frozen for the chat at its first ask", (await lastText()) === "SNAP|bash:no|work:no|zh:yes", await lastText());
await sleep(800);
check("an answer that changed no memory is not optimized", (await tuneAsks()).length === 0);

// 新起一段：带的是理过的记忆
await newChat();
await sendMain("MEMORY-SNAP", 1, "#welcomeInput", "#welcome .send-trigger");
await waitFor(`[...document.querySelectorAll('#messages .message.assistant')].at(-1)?.textContent.includes("SNAP|")`);
check("a new chat carries the optimized memory", (await lastText()) === "SNAP|bash:yes|work:yes|zh:yes", await lastText());

// 设置页：一类一份全文，可改、改空即删、改名并类
await evalJs(`document.querySelector("#openSettings")?.click() || document.querySelector('[data-open-settings]')?.click(); true`);
await sleep(200);
await evalJs(`document.querySelector('.tab-btn[data-tab="memory"]').click(); true`);
await sleep(200);
check(
  "memory tab renders with seal, counts and the duty state",
  await evalJs(
    `(h => h.querySelector(".settings-mark path") && h.querySelector("h2")?.textContent === "记忆" && /^2 类 · \\d+ 字$/.test(h.querySelector(".settings-meta")?.textContent) && h.querySelector(".setting-copy strong")?.textContent === "带进对话" && h.querySelectorAll(".memory-cat[data-memory-cat]").length === 2 && !h.querySelector(".memory-text"))(document.querySelector("#settingsContent"))`
  )
);
await evalJs(`document.querySelector('#settingsContent [data-memory-cat="偏好"]').click(); true`);
await sleep(150);
check(
  "a category shows its whole text, read-only",
  await evalJs(`document.querySelector("#settingsContent .memory-body")?.textContent === "用户偏好中文交流；命令用 PowerShell 而非 bash"`)
);
await shot("memory-settings.png");
check(
  "read-only memory uses an arrow cursor, including the category name",
  await evalJs(
    `[...document.querySelectorAll("#settingsContent .memory-body, #settingsContent .memory-cat-name")].every(n => getComputedStyle(n).cursor === "default") && !document.querySelector("#memoryCatName")`
  )
);
// 只有「修改」进入编辑；点正文仍只读，字可划选
await evalJs(`document.querySelector("#settingsContent .memory-body").click(); true`);
await sleep(100);
check(
  "clicking memory text keeps it read-only",
  await evalJs(`!!document.querySelector("#settingsContent .memory-body") && !document.querySelector("#settingsContent .memory-text")`)
);
check(
  "read-only memory text can still be selected for copying",
  await evalJs(`(() => {
    const body = document.querySelector("#settingsContent .memory-body");
    if (!body) return false;
    const selection = getSelection(), range = document.createRange();
    range.selectNodeContents(body);
    selection.removeAllRanges();
    selection.addRange(range);
    const selected = String(selection) === body.textContent;
    selection.removeAllRanges();
    return selected;
  })()`)
);
await evalJs(`document.activeElement.blur(); document.querySelector("#editMemory").click(); true`);
check(
  "the modify button enables editing and focuses the text",
  await evalJs(
    `document.activeElement?.matches(".memory-text") && !!document.querySelector("#memoryCatName") && getComputedStyle(document.activeElement).cursor === "text"`
  )
);
await evalJs(
  `(a => { a.value = "用户偏好中文交流\\n改过的一行"; a.dispatchEvent(new Event("input")); })(document.querySelector("#settingsContent .memory-text")); true`
);
await sleep(400);
check(
  "editing the text saves",
  (await memory()).items.some(i => i.category === "偏好" && i.text === "用户偏好中文交流\n改过的一行")
);
await evalJs(`document.activeElement.blur(); true`);
await sleep(150);
check(
  "leaving the field goes back to read-only",
  await evalJs(`!document.querySelector("#settingsContent .memory-text") && !!document.querySelector("#settingsContent .memory-body")`)
);
// 改名成已有的一类：并进去
await evalJs(`document.querySelector("#editMemory").click(); true`);
await evalJs(`(i => { i.value = "工作"; i.dispatchEvent(new Event("change")); })(document.querySelector("#memoryCatName")); true`);
await sleep(200);
check(
  "renaming to an existing category merges into it",
  await evalJs(
    `(m => m.items.length === 1 && m.items[0].category === "工作" && m.items[0].text === "用户在做言的记忆模块\\n用户偏好中文交流\\n改过的一行")(__yanState().memory)`
  )
);
// 另起一类：写名回车即就地写全文；没写就离开，这一类随之消失
await evalJs(`document.querySelector("#newMemoryCat").click(); true`);
await evalJs(
  `(i => { i.value = "新类"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })(document.querySelector("#settingsContent input.memory-cat-new")); true`
);
await sleep(150);
check(
  "a new category opens with its text being written",
  await evalJs(
    `document.querySelector("#settingsContent .memory-cat.active span")?.textContent === "新类" && !!document.activeElement?.matches(".memory-text")`
  )
);
await evalJs(`document.activeElement.blur(); true`);
await sleep(150);
check(
  "leaving it empty drops the new category",
  (await memory()).items.length === 1 &&
    (await evalJs(`![...document.querySelectorAll("#settingsContent .memory-cat span")].some(n => n.textContent === "新类")`))
);
// 改空即删去这一类
await evalJs(`document.querySelector("#editMemory").click(); true`);
await sleep(100);
await evalJs(
  `(a => { a.value = ""; a.dispatchEvent(new Event("input")); })(document.querySelector("#settingsContent .memory-text")); true`
);
// 真正点「完成」：失焦到头部按钮时不重画，最终提交由按钮接手，不能把旧正文画回来。
const doneAt = await evalJs(
  `(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(document.querySelector("#editMemory").getBoundingClientRect())`
);
for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
  await send("Input.dispatchMouseEvent", { type, ...doneAt, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
await sleep(200);
check(
  "emptying a category deletes it",
  (await memory()).items.length === 0 && (await evalJs(`!!document.querySelector("#settingsContent .memory-empty")`))
);
// 「专司」一钮直达专司那一栏，记忆优化卡摊开着；在那里关掉
await evalJs(`document.querySelector("#memoryDuty").click(); true`);
await sleep(200);
check(
  "the duty button opens the memory optimization card under duties",
  await evalJs(`document.querySelector(".tab-btn.active").dataset.tab === "duty" && document.querySelector('[data-duty="memory"]').open`)
);
await evalJs(`document.querySelector('[data-duty-on="memory"][data-value="false"]').click(); true`);
await sleep(200);
check("turning it off persists", await evalJs(`__yanState().settings.dutyMemory.on === false`));
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
check("off: nothing is optimized", (await tuneAsks()).length === 0);
close();
