// 用量簿（设置 → 模型 顶上的用量卡）：一答花的墨按日记进存储根的 用量.json；卡上一年一卷、一日一点墨，今天圈朱，
// 指上一点浮出那天各类的数；图例点一类只看那一类；有往年的才列年份可翻。桥接只认合法的日子与类别
import { readFileSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, HOME } from "./lib.mjs";

const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", quota: "", usedTokens: 0 }], conversations: [], memory: { enabled: true, items: [] }, drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(900);

const post = (path, body) =>
  evalJs(
    `fetch(${JSON.stringify(path)}, { method: "POST", headers: { "Content-Type": "application/json" }, body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.json())`
  );
const today = await evalJs(
  `(d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"))(new Date())`
);

await evalJs(
  `document.querySelector("#welcomeInput").value = "PLAIN USAGE"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`(m => m?.role === "assistant" && m.status === "complete")(__yanState().conversations[0]?.messages.at(-1))`, 30000);
// 关页前那几秒还攒着没报：打开模型栏时会先报上去再读
await evalJs(`document.querySelector("#quotaStatus").click(); true`);
await waitFor(`document.querySelector("#usageCard circle[fill-opacity]")`, 10000);
const book = JSON.parse(readFileSync(`${HOME}/用量.json`, "utf8"));
check("答完一问，主答的墨记在今天", book.days?.[today]?.main > 0, JSON.stringify(book.days));

const card = await evalJs(
  `({ today: !!document.querySelector("#usageCard .usage-today"), years: document.querySelectorAll("#usageCard [data-usage-year]").length, legend: [...document.querySelectorAll("#usageCard [data-usage-kind]")].map(b => b.dataset.usageKind).join(",") })`
);
check(
  "一卷一日一点，今天圈朱，只一年时不列可翻的年份",
  card.today && card.years === 0 && card.legend === "main,helper,side,review,image",
  JSON.stringify(card)
);
check(
  "墨点罩着洇墨，尘点与朱圈不洇",
  await evalJs(
    `!!document.querySelector("#usageCard #usageBleed feDisplacementMap") && !!document.querySelector('#usageCard g[filter="url(#usageBleed)"] circle[fill-opacity]') && !document.querySelector('#usageCard g[filter] .usage-dust, #usageCard g[filter] .usage-today')`
  )
);

await evalJs(
  `document.querySelector('#usageCard [data-usage-day="${today}"]').dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); true`
);
const tip = await evalJs(`(t => ({ shown: !t.classList.contains("hidden"), text: t.textContent }))(document.querySelector("#usageTip"))`);
check("指上今天那一点，浮出各类的数", tip.shown && /主答\s*\d/.test(tip.text) && tip.text.includes("—"), JSON.stringify(tip));
// 最下面一行（周日）：浮签伸出卡外，不能被卡片滑开用的 overflow: clip 截掉——浮签不在卡里，整张都露着
await evalJs(
  `document.querySelector('#usageCard [data-usage-day][y="72"]').dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); true`
);
const low = await evalJs(
  `(t => { const r = t.getBoundingClientRect(), card = document.querySelector("#usageCard").getBoundingClientRect(); return { inCard: !!t.closest("details"), rows: t.querySelectorAll("span").length, past: r.bottom > card.bottom, height: Math.round(r.height) }; })(document.querySelector("#usageTip"))`
);
check("指最下一行，浮签五类整张露着、伸出卡外也不截", !low.inCard && low.rows === 5 && low.past && low.height > 100, JSON.stringify(low));
// 浮签贴在那一点旁边、整张在设置面板里（右边放不下的翻到左边），不压着那一点
const beside = await evalJs(
  `(() => { const cells = [...document.querySelectorAll('#usageCard [data-usage-day]')].sort((a, b) => a.getBoundingClientRect().right - b.getBoundingClientRect().right), panel = document.querySelector("#usageCard").closest(".modal-panel").getBoundingClientRect(); return [cells[0], cells.at(-1)].map(cell => { cell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); const r = document.querySelector("#usageTip").getBoundingClientRect(), at = cell.getBoundingClientRect(); return { inPanel: r.left >= panel.left && r.right <= panel.right && r.top >= panel.top && r.bottom <= panel.bottom, side: r.left >= at.right ? "右" : r.right <= at.left ? "左" : "压着", at: Math.round(at.right), tip: [Math.round(r.left), Math.round(r.right)], panel: Math.round(panel.right) }; }); })()`
);
check(
  "浮签贴在点旁、不出设置面板：最左、最右一列都不压着那一点",
  beside.every(b => b.inPanel && b.side !== "压着"),
  JSON.stringify(beside)
);

// 旧记忆整理的原始账保留，但不再接受新记账，也不进入当前图例、浮签与墨点合计。
const legacyDay = "2025-05-31";
book.days[legacyDay] = { memory: 900000 };
writeFileSync(`${HOME}/用量.json`, JSON.stringify(book));
await post("/api/usage/add", {
  items: [
    { day: "2025-06-01", kind: "helper", amount: 5000 },
    { day: today, kind: "image", amount: 2 },
    { day: "2025-06-01", kind: "bogus", amount: 9 },
    { day: legacyDay, kind: "memory", amount: 99 },
    { day: "昨天", kind: "main", amount: 9 },
    { day: today, kind: "side", amount: -5 }
  ]
});
const after = JSON.parse(readFileSync(`${HOME}/用量.json`, "utf8")).days;
check(
  "桥接只认合法的日子与类别，往上加不覆盖",
  after["2025-06-01"]?.helper === 5000 &&
    !after["2025-06-01"].bogus &&
    !after["昨天"] &&
    after[today].image === 2 &&
    !after[today].side &&
    after[today].main === book.days[today].main,
  JSON.stringify(after)
);
check("记忆整理旧账原样保留，不再新增", after[legacyDay]?.memory === 900000, JSON.stringify(after[legacyDay]));

await evalJs(
  `document.querySelector('.tab-btn[data-tab="general"]').click(); document.querySelector('.tab-btn[data-tab="models"]').click(); true`
);
await waitFor(`document.querySelectorAll("#usageCard [data-usage-year]").length === 2`, 10000);
await evalJs(
  `document.querySelector('#usageCard [data-usage-day="${today}"]').dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); true`
);
check(
  "用量卡与浮签都不再列记忆整理",
  await evalJs(
    `!document.querySelector('#usageCard [data-usage-kind="memory"]') && !document.querySelector("#usageTip").textContent.includes("记忆")`
  )
);
await evalJs(`document.querySelector('#usageCard [data-usage-kind="image"]').click(); true`);
const image = await evalJs(
  `({ pressed: document.querySelector('#usageCard [data-usage-kind="image"]').getAttribute("aria-pressed"), dots: [...document.querySelectorAll("#usageCard circle[fill-opacity]")].map(c => c.getAttribute("fill")), total: document.querySelector('#usageCard [data-usage-kind="image"] b').textContent })`
);
check(
  "图例点生图：只剩生过图的那天，换胭脂色",
  image.pressed === "true" && image.dots.length === 1 && image.dots[0] === "var(--rouge)" && /2/.test(image.total),
  JSON.stringify(image)
);
await shot("usage.png");
await evalJs(`document.querySelector('#usageCard [data-usage-year="2025"]').click(); true`);
const past = await evalJs(
  `({ current: document.querySelector('#usageCard [aria-current="true"]').textContent, today: !!document.querySelector("#usageCard .usage-today") })`
);
check("翻到往年：那一卷没有今天的朱圈", past.current === "2025" && !past.today, JSON.stringify(past));
await evalJs(`document.querySelector('#usageCard [data-usage-kind="image"]').click(); true`);
check("旧记忆整理不进入墨点总量", await evalJs(`document.querySelectorAll("#usageCard circle[fill-opacity]").length === 1`));

close();
