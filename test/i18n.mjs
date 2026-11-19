// 英文界面：检查译文表、页面语言、步骤文字，以及欢迎页、对话、模型菜单、卷宗和下列九个设置栏的漏翻。
// 漏翻按可见文本及界面属性筛查，正文、路径、印章等不计；末尾另验切回中文和新浏览器沿用磁盘语言。
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "Tester", theme: "light", inkMotion: "off", language: "en", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", name: "Fake", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", quota: "100k", usedTokens: 0 }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1500);
check(
  "the English table is loaded and the page is marked en",
  await evalJs(`typeof YAN_EN === "object" && document.documentElement.lang === "en"`)
);
check(
  "the greeting comes from the English pool",
  await evalJs(`!/[\\u4e00-\\u9fff]/.test(document.querySelector("#greeting").textContent)`)
);
// 看得见的字与 title / placeholder / aria-label：印章、正文、路径、语言选项不算
const leftover = () =>
  evalJs(
    `(() => { const out = new Set(); const skip = s => /^[\\u4e00-\\u9fff]$/.test(s) || /[\\\\/]|\\.yan|\\.tmp|\\.草稿/.test(s) || s === "中文" || /先算一下|下载/.test(s); const seen = el => el && !el.closest(".hidden, [hidden], script, style, .markdown, .message.user, .history-item, .chat-title, .tool-title, .tool-meta") && getComputedStyle(el).display !== "none"; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const s = n.nodeValue.trim(); if (/[\\u4e00-\\u9fff]/.test(s) && !skip(s) && seen(n.parentElement)) out.add(s); } for (const el of document.querySelectorAll("[title],[placeholder],[aria-label]")) { if (el.closest(".markdown, .history-item, .tool-step")) continue; for (const a of ["title", "placeholder", "aria-label"]) { const v = el.getAttribute(a); if (v && /[\\u4e00-\\u9fff]/.test(v) && !skip(v)) out.add(a + ": " + v); } } return [...out]; })()`
  );
const clean = async label => {
  const found = await leftover();
  check(`${label}: no untranslated Chinese`, !found.length, JSON.stringify(found));
};
await clean("welcome");
await evalJs(
  `document.querySelector("#welcomeInput").value = "PLAIN hello"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`[...document.querySelectorAll('#messages .message.assistant')].at(-1)?.dataset.status === "complete"`);
await sleep(300);
const meta = await evalJs(
  `[...document.querySelectorAll("#chatMeta, .chat-meta, #chatTitleMeta, .conversation-meta")].map(el => el.textContent.replace(/\\s+/g, " ")).join(" | ")`
);
check("one question reads in the singular", /\b1 question\b/.test(meta), meta);
await clean("chat");
// 步骤上存的是中文原文，画出来照语言换（写入几行、读了几行、几条结果……）
await evalJs(
  `document.querySelector("#chatInput").value = "NEWTOOLS go"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll('#messages .message.assistant').length === 2 && [...document.querySelectorAll('#messages .message.assistant')].at(-1)?.dataset.status === "complete"`
);
await sleep(300);
const metas = await evalJs(
  `[...document.querySelectorAll('.tool-step[data-status="done"] .tool-meta')].map(el => el.textContent.trim()).filter(Boolean)`
);
check(
  "finished steps read in English",
  metas.length > 0 && metas.every(text => !/[一-鿿]/.test(text) || /[\\/]/.test(text)),
  JSON.stringify(metas)
);
await evalJs(`document.querySelector("#composerArea .model-trigger").click(); true`);
await sleep(250);
await clean("model menu");
await evalJs(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); true`);
await sleep(150);
await evalJs(`document.querySelector("#openLibrary").click(); true`);
await sleep(400);
await clean("files");
await evalJs(`document.querySelector("#openLibrary").click(); true`);
await sleep(150);
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
for (const tab of ["general", "appearance", "models", "presets", "tools", "env", "mcp", "stage", "memory"]) {
  await evalJs(`document.querySelector('.tab-btn[data-tab="${tab}"]').click(); true`);
  await sleep(250);
  if (tab === "models")
    await evalJs(
      `document.querySelector('[data-profile-card="p1"]').open = true; document.querySelector(".profile-advanced").open = true; true`
    );
  await sleep(100);
  await clean(`settings · ${tab}`);
}
// 换回中文：存下即重新载入，译文表不再载入
await evalJs(`document.querySelector('.tab-btn[data-tab="general"]').click(); true`);
await sleep(200);
await evalJs(`document.querySelector('[data-setting="language"][data-value="zh"]').click(); true`);
await sleep(1800);
check(
  "switching back to Chinese reloads without the table",
  await evalJs(`typeof YAN_EN === "undefined" && document.documentElement.lang === "zh-CN" && __yanState().settings.language === "zh"`)
);
// 这台浏览器头一回打开（本地什么都没记），存储里记的语言与浏览器的不同：对齐配置后重新载入一回，照配置来。
// 存的那一种取与浏览器相反的，不然随浏览器也对，测不出
const browserZh = await evalJs(`/^zh/i.test(navigator.language)`),
  saved = browserZh ? "en" : "zh";
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
await evalJs(`document.querySelector('.tab-btn[data-tab="general"]').click(); true`);
await sleep(200);
await evalJs(`document.querySelector('[data-setting="language"][data-value="${saved}"]').click(); true`);
await sleep(2500);
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(`(localStorage.clear(), sessionStorage.clear(), true)`);
await send("Page.navigate", { url: PAGE });
await sleep(5000);
check(
  "a fresh browser follows the language saved in storage",
  await evalJs(
    `__yanState().settings.language === "${saved}" && (typeof YAN_EN === "object") === ${saved === "en"} && document.documentElement.lang === "${saved === "en" ? "en" : "zh-CN"}"`
  ),
  `saved ${saved}`
);
await close();
