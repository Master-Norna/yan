// 拟题与首答并行：首答先写完时，收尾调用会撞上尚未结束的拟题请求；若它随后失败，仍要自动补试一次
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: true }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(
  `document.querySelector("#welcomeInput").value = "PLAIN TITLESLOWFAIL"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`, 10000);
check(
  "the first reply completes while the first title request is still pending",
  (await evalJs(`__yanState().conversations[0].titled`)) !== true
);
await waitFor(`__yanState().conversations[0].titled === true`, 5000);
const state = await evalJs(`__yanState()`);
check(
  "a late title failure is retried after the completed first reply",
  state.conversations[0].title === "测试标题" && state.conversations[0].titleTries === undefined,
  JSON.stringify([state.conversations[0].title, state.conversations[0].titleTries])
);

const begin = async suffix => {
  const count = await evalJs(`__yanState().conversations.length`);
  await evalJs(`document.querySelector("#newChat").click(); true`);
  await sleep(80);
  await evalJs(
    `document.querySelector("#welcomeInput").value = ${JSON.stringify(`PLAIN TITLEEDITRACE ${suffix}`)}; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
  );
  await waitFor(`__yanState().conversations.length === ${count + 1}`, 5000);
  await waitFor(
    `__yanState().conversations[0].messages.some(message => message.role === "assistant" && message.status === "complete")`,
    5000
  );
};

// 只把光标放进标题、没有真正输入：自动拟题回来后，blur 不能拿聚焦前的旧题覆盖它并误标成手改。
await begin("FOCUS");
const oldTitle = await evalJs(`document.querySelector("#chatTitle").textContent`);
await evalJs(
  `(() => { const t = document.querySelector("#chatTitle"); window.__titleEvents = []; for (const name of ["focus", "input", "blur"]) t.addEventListener(name, () => window.__titleEvents.push(name)); t.tabIndex = 0; window.focus(); t.focus(); return document.activeElement === t; })()`
);
await waitFor(`__yanState().conversations[0].titled === true`, 5000);
check(
  "auto title does not overwrite the title DOM while it is focused",
  (await evalJs(`document.querySelector("#chatTitle").textContent`)) === oldTitle
);
await evalJs(`document.querySelector("#chatTitle").blur(); true`);
check(
  "blur without an edit keeps the late auto title",
  await evalJs(
    `__yanState().conversations[0].title === "测试标题" && __yanState().conversations[0].titleAuto === true && document.querySelector("#chatTitle").textContent === "测试标题"`
  ),
  JSON.stringify(
    await evalJs(
      `({ title: __yanState().conversations[0].title, titleAuto: __yanState().conversations[0].titleAuto, dom: document.querySelector("#chatTitle").textContent, active: document.activeElement?.id, events: window.__titleEvents })`
    )
  )
);

// 真写了半截又按 Esc：应放弃半截，回到此刻状态里的自动题，而不是聚焦前的旧题。
await begin("ESC");
await evalJs(
  `(() => { const t = document.querySelector("#chatTitle"); t.tabIndex = 0; window.focus(); t.focus(); t.textContent = "半截手改"; t.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "改" })); return document.activeElement === t; })()`
);
await waitFor(`__yanState().conversations[0].titled === true`, 5000);
await evalJs(`document.querySelector("#chatTitle").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
check(
  "Escape during the race restores the late auto title without marking it manual",
  await evalJs(
    `__yanState().conversations[0].title === "测试标题" && __yanState().conversations[0].titleAuto === true && document.querySelector("#chatTitle").textContent === "测试标题"`
  )
);

// 真正写完并离开：人的标题仍应赢过同一时刻回来的自动题。
await begin("MANUAL");
await evalJs(
  `(() => { const t = document.querySelector("#chatTitle"); t.tabIndex = 0; window.focus(); t.focus(); t.textContent = "亲手定题"; t.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "题" })); return document.activeElement === t; })()`
);
await waitFor(`__yanState().conversations[0].titled === true`, 5000);
await evalJs(`document.querySelector("#chatTitle").blur(); true`);
check(
  "an actual edit still wins over the late auto title",
  await evalJs(`__yanState().conversations[0].title === "亲手定题" && __yanState().conversations[0].titleAuto === false`),
  JSON.stringify(
    await evalJs(
      `({ title: __yanState().conversations[0].title, titleAuto: __yanState().conversations[0].titleAuto, dom: document.querySelector("#chatTitle").textContent, active: document.activeElement?.id, events: window.__titleEvents })`
    )
  )
);

// 侧栏重命名框同理：只打开、没输入，迟到的自动题不能被旧 value 在 focusout 时反盖。
await begin("SIDEBAR");
await evalJs(
  `(() => { const id = __yanState().conversations[0].id, item = document.querySelector('[data-conversation="' + CSS.escape(id) + '"] .history-open'); item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; })()`
);
await waitFor(`!!document.querySelector("#history .history-rename")`, 2000);
await waitFor(`__yanState().conversations[0].titled === true`, 5000);
await evalJs(`document.querySelector("#history .history-rename").blur(); true`);
check(
  "sidebar focusout without input also keeps the late auto title",
  await evalJs(
    `__yanState().conversations[0].title === "测试标题" && __yanState().conversations[0].titleAuto === true && document.querySelector('#history [data-conversation="' + CSS.escape(__yanState().conversations[0].id) + '"]').textContent.includes("测试标题")`
  )
);
close();
