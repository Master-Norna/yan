// 作品感检查：首次使用引导、关于页、类替代内联样式
import { connect, check, sleep, PAGE, WORK, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(`localStorage.clear(); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
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
await evalJs(`document.querySelector('.tab-btn[data-tab="about"]').click(); true`);
const about = await evalJs(
  `(h => ({ version: h.querySelector(".about-version")?.textContent, sections: [...h.querySelectorAll(".about-section h3")].map(n => n.textContent), credits: h.querySelectorAll(".about-credits li").length, kbd: h.querySelectorAll(".kbd").length }))(document.querySelector("#settingsContent"))`
);
check(
  "about tab renders",
  about.version?.startsWith("v0.3.0") && about.sections.join() === "数据与边界,键与操作,开源致谢" && about.credits === 7 && about.kbd >= 3,
  JSON.stringify(about)
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
  "quota field invalid via attribute",
  await evalJs(
    `getComputedStyle(document.querySelector('[data-quota-amount]')).borderColor === getComputedStyle(document.documentElement).getPropertyValue("--danger") || document.querySelector('[data-quota-amount]').getAttribute("aria-invalid") === "true"`
  )
);
check(
  "no inline styles in rendered settings except swatches",
  await evalJs(`[...document.querySelectorAll("#settingsContent [style]")].every(el => el.dataset.setting === "accent")`)
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
