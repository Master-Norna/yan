// 设置 → 专司：拟题（从通用移来，只有开关）、记忆、审查与生图（各自另配一份）四张卡；收起一行只写职名与模型名，最右一粒记号
import { writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";

const { send, evalJs, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: true }, profiles: [{ id: "p1", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", quota: "", usedTokens: 0 }], conversations: [], memory: { items: [] }, drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(900);
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(200);
check("通用里不再有自动拟题", !(await evalJs(`!!document.querySelector('#settingsContent [data-setting="autoTitle"]')`)));

await evalJs(`document.querySelector('.tab-btn[data-tab="duty"]').click(); true`);
await sleep(200);
const rows = await evalJs(
  `[...document.querySelectorAll("#settingsContent [data-duty]")].map(c => ({ id: c.dataset.duty, name: c.querySelector(".profile-name").textContent, gist: c.querySelector(".profile-gist").textContent, on: c.querySelector(".duty-mark").classList.contains("on"), tip: c.querySelector(".duty-mark").title }))`
);
check(
  "四张卡：拟题开（朱点）、记忆关不带、审查关照规则、生图未配，收起时都不写模型",
  JSON.stringify(rows.map(r => [r.id, r.on, r.tip, r.gist])) ===
    JSON.stringify([
      ["title", true, "开", ""],
      ["memory", false, "关，不带记忆", ""],
      ["review", false, "关，照规则", ""],
      ["image", false, "未配", ""]
    ]),
  JSON.stringify(rows)
);
check("题下导语", (await evalJs(`document.querySelector("#settingsContent .settings-lead").textContent`)) === "尺有所短，寸有所长。");

// 拟题在这里关掉，存进设置
await evalJs(`document.querySelector('[data-duty="title"] [data-setting="autoTitle"][data-value="false"]').click(); true`);
await sleep(100);
check(
  "拟题在专司里关掉即存，记号变空圈",
  (await evalJs(`__yanState().settings.autoTitle`)) === false &&
    !(await evalJs(`document.querySelector('[data-duty="title"] .duty-mark').classList.contains("on")`))
);

// 审查：开了才铺开那几格；填够了记号转朱、收起那行写模型名
await evalJs(`document.querySelector('[data-duty="review"] summary').click(); true`);
check("关着时只有开关一格", (await evalJs(`document.querySelectorAll('[data-duty="review"] .profile-grid > label').length`)) === 1);
await evalJs(`document.querySelector('[data-duty-on="review"][data-value="true"]').click(); true`);
await sleep(100);
check(
  "开了铺开接口、地址、Key、模型，卡仍开着",
  (await evalJs(`document.querySelectorAll('[data-duty="review"] .profile-grid > label').length`)) === 5 &&
    (await evalJs(`document.querySelector('[data-duty="review"]').open`))
);
check("开了没填完：空圈、悬停说未填完", (await evalJs(`document.querySelector('[data-duty="review"] .duty-mark').title`)) === "未填完");
for (const [field, value] of [
  ["baseUrl", "http://127.0.0.1:8798/v1"],
  ["apiKey", "k"],
  ["model", "fake-review"]
])
  await evalJs(
    `(i => { i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input")); })(document.querySelector('[data-duty="review"] [data-duty-field="${field}"]')); true`
  );
check(
  "填够了：朱点、收起那行写模型名",
  (await evalJs(`document.querySelector('[data-duty="review"] .duty-mark').classList.contains("on")`)) &&
    (await evalJs(`document.querySelector('[data-duty="review"] .profile-gist').textContent`)) === "fake-review"
);
await evalJs(`document.querySelector('[data-duty="review"] [data-duty-action="test"]').click(); true`);
await sleep(1500);
check("测试连接接得通", /可用/.test(await evalJs(`document.querySelector('[data-duty="review"] .profile-status').textContent`)));

// 审查可走 ChatGPT 订阅：账号一行代替地址与 Key，有模型即算配好；换回去，地址与 Key 还在
await evalJs(`document.querySelector('[data-duty="review"] [data-duty-api="chatgpt"]').click(); true`);
await sleep(200);
check(
  "审查换成 ChatGPT 订阅：账号一行代替地址与 Key，朱点",
  !(await evalJs(`!!document.querySelector('[data-duty="review"] [data-duty-field="baseUrl"]')`)) &&
    (await evalJs(`!!document.querySelector('[data-duty="review"] [data-chatgpt-account]')`)) &&
    (await evalJs(`document.querySelector('[data-duty="review"] .duty-mark').classList.contains("on")`))
);
await evalJs(`document.querySelector('[data-duty="review"] [data-duty-api="openai"]').click(); true`);
await sleep(200);
check(
  "换回 OpenAI 兼容，地址与 Key 还在",
  (await evalJs(`(d => d.baseUrl + "|" + d.apiKey)(__yanState().settings.dutyReview)`)) === "http://127.0.0.1:8798/v1|k"
);

// 生图：开即替它填好硅基流动的地址，接口只给两种
await evalJs(
  `document.querySelector('[data-duty="image"] summary').click(); document.querySelector('[data-duty-on="image"][data-value="true"]').click(); true`
);
await sleep(100);
check(
  "生图开了：硅基流动、地址已填、接口两种",
  (await evalJs(`__yanState().settings.dutyImage.baseUrl`)) === "https://api.siliconflow.cn/v1" &&
    (await evalJs(`document.querySelectorAll('[data-duty="image"] [data-duty-api]').length`)) === 2
);

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${TMP}/duty-settings.png`, Buffer.from(shot.data, "base64"));

// 存下来的几样，刷新后仍在
await sleep(1200);
await send("Page.navigate", { url: PAGE });
await sleep(900);
const saved = await evalJs(`(s => ({ review: s.dutyReview, image: s.dutyImage.on, title: s.autoTitle }))(__yanState().settings)`);
check(
  "刷新后审查与生图的配置都在",
  saved.review.on && saved.review.model === "fake-review" && saved.review.api === "openai" && saved.image === true && saved.title === false,
  JSON.stringify(saved)
);
await close();
