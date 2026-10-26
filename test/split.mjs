// 右栏：两段对话并排。侧栏「⋯ → 在右栏打开」把一段开在右侧（主页面嵌一份自己，?pane=side）；
// 同一段不在两边同开；右栏不记停在哪儿、不露侧栏；右栏里能照常作答；收起后右栏那一页离页；主页面只许本站嵌入
import { connect, check, sleep, PAGE } from "./lib.mjs";
const BASE = PAGE.replace(/\/$/, "");
const post = (path, body) =>
  fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
const at = "Thu 2026-09-24 8:00 AM CST (UTC+08:00)";
const conversation = (id, title) => ({
  id,
  title,
  createdAt: at,
  updatedAt: new Date().toISOString(),
  profileId: "p1",
  forks: [],
  threads: [],
  messages: [
    { id: `${id}-u`, role: "user", content: `${title}的问`, timestamp: at },
    { id: `${id}-a`, role: "assistant", content: `${title}的答`, status: "complete", timestamp: at, modelName: "假模型" }
  ]
});
await post("/api/chats/save", { root: "", savedAt: Date.now(), conversation: conversation("split-left", "左边这段") });
await post("/api/chats/save", { root: "", savedAt: Date.now(), conversation: conversation("split-right", "右边这段") });

const headers = (await fetch(PAGE)).headers.get("content-security-policy") || "";
check("the main page may be framed only by itself", headers.includes("frame-ancestors 'self'") && !headers.includes("frame-ancestors 'none'"), headers);

const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); localStorage.removeItem("yan-split"); localStorage.removeItem("yan-split-width"); localStorage.removeItem("yan-split-v2"); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="split-right"]')`, 20000);
await evalJs(`document.querySelector('[data-conversation="split-left"] .history-open').click(); true`);
await sleep(300);

// 左边正开着的那段：右栏不再开一份
await evalJs(`document.querySelector('[data-conversation="split-left"] [data-history-action="menu"]').click(); true`);
await waitFor(`!!document.querySelector('.chip-pop [data-menu="split"]')`);
await evalJs(`document.querySelector('.chip-pop [data-menu="split"]').click(); true`);
await sleep(300);
check(
  "the chat open on the left is not opened again on the right",
  (await evalJs(`document.querySelector("#splitRail").classList.contains("hidden")`)) &&
    (await evalJs(`document.querySelector("#toast").textContent`)).includes("左边")
);

// 另一段开到右栏
await evalJs(`document.querySelector('[data-conversation="split-right"] [data-history-action="menu"]').click(); true`);
await waitFor(`!!document.querySelector('.chip-pop [data-menu="split"]')`);
await evalJs(`document.querySelector('.chip-pop [data-menu="split"]').click(); true`);
const pane = `document.querySelector('.split-panel[data-slot="0"] .split-frame').contentWindow`;
await waitFor(`!!${pane}.document?.querySelector('#messages .message.assistant')`, 30000);
check(
  "the right pane opens that chat beside the left one",
  !(await evalJs(`document.querySelector("#splitRail").classList.contains("hidden")`)) &&
    (await evalJs(`${pane}.__yanPane.id()`)) === "split-right" &&
    (await evalJs(`${pane}.document.querySelector("#messages").textContent.includes("右边这段的答")`)) &&
    (await evalJs(`document.querySelector("#messages").textContent.includes("左边这段的答")`))
);
check(
  "the right pane shows only the chat: no sidebar, no browser panel entry",
  await evalJs(
    `(d => getComputedStyle(d.querySelector("#sidebar")).display === "none" && getComputedStyle(d.querySelector("#stagePin")).display === "none" && !!d.querySelector("#paneClose"))(${pane}.document)`
  )
);
check(
  "the sidebar marks the chat that is open on the right",
  await evalJs(`!!document.querySelector('[data-conversation="split-right"] .split-mark')`)
);

// 点了开在右栏的那段：左边不换过去
await evalJs(`document.querySelector('[data-conversation="split-right"] .history-open').click(); true`);
await sleep(300);
check(
  "clicking the chat open on the right keeps the left as it was",
  (await evalJs(`document.querySelector("#messages").textContent.includes("左边这段的答")`)) &&
    !(await evalJs(`document.querySelector("#messages").textContent.includes("右边这段的答")`))
);

// 右栏不记停在哪儿：主页面刷新后左边仍是左边那段，右栏接着开
await sleep(800);
check("the right pane does not overwrite where the main page was", (await evalJs(`__yanState().settings.lastConversationId`)) === "split-left");

// 右栏里照常作答
await evalJs(
  `(d => { const i = d.querySelector("#chatInput"); i.value = "PLAIN 右栏里问一句"; i.dispatchEvent(new Event("input")); d.querySelector("#chatSend").click(); })(${pane}.document); true`
);
await waitFor(`[...${pane}.document.querySelectorAll('#messages .message.assistant')].length === 2 && [...${pane}.document.querySelectorAll('#messages .message.assistant')].at(-1).dataset.status === "complete"`, 15000).catch(() => {});
check(
  "a question asked in the right pane is answered there",
  (await evalJs(`${pane}.__yanState().conversations.find(c => c.id === "split-right").messages.length`)) === 4 &&
    (await evalJs(`__yanState().conversations.find(c => c.id === "split-left").messages.length`)) === 2
);

await send("Page.reload");
// 重载后脚本还没跑完时 __yanState 尚不存在：先等主页面起来，再看右栏有没有接着开
await waitFor(`typeof __yanState === "function"`, 20000);
await waitFor(`!!document.querySelector('.split-panel[data-slot="0"] .split-frame')?.contentWindow.__yanPane?.id()`, 20000).catch(() => {});
check(
  "after a reload the left chat and the right pane both come back",
  (await evalJs(`__yanState().settings.lastConversationId`)) === "split-left" &&
    (await evalJs(`document.querySelector('.split-panel[data-slot="0"] .split-frame').contentWindow.__yanPane?.id()`)) === "split-right"
);

// 右栏里要开别的对话：交回主页面开
await waitFor(`!!${pane}.document?.querySelector("#paneClose")`, 20000).catch(() => {});
await evalJs(`${pane}.document.querySelector("#paneClose").click(); true`);
await sleep(400);
check(
  "closing the right pane hides it and forgets it",
  (await evalJs(`document.querySelector("#splitRail").classList.contains("hidden")`)) &&
    (await evalJs(`localStorage.getItem("yan-split-v2")`)) === null &&
    (await evalJs(`localStorage.getItem("yan-split")`)) === null &&
    !(await evalJs(`!!document.querySelector('[data-conversation="split-right"] .split-mark')`))
);
await evalJs(`document.querySelector('[data-conversation="split-right"] .history-open').click(); true`);
await sleep(300);
check(
  "once closed, that chat opens on the left as usual",
  await evalJs(`document.querySelector("#messages").textContent.includes("右边这段的答")`)
);
await close();
