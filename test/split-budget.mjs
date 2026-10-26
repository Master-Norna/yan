// 右栏 × 整个浏览器的连接预算：别的标签页也开着言时，栏数跟着让；那一页关了，又能开回四栏
import { connect, check, sleep, PAGE, DEBUG } from "./lib.mjs";
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
for (let i = 0; i < 6; i++) await post("/api/chats/save", { root: "", savedAt: Date.now() + i, conversation: conversation(`sb-${i}`, `sb-${i}`) });

const { send, evalJs, waitFor, close } = await connect();
const paneState = `__yanSplit.state()`;
let otherTab = null;
const closeOther = async () => {
  if (!otherTab) return;
  await fetch(`${DEBUG}/json/close/${otherTab}`).catch(() => {});
  otherTab = null;
};
const cleanup = async () => {
  await closeOther();
  await evalJs(`(() => { for (const p of __yanSplit.state().panes.slice()) __yanSplit.close(p.slot); return true; })()`).catch(() => {});
  await sleep(1000);
  await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  close();
};
const waitStablePages = async (expected, timeout = 45000, stableFor = 1200) => {
  const started = Date.now();
  let matchedSince = 0;
  while (Date.now() - started < timeout) {
    const actual = await evalJs(`${paneState}.busPages`);
    if (actual === expected) {
      if (!matchedSince) matchedSince = Date.now();
      if (Date.now() - matchedSince >= stableFor) return actual;
    } else matchedSince = 0;
    await sleep(100);
  }
  const actual = await evalJs(`${paneState}.busPages`).catch(() => null);
  throw Error(`page count did not remain ${expected} for ${stableFor}ms (last=${actual})`);
};
const paneReady = id =>
  waitFor(
    `(() => { const s = ${paneState}.panes.find(p => p.id === ${JSON.stringify(id)}); if (!s) return false; const w = document.querySelector('.split-panel[data-slot="' + s.slot + '"] .split-frame')?.contentWindow; return !!w?.__yanPane?.bus?.() && !!w.document.querySelector("#messages .message.assistant"); })()`,
    60000
  );

try {
  await send("Emulation.setDeviceMetricsOverride", { width: 2200, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: PAGE + "preview.html" });
  await sleep(600);
  await evalJs(
    `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, lastView: "chat", lastConversationId: "sb-0" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], memory: { enabled: false, items: [] }, drafts: {} })); localStorage.removeItem("yan-split"); localStorage.removeItem("yan-split-width"); localStorage.removeItem("yan-split-v2"); true`
  );
  await send("Page.navigate", { url: PAGE });
  await waitFor(`typeof __yanSplit === "object" && document.querySelector("#messages")?.textContent.includes("sb-0的答")`, 20000);
  // 上一个用例收尾的页面可能还占着事件流：先等桥接只剩本页，再开另一个标签页
  await waitStablePages(1);

  // 1. 另开一个标签页的言：这个浏览器里言占了两处
  const tab = await (await fetch(`${DEBUG}/json/new?${encodeURIComponent(PAGE)}`, { method: "PUT" })).json();
  otherTab = tab.id;
  // 上一个用例收尾的页面，浏览器要过一会儿才真放开它们的事件流（桥接的心跳写失败时才认出来）：等到只剩这两处
  try {
    await waitStablePages(2);
  } catch (error) {
    const diag = await evalJs(`(() => ({ busPages: __yanSplit.state().busPages, panes: __yanSplit.state().panes.map(p => p.id) }))()`).catch(() => null);
    const pages = await fetch(`${DEBUG}/json`)
      .then(r => r.json())
      .then(list => list.filter(t => t.type === "page").map(t => ({ id: t.id, url: t.url, title: t.title })))
      .catch(() => null);
    console.log("  [diag]", JSON.stringify({ diag, pages, otherTab }));
    throw error;
  }
  const pageCount = await evalJs(`${paneState}.busPages`);
  check("the bridge counts two Yan pages in this browser", pageCount === 2);
  if (pageCount !== 2) throw Error("the browser did not settle at two Yan pages");

  // 2. 主页面 + 三栏 + 别的标签页 = 五处：第四栏该拒
  for (const id of ["sb-1", "sb-2", "sb-3"]) {
    check(`add ${id} with another tab open`, (await evalJs(`__yanSplit.add(${JSON.stringify(id)})`)) === true);
    try {
      await paneReady(id);
    } catch (error) {
      const diag = await evalJs(
        `(() => { const s = ${paneState}; const frames = [...document.querySelectorAll(".split-frame")].map(f => { const w = f.contentWindow; return { slot: f.closest(".split-panel")?.dataset.slot, src: f.getAttribute("src"), paneId: w?.__yanPane?.id?.(), bus: w?.__yanPane?.bus?.(), state: typeof w?.__yanState === "function", convs: w?.__yanState?.().conversations?.length, msgs: w?.document?.querySelectorAll("#messages .message").length, ready: w?.document?.readyState }; }); return { busPages: s.busPages, room: s.room, panes: s.panes.map(x => x.id), ids: __yanState().conversations.map(c => c.id), last: __yanState().settings.lastConversationId, active: document.querySelector('#history .history-item.active')?.dataset.conversation || "", saved: localStorage.getItem("yan-split-v2"), frames }; })()`
      ).catch(() => null);
      if (diag) {
        console.log("  [diag]", JSON.stringify(diag));
        for (const frame of diag.frames || []) console.log("  [frame]", JSON.stringify(frame));
      }
      throw error;
    }
  }
  await sleep(800);
  check("a fourth pane is refused while another tab holds a connection", (await evalJs(`__yanSplit.add("sb-4")`)) === false);
  check("the toast blames other tabs", (await evalJs(`document.querySelector("#toast").textContent`)).includes("别的标签页"));
  await evalJs(`document.querySelector('#history [data-conversation="sb-4"] .history-more').click(); true`);
  await waitFor(`!!document.querySelector('.chip-pop [data-menu="split"]')`);
  check(
    "the history menu says other tabs are using it",
    (await evalJs(`document.querySelector('.chip-pop [data-menu="split"]').disabled`)) &&
      (await evalJs(`document.querySelector('.chip-pop [data-menu="split"]').textContent`)).includes("别处占着")
  );
  await evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
  check("the main page still answers ordinary requests", await evalJs(`fetch("/api/store/config/load", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(4000) }).then(r => r.ok, () => false)`));

  // 3. 关掉别的标签页：又能开第四栏
  await closeOther();
  // 主页面和三栏仍占四处；只释放了另一标签页的那一处，预算必须恢复一栏。
  await waitStablePages(4);
  check("the freed connection restores one pane of room", (await evalJs(`${paneState}.room`)) >= 1);
  check("a fourth pane opens once the other tab is gone", (await evalJs(`__yanSplit.add("sb-4")`)) === true);
  await paneReady("sb-4");
  check("four panes are open", (await evalJs(`${paneState}.panes.length`)) === 4);
} finally {
  await cleanup();
}
