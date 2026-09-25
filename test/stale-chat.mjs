// 几处页面同开、这边没赶上那边写的（后台标签页的报到被浏览器节流，那边在两次报到之间就答完了；或那边只是改了、没作答）：
// 这边手上的是旧的一份，接着在里头说话时，不能拿旧的整份盖掉磁盘上那边刚写下的；回到前台时也先跟上
import { connect, check, sleep, PAGE } from "./lib.mjs";
const BASE = PAGE.replace(/\/$/, "");
const post = (path, body) =>
  fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
const message = (id, role, content) => ({ id, role, content, status: "complete", timestamp: "2026-09-24T00:00:00.000Z" });
const conversation = messages => ({
  id: "stale-1",
  title: "两处同开",
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: new Date().toISOString(),
  profileId: "p1",
  forks: [],
  threads: [],
  messages
});
const disk = async () => (await post("/api/chats/load", { root: "", ids: ["stale-1"] })).items[0];
const state = () => evalJs(`__yanState().conversations.find(c => c.id === "stale-1").messages.map(m => m.id)`);
const first = [message("s-u1", "user", "第一问"), message("s-a1", "assistant", "第一答")];
await post("/api/chats/save", { root: "", savedAt: Date.now(), conversation: conversation(first) });

const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="stale-1"]')`, 8000);
await evalJs(`document.querySelector('[data-conversation="stale-1"] .history-open').click(); true`);
await sleep(500);

// 一、那一处在这边没察觉时答完了一问；这边随即接着说话：写盘时桥接认出这边是旧的，两份并起来
const second = [...first, message("s-u2", "user", "那边的第二问"), message("s-a2", "assistant", "那边的第二答")];
await post("/api/chats/save", { root: "", savedAt: Date.now(), conversation: conversation(second) });
await evalJs(
  `(i => { i.value = "PLAIN 这边的一问"; i.dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); })(document.querySelector("#chatInput")); true`
);
await waitFor(
  `__yanState().conversations.find(c => c.id === "stale-1").messages.some(m => m.role === "assistant" && m.status === "complete" && !m.id.startsWith("s-"))`,
  10000
).catch(() => {});
await sleep(2500);
let ids = ((await disk())?.conversation.messages || []).map(m => m.id);
check("the other page's answer is still on disk after this page speaks", ids.includes("s-u2") && ids.includes("s-a2"), JSON.stringify(ids));
check("this page's new turn follows it on disk", ids.length === 6 && ids.indexOf("s-a2") === 3, JSON.stringify(ids));
check("and this page shows the merged conversation", JSON.stringify(await state()) === JSON.stringify(ids), JSON.stringify(await state()));

// 二、那一处又写了一问；这边藏着没察觉，回到前台时先跟上
const third = [...(await disk()).conversation.messages, message("s-u3", "user", "那边的第三问"), message("s-a3", "assistant", "那边的第三答")];
await post("/api/chats/save", { root: "", savedAt: Date.now(), conversation: conversation(third) });
await evalJs(`document.dispatchEvent(new Event("visibilitychange")); true`);
await waitFor(`__yanState().conversations.find(c => c.id === "stale-1").messages.some(m => m.id === "s-a3")`, 5000).catch(() => {});
check("coming back to the page catches up with what was written elsewhere", (await state()).includes("s-a3"));
check("the newer answer is on screen", await evalJs(`document.querySelector("#messages").textContent.includes("那边的第三答")`));
await sleep(1500);
ids = ((await disk())?.conversation.messages || []).map(m => m.id);
check("catching up writes nothing back", ids.length === 8, JSON.stringify(ids));
await close();

// 桥接这一道：带着旧时间戳来写的被拒，交回目录里那份；不带的（导入、测试）照写
const onDisk = await disk();
const late = await fetch(BASE + "/api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ root: "", savedAt: Date.now(), base: onDisk.savedAt - 1, conversation: conversation(first) })
});
const lateBody = await late.json();
check("a save based on an older copy is refused with the newer one", late.status === 409 && lateBody.item?.savedAt === onDisk.savedAt);
const fresh = await post("/api/chats/save", { root: "", savedAt: Date.now(), base: onDisk.savedAt, conversation: onDisk.conversation });
check("a save based on the current copy goes through", !!fresh.savedAt && !fresh.error, JSON.stringify(fresh));
