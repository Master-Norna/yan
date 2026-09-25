// 版面细处：代码块的行距、引文的竖线、窄窗里的上下文计数、设置里填进去的值——都是截图里看得出、单测抓不到的走样
import { connect, check, sleep, PAGE } from "./lib.mjs";
const BASE = PAGE.replace(/\/$/, "");
const post = (p, b) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
const md = "代码：\n\n```js\nfunction add(a, b) {\n  return a + b;\n}\nconsole.log(add(1, 2));\n```\n\n> 引用一段话。\n\n末段。";
await post("/api/chats/save", {
  root: "",
  savedAt: Date.now(),
  conversation: {
    id: "ux-1",
    title: "版面",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
    profileId: "p1",
    forks: [],
    threads: [],
    messages: [
      { id: "u1", role: "user", content: "给一段示例", timestamp: "2026-09-24T00:00:00.000Z" },
      { id: "a1", role: "assistant", content: md, status: "complete", timestamp: "2026-09-24T00:00:01.000Z", modelName: "假模型" }
    ]
  }
});
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="ux-1"]')`, 8000);
await evalJs(`document.querySelector('[data-conversation="ux-1"] .history-open').click(); true`);
await waitFor(`!!document.querySelector("#messages pre code")`, 5000);

const code = await evalJs(
  `(() => { const code = document.querySelector("#messages pre code"), lines = code.textContent.replace(/\\n$/, "").split("\\n").length, lh = parseFloat(getComputedStyle(code).lineHeight); pre = code.closest("pre"), ps = getComputedStyle(pre); return { per: (pre.clientHeight - parseFloat(ps.paddingTop) - parseFloat(ps.paddingBottom)) / lines, lh }; })()`
);
check("code lines are spaced by the code's own line height, not stretched by the block", Math.abs(code.per - code.lh) < 1.5, JSON.stringify(code));
const quote = await evalJs(
  `(() => { const q = document.querySelector("#messages blockquote"), last = q.lastElementChild; return q.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom; })()`
);
check("the quote's rule ends with its text", quote < 4, String(quote));

// 电脑上把窗口拉窄（分屏）：快捷键提示藏了，右下角的上下文计数仍整个在窗口里
await send("Emulation.setDeviceMetricsOverride", { width: 700, height: 800, deviceScaleFactor: 1, mobile: false });
await waitFor(`!document.querySelector("#contextGauge").classList.contains("hidden")`, 5000).catch(() => {});
await sleep(400);
const gauge = await evalJs(`document.querySelector("#contextGauge").getBoundingClientRect().bottom`);
check("in a narrow window the context gauge stays inside the window", gauge > 0 && gauge <= 800, String(gauge));
await send("Emulation.setDeviceMetricsOverride", { width: 1380, height: 900, deviceScaleFactor: 1, mobile: false });

// 设置里模型卡片的值放在淡色标签里：值本身仍是正文墨色，与占位提示分得开
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(400);
await evalJs(`[...document.querySelectorAll("#settingsModal [data-tab]")].find(b => b.dataset.tab === "models").click(); true`);
await sleep(400);
const colors = await evalJs(
  `(() => { const input = [...document.querySelectorAll("#settingsModal .profile-grid input")].find(i => i.value === "fake"), label = input.closest("label"); return { value: getComputedStyle(input).color, label: getComputedStyle(label).color }; })()`
);
check("model field values are not as faint as their captions", colors.value !== colors.label, JSON.stringify(colors));
await close();
