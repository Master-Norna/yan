// 存储根（测试里是 .tmp/.yan）：对话一段一个 JSON 文件落在 对话/，配置（含 API Key）落在 配置.json，几个浏览器共用。
// 旧版整份 localStorage 记录拆开迁走；改了会落盘、改名文件跟着改名、删了文件就没了；清空浏览器后从存储根恢复对话与配置；
// 另一个浏览器头一回碰上这个根，两边的模型配置并起来；存储位置换到别处整份拷过去、再换回来用回原来的；导入旧版备份先按启动时同一套迁移规整
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP, HOME, CHATS } from "./lib.mjs";
const ELSEWHERE = `${TMP}/elsewhere`;
const native = p => p.split("/").join(process.platform === "win32" ? "\\" : "/");
const { send, evalJs, waitFor, close } = await connect();
const filesAt = dir =>
  existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith(".json") && name !== "设置.json" && name !== "删除记录.json") : [];
const files = () => filesAt(CHATS);
const readFile = name => JSON.parse(readFileSync(`${CHATS}/${name}`, "utf8"));
const readRecords = `new Promise((resolve, reject) => { const q = indexedDB.open("yan-chat-state-v1", 2); q.onerror = () => reject(q.error); q.onsuccess = () => { const r = q.result.transaction("conversations", "readonly").objectStore("conversations").getAll(); r.onerror = () => reject(r.error); r.onsuccess = () => { q.result.close(); resolve(r.result); }; }; })`;
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
// 上一个用例的页面离开时还会补写一两笔（对话、设置镜像），到这里它已经卸载了：把目录清干净再开始
for (const dir of [CHATS, ELSEWHERE])
  for (let i = 0; i < 20 && existsSync(dir); i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
    if (existsSync(dir)) await sleep(150);
  }
mkdirSync(`${HOME}/环境`, { recursive: true });
writeFileSync(
  `${HOME}/环境/已备.json`,
  JSON.stringify({
    python: "Python 3.12",
    packs: ["python", "data", "office", "web", "image", "media", "node", "c", "go", "rust", "java"],
    pip: [],
    npm: [],
    mirror: "china",
    at: new Date().toISOString()
  })
);
const seed = {
  version: 5,
  settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false },
  profiles: [
    {
      id: "p1",
      source: "custom",
      name: "假模型",
      model: "fake",
      baseUrl: "http://127.0.0.1:8798/v1",
      apiKey: "k",
      temperature: 0.7,
      maxTokens: 8192,
      quota: "100k",
      usedTokens: 0,
      systemPrompt: ""
    }
  ],
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
  memory: {
    enabled: true,
    items: [{ id: "m1", text: "用户爱喝茶", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", source: null }]
  },
  drafts: {}
};
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(seed))}); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
// ---- 旧版整份记录：对话进目录，localStorage 只剩配置，表里不留暂存
let t = Date.now();
while (Date.now() - t < 8000 && !files().length) await sleep(150);
check(
  "legacy localStorage state lands in the chats directory as one file per conversation",
  files().length === 1 && files()[0].startsWith("数据库里的长对话·"),
  JSON.stringify(files())
);
check(
  "the file carries the conversation",
  files().length === 1 && readFile(files()[0]).conversation?.messages?.[0]?.content === "要长期保存的内容"
);
const local = await evalJs(`JSON.parse(localStorage.getItem("yan-chat-v1"))`);
check(
  "localStorage keeps only settings (split marker, no conversations)",
  local.__yanStorage?.split === true && !local.conversations?.length && local.settings?.name === "测",
  JSON.stringify(Object.keys(local))
);
t = Date.now();
while (Date.now() - t < 5000 && (await evalJs(`(async () => (await (${readRecords})).length)()`)) > 0) await sleep(150);
check(
  "the IndexedDB spill table is drained once the directory has the conversation",
  (await evalJs(`(async () => (await (${readRecords})).length)()`)) === 0
);
check("history shows it", await evalJs(`document.querySelector("#history").textContent.includes("数据库里的长对话")`));
// 回车应激活当前焦点的「取消」，不能越过它执行清空；设置窗 Tab 也要留在窗内。
await evalJs(`document.querySelector("#openSettings").focus(); document.querySelector("#openSettings").click(); true`);
check("settings takes keyboard focus", await evalJs(`document.activeElement?.id === "closeSettings"`));
await evalJs(`document.querySelector("#clearAll").focus(); true`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
check("Tab stays inside settings", await evalJs(`document.activeElement?.id === "closeSettings"`));
await evalJs(`document.querySelector("#clearAll").focus(); document.querySelector("#clearAll").click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`);
await sleep(30);
await evalJs(
  `(() => { const b = document.querySelector("#confirmCancel"); b.focus(); const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }); b.dispatchEvent(e); if (!e.defaultPrevented) b.click(); return true; })()`
);
await sleep(250);
check(
  "Enter on Cancel keeps conversations and returns focus",
  files().length === 1 && (await evalJs(`__yanState().conversations.length === 1 && document.activeElement?.id === "clearAll"`)),
  await evalJs(
    `JSON.stringify({ chats: __yanState().conversations.length, focus: document.activeElement?.id, confirm: document.querySelector("#confirmModal").className })`
  )
);
await evalJs(`document.querySelector("#closeSettings").click(); true`);
check(
  "closing settings restores focus",
  await evalJs(`document.activeElement?.id === "openSettings"`),
  await evalJs(`document.activeElement?.id`)
);
const readConfig = (root = HOME) => {
  try {
    return JSON.parse(readFileSync(`${root}/配置.json`, "utf8"));
  } catch {
    return null;
  }
};
t = Date.now();
while (Date.now() - t < 6000 && readConfig()?.memory?.items?.[0]?.text !== "用户爱喝茶") await sleep(150);
const config = readConfig();
check(
  "the config lands in 配置.json with the API key (browsers share it)",
  config?.settings?.name === "测" &&
    config?.profiles?.[0]?.model === "fake" &&
    config?.profiles?.[0]?.apiKey === "k" &&
    config?.memory?.items?.[0]?.text === "用户爱喝茶",
  JSON.stringify(config && Object.keys(config))
);
// ---- 存储位置：换到别处，整份（对话与配置）拷过去；再换回来，用回原来的那份；拷走的那份原样留着
const nested = `${HOME}/nested`;
const nestedMove = await fetch(PAGE + "api/store/move", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ parent: native(nested) })
});
check("moving storage below its current root is rejected before creating directories", nestedMove.status === 400 && !existsSync(nested));
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(200);
await evalJs(`document.querySelector('[data-tab="env"]').click(); true`);
await waitFor(`document.querySelector("#envStatus")?.textContent.includes("已备好")`, 5000);
await evalJs(`document.querySelector("#envPrepare").click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`, 3000);
check(
  "updating an environment would confirm before removing installed packs",
  await evalJs(`document.querySelector("#confirmTitle").textContent.includes("卸载")`)
);
await evalJs(`document.querySelector("#confirmCancel").click(); document.querySelector('[data-tab="general"]').click(); true`);
await evalJs(
  `(i => { i.value = ${JSON.stringify(native(ELSEWHERE))}; i.dispatchEvent(new Event("change")); })(document.querySelector("#settingStore")); true`
);
const moved = `${ELSEWHERE}/.yan`;
t = Date.now();
while (Date.now() - t < 10000 && !(filesAt(`${moved}/对话`).some(name => name.startsWith("数据库里的长对话·")) && readConfig(moved)))
  await sleep(150);
check(
  "moving the storage copies conversations and config under <place>/.yan",
  filesAt(`${moved}/对话`).some(name => name.startsWith("数据库里的长对话·")) && readConfig(moved)?.profiles?.[0]?.apiKey === "k",
  JSON.stringify(filesAt(`${moved}/对话`))
);
await waitFor(`(document.querySelector("#settingStore")?.value || "").toLowerCase().includes("elsewhere")`, 5000).catch(() => {});
check(
  "settings now show the new place",
  (await evalJs(`document.querySelector("#settingStore").value`)).toLowerCase().includes("elsewhere")
);
await evalJs(`document.querySelector('[data-tab="env"]').click(); true`);
await waitFor(`document.querySelector("#envStatus")?.textContent.includes("尚未准备")`, 5000);
check(
  "moving storage refreshes the environment status for the new root",
  await evalJs(`document.querySelector("#envStatus")?.textContent.includes("尚未准备")`)
);
await evalJs(`document.querySelector('[data-tab="general"]').click(); true`);
await evalJs(
  `(i => { i.value = ${JSON.stringify(native(TMP))}; i.dispatchEvent(new Event("change")); })(document.querySelector("#settingStore")); true`
);
// 等搬回来的那一次真正收尾（输入框是测试自己改的，不能拿它当信号）
await waitFor(`(document.querySelector("#toast")?.textContent || "").includes("原有的数据")`, 10000).catch(() => {});
check(
  "moving back uses the original storage and leaves the copy in place",
  !(await evalJs(`document.querySelector("#settingStore").value`)).toLowerCase().includes("elsewhere") && existsSync(`${moved}/配置.json`)
);
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sleep(200);
// ---- 改名：文件跟着改名；对话内容变了：落盘的时间戳往前走
const before = readFile(files()[0]).savedAt;
await evalJs(`document.querySelector('[data-conversation="stored-chat"] .history-open').click(); true`);
await sleep(300);
await evalJs(
  `(() => { const s = __yanState(); s.conversations[0].title = "改过名的对话"; s.conversations[0].messages.push({ id: "u2", role: "user", content: "又说了一句", timestamp: new Date().toISOString() }); __yanSave(); return true; })()`
);
t = Date.now();
while (Date.now() - t < 8000 && !(files().length === 1 && files()[0].startsWith("改过名的对话·"))) await sleep(150);
check(
  "renaming renames the file and the old name is gone",
  files().length === 1 && files()[0].startsWith("改过名的对话·"),
  JSON.stringify(files())
);
check(
  "the change is on disk with a newer stamp",
  readFile(files()[0]).savedAt > before && readFile(files()[0]).conversation.messages.length === 2
);
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
while (
  Date.now() - t < 8000 &&
  !files().some(name => readFile(name).conversation.messages.some(message => message.content === "离页前最后一句"))
)
  await sleep(150);
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
  await evalJs(
    `document.querySelector("#history").textContent.includes("改过名的对话") && __yanState().settings.name === "测" && __yanState().memory.items[0]?.text === "用户爱喝茶" && __yanState().profiles[0]?.model === "fake"`
  )
);
// ---- 另一个浏览器：本地有自己的一套模型（带版本标记，是正常用过的），头一回碰上这个存储根——两边并起来，写回 配置.json
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(400);
const other = {
  version: 5,
  settings: { name: "另一处", theme: "light", inkMotion: "off", activeProfileId: "p2", autoTitle: false },
  profiles: [
    {
      id: "p2",
      source: "custom",
      name: "另一个模型",
      model: "other",
      baseUrl: "http://127.0.0.1:8798/v1",
      apiKey: "k2",
      temperature: 0.7,
      quota: "",
      usedTokens: 0,
      systemPrompt: ""
    }
  ],
  library: [],
  memory: {
    enabled: true,
    items: [{ id: "m2", text: "另一处记下的", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", source: null }]
  },
  drafts: {},
  __yanStorage: { revision: 1, split: true, pendingDeletes: [] }
};
await evalJs(
  `(async () => { localStorage.clear(); localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(other))}); await new Promise(r => { const q = indexedDB.deleteDatabase("yan-chat-state-v1"); q.onsuccess = q.onerror = q.onblocked = r; }); return true; })()`
);
await send("Page.navigate", { url: PAGE });
await sleep(1500);
t = Date.now();
while (Date.now() - t < 6000 && (readConfig()?.profiles || []).length < 2) await sleep(150);
const joined = await evalJs(
  `(s => ({ profiles: s.profiles.map(p => p.id).sort().join(), memory: s.memory.items.map(m => m.id).sort().join() }))(__yanState())`
);
check(
  "a second browser meeting this storage merges its own models and memory with the shared config",
  joined.profiles === "p1,p2" &&
    joined.memory === "m1,m2" &&
    (readConfig()?.profiles || [])
      .map(p => p.id)
      .sort()
      .join() === "p1,p2",
  JSON.stringify([joined, (readConfig()?.profiles || []).map(p => p.id)])
);
// ---- 两个浏览器同开：另一处刚往 配置.json 里加了模型，这边随后改个设置，不能拿自己手上的旧配置把它盖掉；
// 只存对话、配置没变时，配置.json 一个字也不动
{
  const mtime = statSync(`${HOME}/配置.json`).mtimeMs;
  await evalJs(
    `(() => { __yanState().conversations[0] && (__yanState().conversations[0].updatedAt = new Date().toISOString()); __yanSave(); return true; })()`
  );
  await sleep(1800);
  check("saving conversations without a config change leaves 配置.json alone", statSync(`${HOME}/配置.json`).mtimeMs === mtime);
  const disk = readConfig();
  disk.profiles.push({
    id: "p3",
    source: "custom",
    name: "另一处刚加的",
    model: "m3",
    baseUrl: "http://127.0.0.1:8798/v1",
    apiKey: "k3",
    temperature: 0.7,
    quota: "",
    usedTokens: 0,
    systemPrompt: ""
  });
  disk.savedAt = Date.now() + 5000;
  writeFileSync(`${HOME}/配置.json`, JSON.stringify(disk));
  await evalJs(`(() => { __yanState().settings.name = "这边改的名"; __yanSave(); return true; })()`);
  t = Date.now();
  while (Date.now() - t < 8000 && readConfig()?.settings?.name !== "这边改的名") await sleep(150);
  const after = readConfig();
  check(
    "a config change here merges with one just written elsewhere instead of overwriting it",
    after?.settings?.name === "这边改的名" && (after?.profiles || []).some(p => p.id === "p3" && p.apiKey === "k3"),
    JSON.stringify({ name: after?.settings?.name, profiles: (after?.profiles || []).map(p => p.id) })
  );
  check("the page takes in the model added elsewhere", await evalJs(`__yanState().profiles.some(p => p.id === "p3")`));
}
// ---- 浏览器只丢了同步基准：旧缓存不能把磁盘里更多的环境选择写回默认三项
{
  await send("Page.navigate", { url: PAGE + "preview.html" });
  await sleep(400);
  const disk = readConfig();
  disk.settings.env.packs = ["data", "office", "web", "image", "media", "node", "c", "go", "rust", "java"];
  disk.savedAt = Date.now() + 5000;
  writeFileSync(`${HOME}/配置.json`, JSON.stringify(disk));
  await evalJs(
    `(() => { const old = JSON.parse(localStorage.getItem("yan-chat-v1")); old.settings.env.packs = ["data", "office", "web"]; localStorage.setItem("yan-chat-v1", JSON.stringify(old)); localStorage.removeItem("yan-config-base"); return true; })()`
  );
  await send("Page.navigate", { url: PAGE });
  await sleep(1800);
  check(
    "missing config merge base keeps the disk's installed tool selections",
    readConfig()?.settings?.env?.packs?.length === 10 && (await evalJs(`__yanState().settings.env.packs.length`)) === 10
  );
}
// ---- 旧版无标记缓存碰到已存在的配置，也不能强制清掉磁盘独有的模型和环境选择
{
  await send("Page.navigate", { url: PAGE + "preview.html" });
  await sleep(400);
  await evalJs(
    `(() => { const old = JSON.parse(localStorage.getItem("yan-chat-v1")); old.profiles = old.profiles.filter(p => p.id === "p1"); old.settings.env.packs = ["data", "office", "web"]; delete old.__yanStorage; localStorage.setItem("yan-chat-v1", JSON.stringify(old)); localStorage.removeItem("yan-config-base"); return true; })()`
  );
  await send("Page.navigate", { url: PAGE });
  await sleep(1800);
  check(
    "legacy local cache cannot replace the disk's profiles and tool selections",
    readConfig()?.settings?.env?.packs?.length === 10 && readConfig()?.profiles?.some(p => p.id === "p3")
  );
}
// ---- 配置保存遇到临时故障：页面提示，并且桥接恢复后自动补写，不等下一次手工修改
await evalJs(
  `(() => { const real = window.fetch.bind(window); let failed = false; window.fetch = (...args) => { if (!failed && String(args[0]).includes("/api/store/config/save")) { failed = true; return Promise.resolve(new Response('{"error":"临时故障"}', { status: 503, headers: { "Content-Type": "application/json" } })); } return real(...args); }; __yanState().settings.name = "重试后的名"; __yanSave(); return true; })()`
);
await waitFor(`document.querySelector("#toast")?.textContent.includes("配置尚未写入")`, 5000);
t = Date.now();
while (Date.now() - t < 12000 && readConfig()?.settings?.name !== "重试后的名") await sleep(150);
check("a failed config save is reported and retried", readConfig()?.settings?.name === "重试后的名");
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
  imported.policy === "auto" &&
    !imported.workAuto &&
    imported.reasoning === "" &&
    imported.messages === 1 &&
    imported.forks &&
    imported.draft?.text === "旧版草稿只是一段字",
  JSON.stringify(imported)
);
t = Date.now();
while (Date.now() - t < 8000 && !files().some(name => name.startsWith("旧备份里的对话·"))) await sleep(150);
check(
  "imported conversations are written to the directory too",
  files().some(name => name.startsWith("旧备份里的对话·")),
  JSON.stringify(files())
);
rmSync(ELSEWHERE, { recursive: true, force: true });
close();
