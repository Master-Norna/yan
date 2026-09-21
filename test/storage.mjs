// 对话主体由 localStorage 迁进 IndexedDB；localStorage 缩成启动镜像时，刷新仍从数据库还原完整历史
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
const seed = {
  version: 5,
  settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "", autoTitle: false },
  profiles: [],
  conversations: [
    {
      id: "stored-chat",
      title: "数据库里的长对话",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      profileId: "",
      messages: [{ id: "u1", role: "user", content: "要长期保存的内容", timestamp: "2026-01-01T00:00:00.000Z" }],
      forks: [],
      threads: []
    }
  ],
  library: [],
  memory: { enabled: true, items: [] },
  drafts: {}
};
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(seed))}); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1000);
const readRecord = `new Promise((resolve, reject) => { const q = indexedDB.open("yan-chat-state-v1", 1); q.onerror = () => reject(q.error); q.onsuccess = () => { const r = q.result.transaction("state", "readonly").objectStore("state").get("main"); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); }; })`;
await waitFor(`(async () => !!(await (${readRecord}))?.json?.includes("数据库里的长对话"))()`, 8000);
const migrated = await evalJs(`(async () => await (${readRecord}))()`);
check("legacy localStorage state migrates into IndexedDB", !!migrated?.json?.includes("数据库里的长对话"));
check(
  "the local mirror is revisioned",
  await evalJs(`!!JSON.parse(localStorage.getItem("yan-chat-v1")).__yanStorage?.revision`)
);
// 模拟 localStorage 已满后的轻量镜像：它只有设置和标记，没有对话；刷新必须仍从 IndexedDB 读回正文
// 先离开应用页，免得它的 pagehide 按正常逻辑再写一次完整镜像，把测试刚放的轻量镜像覆盖掉
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(400);
await evalJs(
  `(r => localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: ${JSON.stringify(seed.settings)}, profiles: [], conversations: [], library: [], memory: { enabled: true, items: [] }, drafts: {}, __yanStorage: { revision: r.revision, dbOnly: true } })))(${JSON.stringify(migrated)}); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1000);
check(
  "a lightweight local mirror restores full history from IndexedDB",
  await evalJs(`document.querySelector("#history").textContent.includes("数据库里的长对话")`)
);
check(
  "the lightweight mirror stays small instead of copying conversations back",
  await evalJs(`JSON.parse(localStorage.getItem("yan-chat-v1")).conversations.length === 0`)
);
// 导入旧版（v4）备份：workAuto 要立刻换成 commandPolicy、半成品的压缩分隔要去掉，不必等下次刷新
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
  `(async () => { const s = JSON.parse((await (${readRecord})).json), c = s.conversations.find(c => c.id === "imported-old"); return { policy: c.commandPolicy, workAuto: "workAuto" in c, reasoning: c.reasoning, messages: c.messages.length, forks: Array.isArray(c.forks), draft: s.drafts["imported-old"] }; })()`
);
check(
  "an old backup is migrated on import: workAuto → commandPolicy, dangling compacting marker dropped, string draft wrapped",
  imported.policy === "auto" && !imported.workAuto && imported.reasoning === "" && imported.messages === 1 && imported.forks && imported.draft?.text === "旧版草稿只是一段字",
  JSON.stringify(imported)
);
close();
