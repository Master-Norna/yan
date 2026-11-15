// 主模型自主维护记忆，无需另配模型；每问带最新版，设置开关与旧谈工具各自独立。
import { connect, check, sleep, PAGE } from "./lib.mjs";
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
// 旧版一条一事：同类两条读入时并成一类。没有记忆专司配置，也能直接使用。
const seed = [
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
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [${JSON.stringify(old)}], memory: { items: ${JSON.stringify(seed)} }, library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
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
check("step cards labeled in the house style", labels === "记入|记入|记入|记入|查旧谈|翻旧谈|查旧谈", labels);
const sources = await evalJs(
  `(d => d ? [...d.querySelectorAll(".source-card")].map(c => c.querySelector("strong").textContent + "|" + (c.querySelector(".source-read") ? "read" : "")) : null)([...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".source-stack"))`
);
check("sources list the old talk, read", JSON.stringify(sources) === JSON.stringify(["旧谈一则|read"]), JSON.stringify(sources));

check(
  "the main model's writes are saved without a separate memory model",
  (await memory()).items.length === 2 &&
    (await memory()).items.some(i => i.category === "偏好" && i.text === "用户偏好中文交流\n用户偏好 PowerShell")
);
await sendMain("MEMORY-SNAP", 2);
check(
  "the next question in the same chat carries the latest memory",
  (await lastText()) === "SNAP|ps:yes|work:yes|zh:yes",
  await lastText()
);
await newChat();
await sendMain("MEMORY-SNAP", 1, "#welcomeInput", "#welcome .send-trigger");
check("another chat also carries the latest memory", (await lastText()) === "SNAP|ps:yes|work:yes|zh:yes", await lastText());

// 设置页：一类一份全文，可改、改空即删、改名并类
await evalJs(`document.querySelector("#openSettings")?.click() || document.querySelector('[data-open-settings]')?.click(); true`);
await sleep(200);
await evalJs(`document.querySelector('.tab-btn[data-tab="memory"]').click(); true`);
await sleep(200);
check(
  "memory tab renders with seal, counts and its own switch",
  await evalJs(
    `(h => h.querySelector(".settings-mark path") && h.querySelector("h2")?.textContent === "记忆" && /^2 类 · \\d+ 字$/.test(h.querySelector(".settings-meta")?.textContent) && h.querySelector(".setting-copy strong")?.textContent === "带进对话" && h.querySelectorAll(".memory-cat[data-memory-cat]").length === 2 && !h.querySelector(".memory-text"))(document.querySelector("#settingsContent"))`
  )
);
await evalJs(`document.querySelector('#settingsContent [data-memory-cat="偏好"]').click(); true`);
await sleep(150);
check(
  "a category shows its whole text, read-only",
  await evalJs(`document.querySelector("#settingsContent .memory-body")?.textContent === "用户偏好中文交流\\n用户偏好 PowerShell"`)
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
// 清空后同一对话下一问不再携带旧正文；先前打开过的另一对话也读取最新版。
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sendMain("MEMORY-SNAP", 2);
check("deleting memory is visible on the next question", (await lastText()) === "SNAP|ps:no|work:no|zh:no", await lastText());
await openTalk("MEMORY go");
await sendMain("MEMORY-SNAP", 3);
check("a previously opened chat also drops the old memory", (await lastText()) === "SNAP|ps:no|work:no|zh:no", await lastText());
await evalJs(`document.querySelector("#openSettings")?.click() || document.querySelector('[data-open-settings]')?.click(); true`);
await evalJs(`document.querySelector('.tab-btn[data-tab="memory"]').click(); true`);
// 全局记忆独立开关：专司中没有记忆模型卡。
await evalJs(`document.querySelector('[data-memory-enabled="false"]').click(); true`);
check("turning memory off persists", await evalJs(`__yanState().settings.memoryEnabled === false`));
await evalJs(`document.querySelector('.tab-btn[data-tab="duty"]').click(); true`);
check("no memory duty remains", await evalJs(`!document.querySelector('[data-duty="memory"]')`));
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sendMain("MEMORY-OFF", 4);
check(
  "off: no memory or memory writes; past chat tools stay available",
  (await lastText()) === "OFF|body:no|memtools:0|talks:2",
  await lastText()
);

await close();
