// 右栏多栏：四栏并排、第五栏拒绝、稳定槽位、逐栏聚焦、宽度与刷新恢复、1380 收侧栏、窄屏延迟挂载、删除只收一栏。
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
for (let i = 0; i < 6; i++) await post("/api/chats/save", { root: "", savedAt: Date.now() + i, conversation: conversation(`mp-${i}`, `mp-${i}`) });

const { send, evalJs, waitFor, close } = await connect();
const setMetrics = (width, height = 900) =>
  send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
const paneState = `__yanSplit.state()`;
const frameOf = slot => `document.querySelector('.split-panel[data-slot="${slot}"] .split-frame')`;
const paneIdOf = slot => `${frameOf(slot)}?.contentWindow?.__yanPane?.id()`;
// 中途超时也要把四栏收掉：每栏常占一条事件流，留着会挤占下一轮的同源连接
const cleanup = async () => {
  await evalJs(`(() => { for (const p of __yanSplit.state().panes.slice()) __yanSplit.close(p.slot); return true; })()`).catch(() => {});
  await sleep(1000);
  await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  close();
};

try {
  await setMetrics(2200);
  await send("Page.navigate", { url: PAGE + "preview.html" });
  await sleep(600);
  await evalJs(
    `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, lastView: "chat", lastConversationId: "mp-0" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], memory: { enabled: false, items: [] }, drafts: {} })); localStorage.removeItem("yan-split"); localStorage.removeItem("yan-split-width"); localStorage.removeItem("yan-split-v2"); true`
  );
  await send("Page.navigate", { url: PAGE });
  await waitFor(`typeof __yanSplit === "object" && document.querySelector("#messages")?.textContent.includes("mp-0的答")`, 20000);
  // 上一个用例收尾的页面可能还占着事件流：先等桥接只剩本页，再开四栏
  await waitFor(`__yanSplit.state().busPages === 1`, 45000).catch(() => {});
  await sleep(1200);

  // 1. 开四栏：主页面 mp-0 + 四栏 mp-1..mp-4 = 五处同源页面
  for (const id of ["mp-1", "mp-2", "mp-3", "mp-4"]) {
    check(`add ${id}`, (await evalJs(`__yanSplit.add(${JSON.stringify(id)})`)) === true);
    await waitFor(
      `(() => { const s = ${paneState}.panes.find(p => p.id === ${JSON.stringify(id)}); if (!s) return false; const w = document.querySelector('.split-panel[data-slot="' + s.slot + '"] .split-frame')?.contentWindow; return !!w?.__yanPane?.id() && (w.__yanState?.().conversations.length || 0) >= 6 && !!w.document.querySelector("#messages .message.assistant"); })()`,
      60000
    );
  }
  const four = await evalJs(`(() => { const s = ${paneState}; return { panes: s.panes.map(p => ({ slot: p.slot, id: p.id })), frames: window.frames.length, mobile: s.mobile }; })()`);
  check(
    "four panes open in slots 0..3 with the right ids",
    JSON.stringify(four.panes) === JSON.stringify([
      { slot: 0, id: "mp-1" },
      { slot: 1, id: "mp-2" },
      { slot: 2, id: "mp-3" },
      { slot: 3, id: "mp-4" }
    ])
  );
  check("five same-origin pages: four frames plus the main document", four.frames === 4 && four.mobile === false);
  check(
    "each pane reports its slot and is a pane page",
    await evalJs(`[...document.querySelectorAll(".split-frame")].every(f => { const w = f.contentWindow; return !!w?.__yanPane && w.document.documentElement.dataset.pane === "side" && w.__yanPane.slot === Number(f.closest(".split-panel").dataset.slot); })`)
  );

  // 2. 第五栏拒绝；菜单里 disabled
  check("a fifth pane is refused", (await evalJs(`__yanSplit.add("mp-5")`)) === false && (await evalJs(`${paneState}.panes.length`)) === 4);
  check("the cap toast says four panes", (await evalJs(`document.querySelector("#toast").textContent`)).includes("四栏"));
  await evalJs(`document.querySelector('#history [data-conversation="mp-5"] .history-more').click(); true`);
  await waitFor(`!!document.querySelector('.chip-pop [data-menu="split"]')`);
  check(
    "the history menu disables opening when four panes are full",
    (await evalJs(`document.querySelector('.chip-pop [data-menu="split"]').disabled`)) &&
      (await evalJs(`document.querySelector('.chip-pop [data-menu="split"]').textContent`)).includes("已满四栏")
  );
  await evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
  await sleep(200);

  // 3. 稳定槽位：关中间一栏，其余栏不重载；新栏落最小空槽
  await evalJs(
    `(() => { for (const p of ${paneState}.panes) { const f = document.querySelector('.split-panel[data-slot="' + p.slot + '"] .split-frame'); if (f?.contentWindow) f.contentWindow.__marker = p.id; } return true; })()`
  );
  await evalJs(`__yanSplit.close(1, "mp-2"); true`);
  await waitFor(`${paneState}.panes.length === 3`);
  check(
    "closing one pane keeps the other frames untouched",
    (await evalJs(`(() => ${paneState}.panes.every(p => { const f = document.querySelector('.split-panel[data-slot="' + p.slot + '"] .split-frame'); return f?.contentWindow?.__marker === p.id; }))()`)) &&
      (await evalJs(`document.querySelector('.split-panel[data-slot="1"]').classList.contains("hidden")`))
  );
  check("reopen lands in the lowest free slot", (await evalJs(`__yanSplit.add("mp-5")`)) === true);
  await waitFor(`${paneState}.panes.some(p => p.slot === 1 && p.id === "mp-5")`);
  await waitFor(`!!${paneIdOf(1)}`, 30000);
  check(
    "the reused slot gets the new chat; the other frames stay put",
    (await evalJs(`${paneIdOf(1)}`)) === "mp-5" &&
      (await evalJs(`(() => ${paneState}.panes.filter(p => p.slot !== 1).every(p => { const f = document.querySelector('.split-panel[data-slot="' + p.slot + '"] .split-frame'); return f?.contentWindow?.__marker === p.id; }))()`))
  );

  // 4. 聚焦某一栏：只闪那一栏，主页面不变
  await evalJs(`__yanSplit.open("mp-3"); true`);
  check(
    "focusing a pane flashes only that pane and leaves the main chat",
    (await evalJs(`document.querySelector('.split-panel[data-slot="2"]').classList.contains("flash")`)) &&
      !(await evalJs(`document.querySelector('.split-panel[data-slot="0"]').classList.contains("flash")`)) &&
      (await evalJs(`document.querySelector("#messages").textContent.includes("mp-0的答")`))
  );

  // 5. 宽度持久化：设宽、刷新后恢复
  await evalJs(`__yanSplit.setWidth(0, 420); true`);
  await sleep(300);
  check("setWidth applies at a wide window", Math.abs((await evalJs(`${paneState}.panes.find(p => p.slot === 0).actual`)) - 420) <= 1);
  await send("Page.reload");
  await sleep(1000);
  await waitFor(`typeof __yanState === "function" && typeof __yanSplit === "object"`, 20000);
  await waitFor(`${paneState}.panes.length === 4`, 30000);
  const restored = await evalJs(`(() => { const s = ${paneState}; return { panes: s.panes.map(p => ({ slot: p.slot, id: p.id, width: p.width })), saved: JSON.parse(localStorage.getItem("yan-split-v2") || "[]") }; })()`);
  check(
    "reload restores the four slots, ids and preferred widths",
    JSON.stringify(restored.panes.map(p => [p.slot, p.id])) === JSON.stringify([[0, "mp-1"], [1, "mp-5"], [2, "mp-3"], [3, "mp-4"]]) &&
      restored.saved.length === 4 &&
      Math.abs(restored.panes.find(p => p.slot === 0).width - 420) <= 1
  );

  // 5b. 拖分隔线：左移 60px，本栏变宽（2200 下主栏还有余量）
  const beforeDrag = await evalJs(`${paneState}.panes.find(p => p.slot === 1).actual`);
  const grip = await evalJs(
    `(() => { const r = document.querySelector('[data-split-grip="1"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 120 }; })()`
  );
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: grip.x, y: grip.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: grip.x - 60, y: grip.y, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: grip.x - 60, y: grip.y, button: "left", clickCount: 1 });
  await sleep(400);
  const afterDrag = await evalJs(`${paneState}.panes.find(p => p.slot === 1).actual`);
  check("dragging a pane's divider widens that pane", afterDrag > beforeDrag + 30, `${beforeDrag} -> ${afterDrag}`);

  // 6. 1380：自动收侧栏、每栏 >=240、主栏 >=356、rail 不滚；1920 恢复
  await setMetrics(1380);
  await sleep(900);
  const tight = await evalJs(`(() => { const s = ${paneState}; return { collapsed: s.sidebar.collapsed, auto: s.sidebar.auto, overflow: s.rail.overflow, actual: s.panes.map(p => p.actual), main: document.querySelector(".main").clientWidth }; })()`);
  check("at 1380 the sidebar auto-collapses", tight.collapsed && tight.auto);
  check("at 1380 every pane is at least 240 and the main at least 356", tight.actual.every(w => w >= 239) && tight.main >= 355);
  check("at 1380 the rail does not overflow", tight.overflow === false);
  await setMetrics(1920);
  await sleep(900);
  const wide = await evalJs(`(() => { const s = ${paneState}; return { collapsed: s.sidebar.collapsed, overflow: s.rail.overflow, actual: s.panes.map(p => p.actual), main: document.querySelector(".main").clientWidth }; })()`);
  check("at 1920 the sidebar comes back and panes widen", !wide.collapsed && wide.actual.every(w => w > 240) && wide.main >= 355);
  check("at 1920 the rail does not overflow", wide.overflow === false);
  await setMetrics(2200);
  await sleep(500);

  // 7. 窄屏启动延迟挂载：700 不挂，放宽后挂
  await setMetrics(700);
  await send("Page.reload");
  await sleep(1000);
  await waitFor(`typeof __yanState === "function" && typeof __yanSplit === "object"`, 20000);
  await sleep(1200);
  check(
    "a mobile boot does not mount the saved panes",
    (await evalJs(`${paneState}.panes.length`)) === 0 &&
      (await evalJs(`getComputedStyle(document.querySelector("#splitRail")).display === "none"`))
  );
  await setMetrics(1400);
  await waitFor(`${paneState}.panes.length === 4`, 30000);
  check("widening mounts the saved panes", (await evalJs(`${paneState}.panes.length`)) === 4);
  await waitFor(
    `(() => ${paneState}.panes.every(p => { const f = document.querySelector('.split-panel[data-slot="' + p.slot + '"] .split-frame'); return (f?.contentWindow?.__yanState?.().conversations.length || 0) >= 6; }))()`,
    30000
  ).catch(() => {});

  // 8. 删掉一段：只收对应那一栏
  await waitFor(
    `${paneState}.panes.every(p => { const f = document.querySelector('.split-panel[data-slot="' + p.slot + '"] .split-frame'); return !!f?.contentWindow?.__yanPane; })`,
    30000
  ).catch(() => {});
  const beforeDelete = await evalJs(`${paneState}.panes.map(p => p.id)`);
  await evalJs(
    `(() => { const s = __yanState(); s.conversations = s.conversations.filter(c => c.id !== "mp-4"); __yanSave(); document.querySelector('#history [data-conversation="mp-0"] .history-open').click(); return true; })()`
  );
  await sleep(700);
  check(
    "removing a conversation closes only its pane",
    (await evalJs(`${paneState}.panes.length`)) === beforeDelete.filter(id => id !== "mp-4").length &&
      !(await evalJs(`(() => ${paneState}.panes.some(p => p.id === "mp-4"))()`))
  );

  // 9. 明暗变化到每一栏；同时模拟真实布局抖动（输入区高度会不断改 <html> 的内联 style）。
  // 旧实现把 style 也当成设置变化，同步计时器被反复重置，栏里的明暗要等下一次布局变动才跟上。
  await sleep(2000);
  await evalJs(`document.querySelector("#themeToggle").click(); true`);
  await evalJs(
    `(() => { window.__themeChurn = setInterval(() => document.documentElement.style.setProperty("--composer-h", (100 + Math.random() * 20).toFixed(1) + "px"), 150); return true; })()`
  );
  await waitFor(
    `(() => ${paneState}.panes.every(p => { const f = document.querySelector('.split-panel[data-slot="' + p.slot + '"] .split-frame'); return f?.contentWindow?.document?.documentElement?.dataset?.theme === document.documentElement.dataset.theme; }))()`,
    8000
  ).catch(() => {});
  await evalJs(`clearInterval(window.__themeChurn); delete window.__themeChurn; true`);
  const themes = await evalJs(
    `(() => { const s = ${paneState}; return { main: document.documentElement.dataset.theme, panes: s.panes.map(p => { const f = document.querySelector('.split-panel[data-slot="' + p.slot + '"] .split-frame'); return { slot: p.slot, id: p.id, theme: f?.contentWindow?.document?.documentElement?.dataset?.theme, pane: !!f?.contentWindow?.__yanPane }; }) }; })()`
  );
  check("a theme change reaches every open pane", themes.panes.every(p => p.theme === themes.main), JSON.stringify(themes));
} catch (error) {
  // 超时的时候把每栏的现场打出来：是页面没起来，还是起来了却没跟上磁盘
  const diag = await evalJs(
    `(() => { const s = __yanSplit.state(); return { panes: s.panes.map(p => p.id), frames: [...document.querySelectorAll(".split-frame")].map(f => ({ slot: f.closest(".split-panel")?.dataset.slot, src: f.getAttribute("src"), pane: !!f.contentWindow?.__yanPane, id: f.contentWindow?.__yanPane?.id?.(), state: typeof f.contentWindow?.__yanState === "function", convs: f.contentWindow?.__yanState?.().conversations?.length, ready: f.contentDocument?.readyState, href: f.contentWindow?.location?.href })) }; })()`
  ).catch(() => null);
  if (diag) console.log("  [diag]", JSON.stringify(diag));
  throw error;
} finally {
  // 收尾：先关掉所有栏，释放它们占的事件流连接，免得下一轮用例撞上同源六条连接的上限
  await cleanup();
}
