// 对话的正本在本机的对话目录里（一段一个 JSON 文件）：旧版整份 localStorage 记录拆开迁走；改了会落盘、改名文件跟着改名、删了文件就没了；
// 清空浏览器后从目录恢复对话与设置；导入旧版备份先按启动时同一套迁移规整
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
const CHATS = `${TMP}/chats`;
const CUSTOM_CHATS = `${TMP}/chats-custom`;
const { send, evalJs, waitFor, close } = await connect();
const filesAt = dir => (existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith(".json") && name !== "设置.json") : []);
const files = () => filesAt(CHATS);
const readFile = name => JSON.parse(readFileSync(`${CHATS}/${name}`, "utf8"));
const readRecords = `new Promise((resolve, reject) => { const q = indexedDB.open("yan-chat-state-v1", 2); q.onerror = () => reject(q.error); q.onsuccess = () => { const r = q.result.transaction("conversations", "readonly").objectStore("conversations").getAll(); r.onerror = () => reject(r.error); r.onsuccess = () => { q.result.close(); resolve(r.result); }; }; })`;
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
// 上一个用例的页面离开时还会补写一两笔（对话、设置镜像），到这里它已经卸载了：把目录清干净再开始
for (const dir of [CHATS, CUSTOM_CHATS])
  for (let i = 0; i < 20 && existsSync(dir); i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
    if (existsSync(dir)) await sleep(150);
  }
const seed = {
  version: 5,
  settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false },
  profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: 0.7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }],
  conversations: [
    {
      id: "stored-chat",
      title: "数据库里的长对话",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      profileId: "p1",
      messages: [{ id: "u1", role: "user", content: "要长期保存的内容", timestamp: "2026-01-01T00:00:00.000Z" }],
      forks: [],
      threads: []
    }
  ],
  library: [],
  memory: { enabled: true, items: [{ id: "m1", text: "用户爱喝茶", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", source: null }] },
  drafts: {}
};
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(seed))}); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
// ---- 旧版整份记录：对话进目录，localStorage 只剩配置，表里不留暂存
let t = Date.now();
while (Date.now() - t < 8000 && !files().length) await sleep(150);
check("legacy localStorage state lands in the chats directory as one file per conversation", files().length === 1 && files()[0].startsWith("数据库里的长对话·"), JSON.stringify(files()));
check("the file carries the conversation", files().length === 1 && readFile(files()[0]).conversation?.messages?.[0]?.content === "要长期保存的内容");
const local = await evalJs(`JSON.parse(localStorage.getItem("yan-chat-v1"))`);
check(
  "localStorage keeps only settings (split marker, no conversations)",
  local.__yanStorage?.split === true && !local.conversations?.length && local.settings?.name === "测",
  JSON.stringify(Object.keys(local))
);
t = Date.now();
while (Date.now() - t < 5000 && (await evalJs(`(async () => (await (${readRecords})).length)()`)) > 0) await sleep(150);
check("the IndexedDB spill table is drained once the directory has the conversation", (await evalJs(`(async () => (await (${readRecords})).length)()`)) === 0);
check("history shows it", await evalJs(`document.querySelector("#history").textContent.includes("数据库里的长对话")`));
const readMirror = () => {
  try {
    return JSON.parse(readFileSync(`${CHATS}/设置.json`, "utf8"));
  } catch {
    return null;
  }
};
t = Date.now();
while (Date.now() - t < 6000 && readMirror()?.memory?.items?.[0]?.text !== "用户爱喝茶") await sleep(150);
const mirrored = readMirror();
check(
  "settings are mirrored to the directory without API keys",
  mirrored?.settings?.name === "测" && mirrored?.profiles?.[0]?.model === "fake" && !("apiKey" in (mirrored?.profiles?.[0] || {})) && mirrored?.memory?.items?.[0]?.text === "用户爱喝茶",
  JSON.stringify(mirrored && Object.keys(mirrored))
);
// ---- 设置里的对话目录：当前对话复制到新目录；切回默认后仍能继续用，旧目录不被删除
const customNative = CUSTOM_CHATS.split("/").join(process.platform === "win32" ? "\\" : "/");
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(200);
await evalJs(
  `(i => { i.value = ${JSON.stringify(customNative)}; i.dispatchEvent(new Event("input")); })(document.querySelector("#settingChats")); true`
);
t = Date.now();
while (
  Date.now() - t < 10000 &&
  (!filesAt(CUSTOM_CHATS).some(name => name.startsWith("数据库里的长对话·")) || !existsSync(`${CUSTOM_CHATS}/设置.json`))
)
  await sleep(150);
check(
  "changing the chats directory copies current conversations there",
  filesAt(CUSTOM_CHATS).some(name => name.startsWith("数据库里的长对话·")) &&
    (await evalJs(`__yanState().settings.chatsDir`)).toLowerCase() === customNative.toLowerCase(),
  JSON.stringify(filesAt(CUSTOM_CHATS))
);
const customMirror = JSON.parse(readFileSync(`${CUSTOM_CHATS}/设置.json`, "utf8"));
check(
  "the custom chats directory receives the settings mirror without API keys",
  customMirror.settings?.chatsDir?.toLowerCase() === customNative.toLowerCase() && !customMirror.profiles?.some(profile => "apiKey" in profile)
);
await evalJs(`(i => { i.value = ""; i.dispatchEvent(new Event("input")); })(document.querySelector("#settingChats")); true`);
await waitFor(`!__yanState().settings.chatsDir`, 10000);
check("clearing the custom chats directory restores the default without deleting the old copy", existsSync(CUSTOM_CHATS));
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sleep(200);
// ---- 改名：文件跟着改名；对话内容变了：落盘的时间戳往前走
const before = readFile(files()[0]).savedAt;
await evalJs(`document.querySelector('[data-conversation="stored-chat"] .history-open').click(); true`);
await sleep(300);
await evalJs(`(() => { const s = __yanState(); s.conversations[0].title = "改过名的对话"; s.conversations[0].messages.push({ id: "u2", role: "user", content: "又说了一句", timestamp: new Date().toISOString() }); __yanSave(); return true; })()`);
t = Date.now();
while (Date.now() - t < 8000 && !(files().length === 1 && files()[0].startsWith("改过名的对话·"))) await sleep(150);
check("renaming renames the file and the old name is gone", files().length === 1 && files()[0].startsWith("改过名的对话·"), JSON.stringify(files()));
check("the change is on disk with a newer stamp", readFile(files()[0]).savedAt > before && readFile(files()[0]).conversation.messages.length === 2);
// ---- 保存请求已经从待写队列取走、却还没返回时离页：最新状态仍同步兜进 IndexedDB，下次开页再推回目录
await evalJs(
  `(() => { const real = window.fetch.bind(window), gate = {}; gate.promise = new Promise(resolve => gate.release = resolve); window.__storageRealFetch = real; window.__storageSaveGate = gate; window.__storageSaveStarted = false; window.fetch = (...args) => { if (!window.__storageSaveStarted && String(args[0]).includes("/api/chats/save")) { window.__storageSaveStarted = true; return gate.promise.then(() => real(...args)); } return real(...args); }; const c = __yanState().conversations.find(c => c.id === "stored-chat"); c.messages.push({ id: "u3", role: "user", content: "离页前最后一句", timestamp: new Date().toISOString() }); __yanSave(); return true; })()`
);
await waitFor(`window.__storageSaveStarted === true`, 5000);
await evalJs(`window.dispatchEvent(new PageTransitionEvent("pagehide")); true`);
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(400);
const leftRecords = await evalJs(`(async () => await (${readRecords}))()`);
check(
  "pagehide keeps the newest conversation even after its payload left the pending queue",
  leftRecords.some(record => JSON.parse(record.json).messages.some(message => message.content === "离页前最后一句")),
  JSON.stringify(leftRecords.map(record => record.id))
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
t = Date.now();
while (Date.now() - t < 8000 && !files().some(name => readFile(name).conversation.messages.some(message => message.content === "离页前最后一句"))) await sleep(150);
check(
  "the unload fallback is pushed back to the chats directory on the next page",
  files().some(name => readFile(name).conversation.messages.some(message => message.content === "离页前最后一句"))
);
await evalJs(
  `(() => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); const c = __yanState().conversations.find(c => c.id === "stored-chat"); c.messages.push({ id: "u-bfcache", role: "user", content: "缓存恢复后再次离页", timestamp: new Date().toISOString() }); __yanSave(); window.dispatchEvent(new PageTransitionEvent("pagehide")); return true; })()`
);
await sleep(400);
const resumedRecords = await evalJs(`(async () => await (${readRecords}))()`);
check(
  "a page restored from the back-forward cache may flush again",
  resumedRecords.some(record => JSON.parse(record.json).messages.some(message => message.content === "缓存恢复后再次离页"))
);
// ---- 全新的浏览器（站点数据清空）：对话与设置都从目录回来
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(400);
await evalJs(
  `(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase("yan-chat-state-v1"); q.onsuccess = q.onerror = q.onblocked = r; }); return true; })()`
);
await send("Page.navigate", { url: PAGE });
await sleep(1500);
check(
  "a fresh browser restores conversations and settings from the directory",
  await evalJs(`document.querySelector("#history").textContent.includes("改过名的对话") && __yanState().settings.name === "测" && __yanState().memory.items[0]?.text === "用户爱喝茶" && __yanState().profiles[0]?.model === "fake"`)
);
// ---- 删对话：即使旧保存已经发出、尚未返回，删除也等它收尾后最后落锤，文件不会复活
await evalJs(`document.querySelector('[data-conversation="stored-chat"] .history-open').click(); true`);
await sleep(150);
await evalJs(
  `(() => { const real = window.fetch.bind(window), gate = {}; gate.promise = new Promise(resolve => gate.release = resolve); window.__storageRealFetch = real; window.__storageSaveGate = gate; window.__storageSaveStarted = false; window.fetch = (...args) => { if (!window.__storageSaveStarted && String(args[0]).includes("/api/chats/save")) { window.__storageSaveStarted = true; return gate.promise.then(() => real(...args)); } return real(...args); }; const c = __yanState().conversations.find(c => c.id === "stored-chat"); c.messages.push({ id: "u4", role: "user", content: "将与删除竞速", timestamp: new Date().toISOString() }); __yanSave(); return true; })()`
);
await waitFor(`window.__storageSaveStarted === true`, 5000);
await evalJs(`document.querySelector('[data-conversation="stored-chat"] [data-history-action="menu"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop [data-menu="delete"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await sleep(150);
await evalJs(`window.__storageSaveGate.release(); window.fetch = window.__storageRealFetch; true`);
t = Date.now();
while (Date.now() - t < 5000 && files().length) await sleep(150);
check("deleting waits out an in-flight save and still removes the file", files().length === 0, JSON.stringify(files()));
// ---- 导入旧版（v4）备份：workAuto 要立刻换成 commandPolicy、半成品的压缩分隔要去掉，不必等下次刷新；导入的也落盘
const backup = {
  version: 4,
  settings: {},
  profiles: [],
  conversations: [
    {
      id: "imported-old",
      title: "旧备份里的对话",
      createdAt: "2025-06-01T00:00:00.000Z",
      updatedAt: "2025-06-01T00:00:00.000Z",
      profileId: "",
      workAuto: true,
      reasoning: "off",
      messages: [
        { id: "iu1", role: "user", content: "旧话", timestamp: "2025-06-01T00:00:00.000Z" },
        { id: "ic1", role: "context", content: "", compacting: true, timestamp: "2025-06-01T00:00:01.000Z" }
      ]
    }
  ],
  library: [],
  drafts: { "imported-old": "旧版草稿只是一段字" }
};
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(200);
await evalJs(
  `(() => { const input = document.querySelector("#importInput"), dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(JSON.stringify(backup))}], "备份.json", { type: "application/json" })); input.files = dt.files; input.dispatchEvent(new Event("change")); return true; })()`
);
await waitFor(`document.querySelector("#history").textContent.includes("旧备份里的对话")`, 5000);
const imported = await evalJs(
  `(() => { const s = __yanState(), c = s.conversations.find(c => c.id === "imported-old"); return { policy: c.commandPolicy, workAuto: "workAuto" in c, reasoning: c.reasoning, messages: c.messages.length, forks: Array.isArray(c.forks), draft: s.drafts["imported-old"] }; })()`
);
check(
  "an old backup is migrated on import: workAuto → commandPolicy, dangling compacting marker dropped, string draft wrapped",
  imported.policy === "auto" && !imported.workAuto && imported.reasoning === "" && imported.messages === 1 && imported.forks && imported.draft?.text === "旧版草稿只是一段字",
  JSON.stringify(imported)
);
t = Date.now();
while (Date.now() - t < 8000 && !files().some(name => name.startsWith("旧备份里的对话·"))) await sleep(150);
check("imported conversations are written to the directory too", files().some(name => name.startsWith("旧备份里的对话·")), JSON.stringify(files()));
close();
