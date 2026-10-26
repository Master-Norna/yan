// 右栏活跃时另一实例的行为：右栏流式作答时左边能否同时发问、未读标记、主题同步、
// 忙时关闭是否先问一声、刷新主页面会不会打断右栏。两段对话各自独立。
import { connect, check, sleep, PAGE, DEBUG } from "./lib.mjs";

// 另起一个独立标签页，用它当“另一个浏览器窗口”的对照
function pageClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let seq = 0;
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++seq;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          try {
            ws.close();
          } catch {}
        }
      });
    ws.onmessage = event => {
      const m = JSON.parse(event.data);
      if (!m.id || !pending.has(m.id)) return;
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(Error(m.error.message)) : p.res(m.result);
    };
    ws.onerror = () => reject(Error("CDP WebSocket 出错"));
  });
}
const evalIn = async (c, expression) => {
  const r = await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || "页面求值出错");
  return r.result.value;
};
const waitEval = async (c, expression, timeout = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evalIn(c, expression).catch(() => false)) return true;
    await sleep(200);
  }
  throw Error("等待超时：" + expression);
};

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
await post("/api/chats/save", { root: "", savedAt: Date.now(), conversation: conversation("act-left", "左边这段") });
await post("/api/chats/save", { root: "", savedAt: Date.now() + 1, conversation: conversation("act-right", "右边这段") });
await post("/api/chats/save", { root: "", savedAt: Date.now() + 2, conversation: conversation("act-third", "另一个窗口") });

const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], memory: { enabled: false, items: [] }, drafts: {} })); localStorage.removeItem("yan-split"); localStorage.removeItem("yan-split-width"); localStorage.removeItem("yan-split-v2"); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="act-right"]')`, 8000);
await evalJs(`document.querySelector('[data-conversation="act-left"] .history-open').click(); true`);
await waitFor(`document.querySelector("#messages").textContent.includes("左边这段的答")`, 8000);
await evalJs(`document.querySelector('[data-conversation="act-right"] [data-history-action="menu"]').click(); true`);
await waitFor(`!!document.querySelector('.chip-pop [data-menu="split"]')`);
await evalJs(`document.querySelector('.chip-pop [data-menu="split"]').click(); true`);
const pane = `document.querySelector('.split-panel[data-slot="0"] .split-frame').contentWindow`;
await waitFor(`!!${pane}.document?.querySelector('#messages .message.assistant')`, 10000);
const rightDoc = `${pane}.document`;
const lastAssistant = doc => `[...${doc}.querySelectorAll('#messages .message.assistant')].at(-1)`;
const paneStatus = async () =>
  evalJs(`(() => { const m = ${lastAssistant(rightDoc)}; return m ? m.dataset.status : null; })()`);
const sendIn = (doc, text) =>
  evalJs(
    `(d => { const i = d.querySelector("#chatInput"); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); d.querySelector("#chatSend").click(); })(${doc}); true`
  );
const waitPaneStatus = (status, timeout = 25000) =>
  waitFor(`(() => { const m = ${lastAssistant(rightDoc)}; return !!m && m.dataset.status === ${JSON.stringify(status)}; })()`, timeout);

// 1. 右栏流式作答时，左边照常发问；两边互不串消息，左边侧栏不把右栏那段标成未读
await sendIn(rightDoc, "SLOWTEXT 右栏慢慢说");
await waitPaneStatus("streaming", 10000);
check("left composer stays usable while the right pane streams", !(await evalJs(`document.querySelector("#chatSend").disabled`)));
await sendIn("document", "PLAIN 左边同时问");
await waitFor(`(() => { const m = ${lastAssistant("document")}; return !!m && m.dataset.status === "complete"; })()`, 15000);
check("the left answer completes while the right pane is still streaming", (await paneStatus()) === "streaming");
await waitPaneStatus("complete");
check(
  "each answer stays in its own conversation",
  (await evalJs(`document.querySelector("#messages").textContent.includes("正文回答")`)) &&
    !(await evalJs(`document.querySelector("#messages").textContent.includes("第20段")`)) &&
    (await evalJs(`${rightDoc}.querySelector("#messages").textContent.includes("第20段")`)) &&
    !(await evalJs(`${rightDoc}.querySelector("#messages").textContent.includes("正文回答")`))
);
check(
  "both conversations kept all four messages",
  (await evalJs(`__yanState().conversations.find(c => c.id === "act-left").messages.length`)) === 4 &&
    (await evalJs(`__yanState().conversations.find(c => c.id === "act-right").messages.length`)) === 4
);
await sleep(3500);
check(
  "the right pane chat is not marked unread on the left",
  !(await evalJs(`!!document.querySelector('[data-conversation="act-right"] .history-state.unread')`)) &&
    !(await evalJs(`__yanState().conversations.find(c => c.id === "act-right").unread`)) &&
    (await evalJs(`!!document.querySelector('[data-conversation="act-right"] .split-mark')`))
);

// 2. 右栏忙着时，左边换明暗：右栏跟着换，且不打断作答
await sendIn(rightDoc, "SLOWTEXT 第二回");
await waitPaneStatus("streaming", 10000);
await evalJs(`document.querySelector("#themeToggle").click(); true`);
await waitFor(`${rightDoc}.documentElement.dataset.theme === document.documentElement.dataset.theme`, 8000).catch(() => {});
check(
  "a theme change on the left reaches the busy right pane",
  await evalJs(`${rightDoc}.documentElement.dataset.theme === document.documentElement.dataset.theme`)
);
check("the right stream keeps running through the theme change", (await paneStatus()) === "streaming");
await waitPaneStatus("complete");

// 3. 右栏忙着时点收起：先问一声；取消后右栏和作答都还在
await sendIn(rightDoc, "SLOWTEXT 第三回");
await waitPaneStatus("streaming", 10000);
await evalJs(`${rightDoc}.querySelector("#paneClose").click(); true`);
await sleep(500);
check(
  "closing a busy right pane asks first",
  !(await evalJs(`document.querySelector("#confirmModal").classList.contains("hidden")`)) &&
    (await evalJs(`document.querySelector("#confirmTitle").textContent`)).includes("右栏")
);
await evalJs(`document.querySelector("#confirmCancel").click(); true`);
await sleep(400);
check(
  "cancelling keeps the pane and its stream running",
  !(await evalJs(`document.querySelector("#splitRail").classList.contains("hidden")`)) && (await paneStatus()) === "streaming"
);
await waitPaneStatus("complete");

// 4. 右栏忙着时刷新主页面：右栏随之重载，在途的那一答被中断（多开窗口时刷新左边不会碰右边）
await sendIn(rightDoc, "SLOWTEXT 第四回");
await waitPaneStatus("streaming", 10000);
await send("Page.reload");
await waitFor(`typeof __yanState === "function"`, 20000);
await waitFor(`!!document.querySelector('.split-panel[data-slot="0"] .split-frame')?.contentWindow.__yanPane?.id()`, 20000).catch(() => {});
check(
  "after the parent reload the left chat and the right pane both come back",
  (await evalJs(`__yanState().settings.lastConversationId`)) === "act-left" &&
    (await evalJs(`document.querySelector('.split-panel[data-slot="0"] .split-frame').contentWindow.__yanPane?.id()`)) === "act-right"
);
await waitFor(
  `(() => { const c = __yanState().conversations.find(c => c.id === "act-right"); const m = c && c.messages.at(-1); return !!m && m.role === "assistant" && m.status !== "streaming"; })()`,
  25000
).catch(() => {});
const last = await evalJs(
  `(() => { const c = __yanState().conversations.find(c => c.id === "act-right"); const m = c && c.messages.at(-1); return m ? { role: m.role, status: m.status } : null; })()`
);
check(
  "reloading the parent interrupts the right pane's in-flight answer",
  !!last && last.role === "assistant" && last.status !== "streaming" && last.status !== "complete",
  JSON.stringify(last)
);
check(
  "the left conversation is untouched by the parent reload",
  (await evalJs(`__yanState().conversations.find(c => c.id === "act-left").messages.length`)) === 4
);

// 5. 右栏等确认时，左边照常；请示只出现在右栏
await sendIn(rightDoc, "帮我打个招呼");
await waitFor(`!!${rightDoc}.querySelector('#approvalBar [data-approve="run"]')`, 15000);
check(
  "the approval waits in the right pane, not on the left",
  !(await evalJs(`${rightDoc}.querySelector("#approvalBar").classList.contains("hidden")`)) &&
    (await evalJs(`document.querySelector("#approvalBar").classList.contains("hidden")`))
);
check("the left composer stays usable while the right pane waits for approval", !(await evalJs(`document.querySelector("#chatSend").disabled`)));
await evalJs(`${rightDoc}.querySelector('#approvalBar [data-approve="run"]').click(); true`);
await waitPaneStatus("complete", 25000);
check("the right pane finishes after its own approval", (await paneStatus()) === "complete");

// 6. 对照：另开一个独立标签页作答，刷新主页面不会打断它
const target = await (await fetch(`${DEBUG}/json/new?about:blank`, { method: "PUT" })).json();
const tab = await pageClient(target.webSocketDebuggerUrl);
await tab.send("Emulation.setDeviceMetricsOverride", { width: 1380, height: 900, deviceScaleFactor: 1, mobile: false });
await tab.send("Page.navigate", { url: PAGE });
await waitEval(tab, `!!window.__yanState && __yanState().conversations.length >= 3 && !!document.querySelector('[data-conversation="act-third"]')`, 20000);
await evalIn(tab, `document.querySelector('[data-conversation="act-third"] .history-open').click(); true`);
await waitEval(tab, `document.querySelector("#messages").textContent.includes("另一个窗口的答")`, 8000);
await evalIn(
  tab,
  `(d => { const i = d.querySelector("#chatInput"); i.value = "SLOWTEXT 多开对照"; i.dispatchEvent(new Event("input")); d.querySelector("#chatSend").click(); })(document); true`
);
await waitEval(
  tab,
  `(() => { const m = [...document.querySelectorAll('#messages .message.assistant')].at(-1); return !!m && m.dataset.status === "streaming"; })()`,
  10000
);
await send("Page.reload");
await sleep(1800);
check(
  "refreshing one tab does not interrupt another tab's stream",
  await evalIn(tab, `(() => { const m = [...document.querySelectorAll('#messages .message.assistant')].at(-1); return !!m && m.dataset.status === "streaming"; })()`)
);
await fetch(`${DEBUG}/json/close/${target.id}`);
tab.close();
await close();
