// 差遣（子 Agent）：主模型把子任务交给帮手，帮手用同样的工具另起一段跑完并回报；步骤嵌在差遣卡片里，改动计入本答，主模型没读过的文件仍不能直接改
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
mkdirSync(WORK + "/src", { recursive: true });
writeFileSync(WORK + "/src/a.js", "function f() {\n  return 1;\n}\n");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(
  `document.querySelector("#welcomeInput").value = "DELEGATE"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
// 进行中：行迹里只该有一枚签（帮手的步骤不再嵌在里面）；点帮手条开右侧的差遣面板，帮手的时间线在那儿跟着流
let panelLiveSeen = false,
  bothRunning = false,
  barRows = 0,
  barDoing = "",
  thoughtLive = false,
  nestedInTrail = 0,
  metaHelpers = "",
  panelOpened = false,
  breathing = false;
const seen = [];
for (let i = 0; i < 200; i++) {
  // 帮手都到齐了就把面板点开（开在最后一名身上——面板一次只看一名，思绪不一定落在头一名），此后它随 350ms 的心跳自己更新
  if (!panelOpened) {
    const rows = await evalJs(`document.querySelectorAll("#helperBar:not(.hidden) .helper-row").length`);
    if (rows >= 2 || (rows >= 1 && i > 20)) {
      await evalJs(`[...document.querySelectorAll("#helperBar .helper-row")].at(-1).click(); true`);
      panelOpened = true;
    }
  }
  const s = await evalJs(
    `(d => d ? { status: d.dataset.status, trailNested: d.querySelectorAll(".tool-step").length, panelNested: document.querySelectorAll("#helperModal .tool-step").length, panelLive: document.querySelector("#helperModal .sub-trail")?.dataset.live, panelOpen: !document.querySelector("#helperModal").classList.contains("hidden"), running: document.querySelectorAll('.message.assistant .tool-step-delegate[data-status="running"]').length, barRows: document.querySelectorAll("#helperBar:not(.hidden) .helper-row").length, barDoing: [...document.querySelectorAll("#helperBar .helper-doing")].map(n => n.textContent).join("|"), thought: !!document.querySelector('#helperModal .sub-timeline .reasoning[data-state="live"]'), meta: document.querySelector(".message.assistant .tool-stack-meta")?.textContent || "" } : null)(document.querySelector(".message.assistant .tool-step-delegate"))`
  );
  if (s) seen.push(JSON.stringify(s));
  if (s?.status === "running" && s.panelOpen && s.panelNested >= 1 && s.panelLive === "true") panelLiveSeen = true;
  nestedInTrail = Math.max(nestedInTrail, s?.trailNested || 0);
  if (s?.running === 2) bothRunning = true;
  barRows = Math.max(barRows, s?.barRows || 0);
  if (s?.barDoing && /正在|等待确认|凝神/.test(s.barDoing)) barDoing = s.barDoing;
  if (s?.thought) thoughtLive = true;
  if (s?.status === "running") breathing = true;
  if (/名帮手|帮手「/.test(s?.meta || "")) metaHelpers = s.meta;
  // 面板里就地更新：给第一个做完的嵌套步骤做个记号，之后每次刷新都该还是同一个节点（整段换新会让输出闪、思绪合不上）
  if (s?.status === "running" && s.panelNested >= 1)
    await evalJs(
      `(() => { window.__markLost ??= 0; const step = document.querySelector('#helperModal .tool-step[data-status="done"]'); if (step && !step.dataset.mark) { if (window.__stepMarked) window.__markLost++; step.dataset.mark = "1"; window.__stepMarked = true; } })(); true`
    );
  if (await evalJs(`(document.querySelector('.message.assistant')?.dataset.status ?? "streaming") !== "streaming"`)) break;
  await sleep(60);
}
check("helper timeline runs live in the side panel", panelLiveSeen, [...new Set(seen)].slice(0, 6).join(" | "));
check("the trail keeps only a marker, no nested helper steps", nestedInTrail === 0, String(nestedInTrail));
check("two helpers ran in parallel", bothRunning, [...new Set(seen)].slice(0, 6).join(" | "));
check("helper bar above the composer listed both helpers", barRows === 2, String(barRows));
check("helper bar tells what a helper is doing", /正在 (读取|修改|写入)|凝神|等待确认/.test(barDoing), barDoing);
check("helper's live thought shown in the panel", thoughtLive);
// 呼吸是纯 CSS：无头浏览器强制 prefers-reduced-motion: reduce，那一档本就该把动画压掉（用户要少动效就该不动），
// 在这里量计算样式量不出东西。所以验两件真能验的：运行时那枚签确实带着 running 态（CSS 就钩在这上面），且规则确实进了产物
check("the marker carries the running state the breathing hooks onto", breathing, String(breathing));
check(
  "the breathing rule is in the built stylesheet",
  readFileSync("app.css", "utf8").includes(':root[data-ink-motion="on"] .tool-step-delegate[data-status="running"]')
);
check(
  "panel steps are updated in place, never re-created",
  await evalJs(`(window.__markLost || 0) === 0 && !!document.querySelector('#helperModal .tool-step[data-mark]')`),
  await evalJs(`String(window.__markLost)`)
);
check("trail summary names the helpers", /2 名帮手 · \d+ 步 · 进行中|帮手「.+」· \d+ 步 · 进行中/.test(metaHelpers), metaHelpers);
check(
  "helper bar gone after completion",
  await evalJs(
    `document.querySelector("#helperBar").classList.contains("hidden") || document.querySelector("#helperBar").classList.contains("leaving")`
  )
);
await waitFor(`document.querySelector('.message.assistant')?.dataset.status === "complete"`, 40000);
await evalJs(`document.querySelector(".message.assistant .tool-stack").open = true; true`);
await sleep(200);
await shot("delegate.png");
const card = await evalJs(
  `(d => ({ label: d.querySelector(".tool-label").textContent, title: d.querySelector(".tool-title").textContent, meta: d.querySelector(".tool-meta").textContent, status: d.dataset.status, nested: d.querySelectorAll(".tool-step").length, report: d.querySelector(".sub-report")?.textContent.trim() || "" }))(document.querySelector(".message.assistant .tool-step-delegate"))`
);
check(
  "the marker is labelled, titled and carries the report",
  card.label.endsWith("差遣") && card.title === "改 a.js" && card.status === "done" && card.nested === 0,
  JSON.stringify(card)
);
check("marker meta counts helper steps and files", /2 步 · 改 1 个文件 · \d+ 秒/.test(card.meta), card.meta);
// 一答收尾时步骤的 at 会前移，分组的键随之变。页面若不撤掉落单的旧分组，同一次差遣就画两遍
const painted = await evalJs(
  `JSON.stringify({ markers: document.querySelectorAll(".message.assistant .tool-step-delegate").length, groups: document.querySelectorAll(".message.assistant .tool-stack-body > .trail-group").length, steps: JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0].messages.at(-1).steps.length })`
);
check(
  "each step is painted once — stale groups are dropped when offsets shift",
  JSON.parse(painted).markers === 2 && JSON.parse(painted).groups <= JSON.parse(painted).steps,
  painted
);
check("report stays in the trail — that is what the main model consumed", card.report.startsWith("回报：已把 return 1 改为 return 2"), card.report);
// 点那枚签在右侧开面板，帮手做过的两步都在里面
await evalJs(`document.querySelector(".message.assistant .tool-step-delegate > .tool-step-head").click(); true`);
await sleep(200);
const panel = await evalJs(
  `(p => ({ open: !p.classList.contains("hidden"), title: document.querySelector("#helperTitle").textContent, sub: document.querySelector("#helperPanelSub").textContent, nested: [...p.querySelectorAll(".tool-step")].map(s => s.querySelector(".tool-label").textContent + ":" + s.dataset.status), nav: document.querySelector("#helperNav .helper-nav-count")?.textContent || "", report: p.querySelector(".sub-report")?.textContent.trim().slice(0, 12) || "" }))(document.querySelector("#helperModal"))`
);
check(
  "clicking the marker opens the helper's timeline in the panel",
  panel.open && panel.nested.join() === "读取:done,修改:done",
  JSON.stringify(panel)
);
check("panel head names the errand and its tally", panel.title === "改 a.js" && /2 步 · 改 1 个文件/.test(panel.sub), JSON.stringify(panel));
// 专色：只是看的归墨灰、动手改的归朱砂、差遣归金——一条时间线上扫一眼就该分得出，颜色不能是同一个
const hues = await evalJs(
  `JSON.stringify({ read: getComputedStyle(document.querySelector('#helperModal .tool-step[data-tool="read_file"] .tool-label')).color, edit: getComputedStyle(document.querySelector('#helperModal .tool-step[data-tool="edit_file"] .tool-label')).color, delegate: getComputedStyle(document.querySelector('.message.assistant .tool-step-delegate .tool-label')).color })`
);
const hue = JSON.parse(hues);
check(
  "reading, changing and delegating each read as a different colour",
  hue.read !== hue.edit && hue.edit !== hue.delegate && hue.read !== hue.delegate,
  hues
);
// 首轮吐的空行会被裁掉，步骤的偏移得跟着前移；不然每一轮说的话都错位、被切在字中间
const saidPerRound = await evalJs(
  `JSON.stringify([...document.querySelectorAll("#helperModal .sub-timeline > .trail-group > .trail-note")].map(n => n.textContent.trim()))`
);
check(
  "each round's words stay whole — offsets follow the trimmed leading blank lines",
  JSON.parse(saidPerRound).join("|") === "帮手第 1 步。|帮手第 2 步。",
  saidPerRound
);
check("nav shows which errand of how many", panel.nav === "1/2", panel.nav);
// ‹ › 翻到下一次差遣；中间的计数点开是一张列表
await evalJs(`document.querySelector('#helperNav [data-helper-step="1"]').click(); true`);
await sleep(200);
check(
  "the › arrow moves to the next errand",
  (await evalJs(`document.querySelector("#helperTitle").textContent`)) === "建 b.js" &&
    (await evalJs(`document.querySelector("#helperNav .helper-nav-count").textContent`)) === "2/2"
);
await evalJs(`document.querySelector("#helperNav [data-helper-list]").click(); true`);
await sleep(150);
const list = await evalJs(
  `JSON.stringify([...document.querySelectorAll("#helperList .helper-list-item")].map(n => n.querySelector(".helper-list-title").textContent))`
);
check("the count opens a list of every errand", JSON.parse(list).join("|") === "改 a.js|建 b.js", list);
await evalJs(`document.querySelectorAll("#helperList .helper-list-item")[0].click(); true`);
await sleep(200);
check("picking from the list switches to it", (await evalJs(`document.querySelector("#helperTitle").textContent`)) === "改 a.js");
check("helper had its own system prompt and no delegate / ask_user", card.report.includes("sys:yes|delegate:no|ask:no"), card.report);
check("helper can read memory but not write it", card.report.includes("|memw:0|memr:2|"), card.report);
check("file actually changed by helper", readFileSync(WORK + "/src/a.js", "utf8").includes("return 2;"));
const steps = await evalJs(
  `JSON.stringify([...document.querySelectorAll(".message.assistant .tool-stack > .tool-stack-body .tool-step")].map(s => ({ label: s.querySelector(".tool-label").textContent, status: s.dataset.status, meta: s.querySelector(".tool-meta").textContent })))`
);
check(
  "parent editing a file only the helper read is refused",
  JSON.parse(steps)[2]?.label === "修改" && JSON.parse(steps)[2]?.meta === "需先读取",
  steps
);
// 第二次差遣：点它的签，面板换过去
await evalJs(`document.querySelectorAll(".message.assistant .tool-step-delegate")[1].querySelector(".tool-step-head").click(); true`);
await sleep(200);
const second = await evalJs(
  `(p => ({ marker: document.querySelectorAll(".message.assistant .tool-step-delegate")[1].querySelector(".tool-title").textContent, nested: [...p.querySelectorAll(".tool-step")].map(s => s.querySelector(".tool-label").textContent + ":" + s.dataset.status), thought: p.querySelector(".sub-timeline .reasoning .reasoning-body")?.textContent.slice(0, 12) || "", report: p.querySelector(".sub-report")?.textContent.trim() }))(document.querySelector("#helperModal"))`
);
check(
  "panel switches to the second errand: its thought, write step and report",
  second.marker === "建 b.js" &&
    second.nested.join() === "写入:done" &&
    second.thought.startsWith("帮手乙想第 1 步。") &&
    second.report === "回报乙：已新建 src/b.js。",
  JSON.stringify(second)
);
// 合上那扇窗，后面几项看的是正文
await evalJs(`document.querySelector("#helperClose").click(); true`);
check("second helper's file exists", readFileSync(WORK + "/src/b.js", "utf8").includes("export const b = 2;"));
const text = await evalJs(`document.querySelector(".message.assistant .assistant-block > .markdown").textContent`);
check(
  "parent received both helper reports with change summaries",
  text.includes("帮手已完成（2 步，改了 1 个文件：src/a.js（+1 −1））") &&
    text.includes("回报：已把 return 1 改为 return 2") &&
    text.includes("帮手已完成（1 步，改了 1 个文件：src/b.js（+1 −0））"),
  text.slice(0, 400)
);
check(
  "change bar counts both helpers' changes",
  (await evalJs(`document.querySelector(".message.assistant .change-summary")?.textContent.replace(/\\s+/g, " ").trim()`)) ===
    "2 个文件已更改+2 −1",
  await evalJs(`document.querySelector(".message.assistant .change-summary")?.textContent`)
);
check(
  "context cost includes helper rounds",
  (await evalJs(`document.querySelector(".message.assistant .message-cost")?.textContent`)) === "耗墨 50",
  await evalJs(`document.querySelector(".message.assistant .message-cost")?.textContent`)
);
// 下一问的行迹摘要里应有差遣一条，连同帮手改过的文件
await evalJs(
  `document.querySelector("#chatInput").value = "DIGEST-ECHO"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll('.message.assistant').length === 2 && [...document.querySelectorAll('.message.assistant')].at(-1)?.dataset.status === "complete"`
);
const digest = await evalJs(`[...document.querySelectorAll('.message.assistant')].at(-1).querySelector(".markdown").textContent`);
check(
  "digest carries both delegate steps and helpers' files",
  /差遣「改 a\.js」→ 2 步 · 改 1 个文件 · \d+ 秒，改了 src\/a\.js；差遣「建 b\.js」→ 1 步 · 改 1 个文件 · \d+ 秒，改了 src\/b\.js/.test(
    digest
  ),
  digest
);
// 刷新后从存储重画：差遣卡片与嵌套步骤仍在
await send("Page.navigate", { url: PAGE });
await sleep(1500);
await evalJs(
  `[...document.querySelectorAll("#history .history-item")].find(n => n.textContent.includes("DELEGATE"))?.querySelector(".history-open").click(); true`
);
await sleep(600);
// 重载后：签与回报都还在，点开面板帮手那两步也还在（都存在步骤上，不靠内存）
await evalJs(`document.querySelector(".message.assistant .tool-step-delegate > .tool-step-head").click(); true`);
await sleep(300);
const after = await evalJs(
  `(d => d ? { marker: !!d, report: !!d.querySelector(".sub-report"), nested: document.querySelectorAll("#helperModal .tool-step").length } : null)(document.querySelector(".message.assistant .tool-step-delegate"))`
);
check("marker, report and the helper's timeline all survive reload", after?.marker && after.report && after.nested === 2, JSON.stringify(after));
close();
