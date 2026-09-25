// 页内可视化：只剩一条路——自足的 HTML 在隔离沙箱里就地渲染，与正文同一张纸（色板取自言、底透明、高度随内容）。
// 图表用 yan:echarts、流程图用 <pre class="mermaid">；旧对话里的 ```mermaid / ```echarts 围栏换成等价的 HTML 照样成图；换主题就地换色
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(
  `document.querySelector("#welcomeInput").value = "VIZDEMO 画几张"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`, 20000);
await waitFor(
  `[...document.querySelectorAll(".html-app")].length === 4 && [...document.querySelectorAll(".html-app")].every(a => a.dataset.appState === "ready" || a.dataset.appState === "error")`,
  20000
).catch(() => {});
const apps = JSON.parse(
  await evalJs(
    `JSON.stringify([...document.querySelectorAll(".html-app")].map(a => ({ state: a.dataset.appState, label: a.querySelector(".code-lang").textContent, detail: a.querySelector(".code-lang").title, height: a.querySelector(".html-app-stage").getBoundingClientRect().height })))`
  )
);
check(
  "all four blocks mount as html apps and run without error",
  apps.length === 4 && apps.every(a => a.state === "ready"),
  JSON.stringify(apps)
);
check("no mermaid / echarts is loaded into the page itself", await evalJs(`!window.mermaid && !window.echarts`));
check(
  "each block takes the height of its content instead of a fixed box",
  apps.every(a => a.height > 40 && a.height < 520) && new Set(apps.map(a => Math.round(a.height))).size > 1,
  JSON.stringify(apps.map(a => a.height))
);
await sleep(400);
await shot("viz-light.png");
// 换成暗色：已在页上的交互内容就地换色，不重跑（appId 不变）
const ids = await evalJs(`[...document.querySelectorAll(".html-app")].map(a => a.dataset.appId).join()`);
await evalJs(`document.querySelector("#themeToggle").click(); true`);
await sleep(1600);
check(
  "switching theme keeps the same running apps",
  (await evalJs(`[...document.querySelectorAll(".html-app")].map(a => a.dataset.appId).join()`)) === ids
);
await shot("viz-dark.png");
// 全屏：滚到中段再展开，那一块铺满窗口（四边各留 16px），点「收起」能退出
await evalJs(
  `document.querySelector("#chatScroll").scrollTop = 400; [...document.querySelectorAll(".html-app [data-work-expand]")].at(-1).click(); true`
);
await sleep(300);
// 滚动区的顶端渐隐（mask）会把里面的东西按滚动区的框裁掉：全屏时必须撤掉，不然只剩滚动区那一块、「收起」被裁在外面
const full = await evalJs(
  `(a => { const r = a.getBoundingClientRect(); return { rect: [r.left, r.top, innerWidth - r.right, innerHeight - r.bottom].map(Math.round), mask: getComputedStyle(document.querySelector("#chatScroll")).maskImage } })(document.querySelector(".work-expanded"))`
);
check(
  "fullscreen covers the window, unclipped by the scroll fade",
  full.rect.every(v => v === 16) && full.mask === "none",
  JSON.stringify(full)
);
await evalJs(`document.querySelector(".work-expanded [data-work-expand]").click(); true`);
await sleep(200);
check(
  "收起 leaves fullscreen",
  await evalJs(`!document.querySelector(".work-expanded") && !document.documentElement.classList.contains("work-mode")`)
);
// 焦点在可视化里时按 Esc：iframe 转告父页，照样退出全屏
await evalJs(
  `[...document.querySelectorAll(".html-app [data-work-expand]")].at(-1).click(); document.querySelector(".work-expanded iframe").focus(); true`
);
await sleep(200);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await waitFor(`!document.querySelector(".work-expanded")`, 3000).catch(() => {});
check("Esc inside the visualization leaves fullscreen", await evalJs(`!document.querySelector(".work-expanded")`));
close();
