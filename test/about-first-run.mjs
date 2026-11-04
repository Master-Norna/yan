// 作品感检查：首次使用引导、文档页（版本与致谢）、各栏题头、类替代内联样式
import { readFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK, TMP } from "./lib.mjs";
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(`localStorage.clear(); true`);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Page.navigate", { url: PAGE });
check(
  "fresh installs default to the light theme even when the system is dark",
  await evalJs(`document.documentElement.dataset.theme === "light" && window.__yanState().settings.theme === "light"`)
);
check(
  "first-run notice visible without profiles",
  await evalJs(
    `!document.querySelector("#welcomeNotice").classList.contains("hidden") && document.querySelector("#welcomeNotice").textContent.includes("尚未接入模型")`
  )
);
await evalJs(`document.querySelector("#welcomeNotice [data-open-models]").click(); true`);
check(
  "notice button opens model settings",
  await evalJs(
    `!document.querySelector("#settingsModal").classList.contains("hidden") && document.querySelector(".tab-btn.active").dataset.tab === "models"`
  )
);
// 「关于」已并进文档：目录题后是版本，末一篇是致谢
check("no about tab", await evalJs(`!document.querySelector('.tab-btn[data-tab="about"]')`));
const heads = await evalJs(
  `[...document.querySelectorAll(".tab-btn")].map(b => (b.click(), (h => [b.dataset.tab, !!h?.querySelector(".settings-mark"), h?.querySelector("h2")?.textContent || "", h?.querySelector(".settings-lead")?.textContent || ""])(document.querySelector("#settingsContent .settings-head"))))`
);
check(
  "every tab has a head with icon, title and lead",
  heads.length === 12 && heads.every(([, mark, title, lead]) => mark && title && lead),
  JSON.stringify(heads)
);
// 栏目名多是雅称：每个栏目钮都有一句白话，靠近才浮出，并且不被内容区盖住
check("every tab has a plain-language tip", await evalJs(`[...document.querySelectorAll(".tab-btn")].every(b => b.dataset.tip)`));
const tabTip = `getComputedStyle(document.querySelector('.tab-btn[data-tab="duty"]'), "::after")`;
check("the tip is hidden at rest", await evalJs(`${tabTip}.opacity === "0"`));
const dutyTab = await evalJs(
  `(r => ({ x: r.left + 20, y: r.top + r.height / 2 }))(document.querySelector('.tab-btn[data-tab="duty"]').getBoundingClientRect())`
);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dutyTab.x, y: dutyTab.y });
await waitFor(`${tabTip}.opacity === "1"`, 3000).catch(() => {});
check("the tip shows when the pointer comes near", await evalJs(`${tabTip}.opacity === "1"`));
await shot("settings-tab-tip.png");
await evalJs(`document.documentElement.dataset.theme = "dark"; true`);
await sleep(200);
await shot("settings-tab-tip-dark.png");
await evalJs(`document.documentElement.dataset.theme = "light"; true`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
await evalJs(`document.querySelector('.tab-btn[data-tab="guide"]').click(); true`);
const guide = await evalJs(
  `(h => ({ version: h.querySelector(".settings-meta")?.textContent, last: [...h.querySelectorAll(".guide-row .guide-title")].pop()?.textContent }))(document.querySelector("#settingsContent"))`
);
check("guide head shows version, credits close the toc", guide.version === `v${VERSION}` && guide.last === "致谢", JSON.stringify(guide));
await evalJs(`document.querySelector('.guide-row[data-guide="credits"]').click(); true`);
check(
  "credits topic lists the vendored libraries",
  await evalJs(
    `["marked", "DOMPurify", "highlight.js", "KaTeX", "Mermaid", "Apache ECharts", "PDF.js"].every(n => document.querySelector("#guidePage").textContent.includes(n))`
  )
);
check(
  "nav foot has no version, no inline style",
  await evalJs(`!document.querySelector("#appVersion") && !document.querySelector(".settings-nav [style]")`)
);
await evalJs(
  `document.querySelector("#addProfile") || document.querySelector('.tab-btn[data-tab="models"]').click(); document.querySelector("#addProfile").click(); true`
);
await sleep(200);
check(
  "empty quota means unlimited, not invalid",
  await evalJs(
    `document.querySelector('[data-quota-amount]').getAttribute("aria-invalid") !== "true" && document.querySelector('[data-quota-amount]').placeholder === "不限"`
  )
);
// 内联样式只留给随数据变、写不进样式表的：印色色板、字体样字、用量卡的月份位置与图例色
check(
  "no inline styles in rendered settings except swatches",
  await evalJs(
    `[...document.querySelectorAll("#settingsContent [style]")].every(el => ["accent", "font"].includes(el.dataset.setting) || el.closest("#usageCard, #usageTip"))`
  )
);
check(
  "history empty state uses class",
  await evalJs(
    `!!document.querySelector("#history .history-empty") && getComputedStyle(document.querySelector("#history .history-empty")).padding === "10px"`
  )
);
check(
  "profile add button full width",
  await evalJs(
    `Math.abs(document.querySelector("#addProfile").getBoundingClientRect().width - document.querySelector("#profileList").getBoundingClientRect().width) < 2`
  )
);
close();
