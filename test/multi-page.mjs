// 几处页面同开：另一个页面（这里由 Node 扮演：向桥接报到、往对话目录里写）正在一段对话里作答时，
// 这边开页不把它当成中断、只看不动、跟着磁盘上的进度走；那边写完松手，这边收到写完的样子；没写完就走了的，才按中断收束
import { connect, check, sleep, PAGE } from "./lib.mjs";
const BASE = PAGE.replace(/\/$/, ""),
  OTHER = "another-page";
const post = (path, body) =>
  fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
const conversation = (id, title, content, status) => ({
  id,
  title,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: new Date().toISOString(),
  profileId: "p1",
  forks: [],
  threads: [],
  messages: [
    { id: `${id}-u`, role: "user", content: "写一篇长文", timestamp: "2026-09-24T00:00:00.000Z" },
    { id: `${id}-a`, role: "assistant", content, status, timestamp: "2026-09-24T00:00:01.000Z", modelName: "假模型" }
  ]
});
const save = c => post("/api/chats/save", { root: "", savedAt: Date.now(), conversation: c });
// 那一处在两段对话里作答
await save(conversation("multi-1", "别处作答中", "写到一半", "streaming"));
await save(conversation("multi-2", "别处半途走了", "也写到一半", "streaming"));
let leased = ["multi-1", "multi-2"];
const lease = () => post("/api/chats/lease", { owner: OTHER, ids: leased });
await lease();
const beat = setInterval(() => void lease(), 3000);

const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="multi-1"]')`, 8000);
const status = id => evalJs(`__yanState().conversations.find(c => c.id === "${id}")?.messages[1]?.status`);
check("opening the page does not mark an answer still being written elsewhere as interrupted", (await status("multi-1")) === "streaming");
await evalJs(`document.querySelector('[data-conversation="multi-1"] .history-open').click(); true`);
await sleep(300);
check(
  "the status shows it is being answered elsewhere",
  (await evalJs(`document.querySelector("#connectionText").textContent`)) === "另一处作答中"
);
await evalJs(
  `(i => { i.value = "这边插一句"; i.dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); })(document.querySelector("#chatInput")); true`
);
await sleep(300);
check(
  "sending here is held off with an explanation, and the words stay in the box",
  (await evalJs(`__yanState().conversations.find(c => c.id === "multi-1").messages.length`)) === 2 &&
    (await evalJs(`document.querySelector("#toast").textContent`)).includes("另一个页面") &&
    (await evalJs(`document.querySelector("#chatInput").value`)) === "这边插一句"
);
// 那一处接着写：这边跟得上
await save(conversation("multi-1", "别处作答中", "写到一半，又写了一些", "streaming"));
await waitFor(`document.querySelector("#messages .message.assistant")?.textContent.includes("又写了一些")`, 8000).catch(() => {});
check(
  "this page follows the progress written elsewhere",
  await evalJs(`document.querySelector("#messages .message.assistant")?.textContent.includes("又写了一些")`)
);
// 那一处写完了、松手；另一段它没写完就走了
await save(conversation("multi-1", "别处作答中", "写完了。", "complete"));
leased = [];
await lease();
clearInterval(beat);
await waitFor(`__yanState().conversations.find(c => c.id === "multi-1")?.messages[1]?.status === "complete"`, 8000).catch(() => {});
check(
  "when the other page finishes, this page shows the finished answer",
  (await status("multi-1")) === "complete" &&
    (await evalJs(`document.querySelector("#messages .message.assistant")?.textContent.includes("写完了")`))
);
await waitFor(`__yanState().conversations.find(c => c.id === "multi-2")?.messages[1]?.status === "interrupted"`, 8000).catch(() => {});
check("an answer the other page left unfinished is settled as interrupted once it lets go", (await status("multi-2")) === "interrupted");
check("and sending here works again", (await evalJs(`document.querySelector("#connectionText").textContent`)) !== "另一处作答中");
await close();
