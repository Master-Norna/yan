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
// 进行中：差遣卡片应在主行迹里出现，帮手的步骤嵌在它里面且摊开
let nestedLiveSeen = false,
  bothRunning = false,
  barRows = 0,
  barDoing = "",
  thoughtLive = false,
  metaHelpers = "";
const seen = [];
for (let i = 0; i < 200; i++) {
  const s = await evalJs(
    `(d => d ? { status: d.dataset.status, open: !!d.querySelector(".sub-steps[open]"), nested: d.querySelectorAll(".sub-steps .tool-step").length, live: d.querySelector(".sub-trail")?.dataset.live, running: document.querySelectorAll('.message.assistant .tool-step-delegate[data-status="running"]').length, barRows: document.querySelectorAll("#helperBar:not(.hidden) .helper-row").length, barDoing: [...document.querySelectorAll("#helperBar .helper-doing")].map(n => n.textContent).join("|"), thought: !!document.querySelector('.tool-step-delegate .sub-timeline .reasoning[data-state="live"]'), meta: document.querySelector(".message.assistant .tool-stack-meta")?.textContent || "" } : null)(document.querySelector(".message.assistant .tool-step-delegate"))`
  );
  if (s) seen.push(JSON.stringify(s));
  if (s?.status === "running" && s.open && s.nested >= 1 && s.live === "true") nestedLiveSeen = true;
  if (s?.running === 2) bothRunning = true;
  barRows = Math.max(barRows, s?.barRows || 0);
  if (s?.barDoing && /正在|等待确认|凝神/.test(s.barDoing)) barDoing = s.barDoing;
  if (s?.thought) thoughtLive = true;
  if (/名帮手|帮手「/.test(s?.meta || "")) metaHelpers = s.meta;
  // 卡片就地更新：进行中给第一张卡片与其第一个做完的嵌套步骤做个记号，之后每次刷新都该还是同一批节点（整张换新会让输出闪、思绪合不上）
  if (s?.status === "running" && s.nested >= 1)
    await evalJs(
      `(d => { window.__markLost ??= 0; if (!d.dataset.mark) { if (window.__cardMarked) window.__markLost++; d.dataset.mark = "1"; window.__cardMarked = true; } const step = d.querySelector('.sub-steps .tool-step[data-status="done"]'); if (step && !step.dataset.mark) { if (window.__stepMarked) window.__markLost++; step.dataset.mark = "1"; window.__stepMarked = true; } })(document.querySelector(".message.assistant .tool-step-delegate")); true`
    );
  if (await evalJs(`(document.querySelector('.message.assistant')?.dataset.status ?? "streaming") !== "streaming"`)) break;
  await sleep(60);
}
check("helper steps shown nested and open while running", nestedLiveSeen, [...new Set(seen)].slice(0, 6).join(" | "));
check("two helpers ran in parallel", bothRunning, [...new Set(seen)].slice(0, 6).join(" | "));
check("helper bar above the composer listed both helpers", barRows === 2, String(barRows));
check("helper bar tells what a helper is doing", /正在 (读取|修改|写入)|凝神|等待确认/.test(barDoing), barDoing);
check("helper's live thought shown inside its card", thoughtLive);
check(
  "delegate card and its nested steps are updated in place, never re-created",
  await evalJs(`(window.__markLost || 0) === 0 && !!document.querySelector('.tool-step-delegate[data-mark]')`),
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
await evalJs(
  `document.querySelector(".message.assistant .tool-stack").open = true; document.querySelector(".message.assistant .sub-steps").open = true; true`
);
await sleep(200);
await shot("delegate.png");
await evalJs(`document.querySelector(".message.assistant .sub-steps").open = false; true`);
const card = await evalJs(
  `(d => ({ label: d.querySelector(".tool-label").textContent, title: d.querySelector(".tool-title").textContent, meta: d.querySelector(".tool-meta").textContent, status: d.dataset.status, open: !!d.querySelector(".sub-steps[open]"), summary: d.querySelector(".sub-steps > summary")?.textContent.trim(), nested: [...d.querySelectorAll(".sub-steps .tool-step")].map(s => s.querySelector(".tool-label").textContent + ":" + s.dataset.status), report: d.querySelector(".sub-report")?.textContent.trim() || "", topLevel: d.parentElement.querySelectorAll(":scope > .tool-step").length }))(document.querySelector(".message.assistant .tool-step-delegate"))`
);
check(
  "delegate card labelled and titled",
  card.label.endsWith("差遣") && card.title === "改 a.js" && card.status === "done",
  JSON.stringify(card)
);
// 整张卡片可折叠：点头部收起，只剩标题行；再点展开；折叠状态记在步骤上
await evalJs(`document.querySelector(".message.assistant .tool-step-delegate > .tool-step-head").click(); true`);
check(
  "clicking the head folds the whole helper card",
  await evalJs(
    `(d => d.classList.contains("folded") && getComputedStyle(d.querySelector(".sub-trail")).display === "none" && getComputedStyle(d.querySelector(".tool-step-head")).display !== "none")(document.querySelector(".message.assistant .tool-step-delegate"))`
  )
);
await waitFor(`JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0].messages.at(-1).steps[0].folded === true`, 5000);
check("fold remembered on the step", true);
await evalJs(`document.querySelector(".message.assistant .tool-step-delegate > .tool-step-head").click(); true`);
check(
  "clicking again unfolds it",
  await evalJs(`!document.querySelector(".message.assistant .tool-step-delegate").classList.contains("folded")`)
);
check(
  "helper ran read then edit inside the card",
  card.nested.join() === "读取:done,修改:done" && card.summary === "帮手 · 2 步",
  JSON.stringify(card)
);
check("card meta counts helper steps and files", /2 步 · 改 1 个文件 · \d+ 秒/.test(card.meta), card.meta);
check(
  "helper steps fold after completion, report stays",
  !card.open && card.report.startsWith("回报：已把 return 1 改为 return 2"),
  JSON.stringify(card)
);
check("helper had its own system prompt and no delegate / ask_user", card.report.includes("sys:yes|delegate:no|ask:no"), card.report);
check("helper can read memory but not write it", card.report.includes("|memw:0|memr:2|"), card.report);
check("file actually changed by helper", readFileSync(WORK + "/src/a.js", "utf8").includes("return 2;"));
const steps = await evalJs(
  `JSON.stringify([...document.querySelectorAll(".message.assistant .tool-stack > .tool-stack-body .tool-step")].filter(s => !s.closest(".sub-steps")).map(s => ({ label: s.querySelector(".tool-label").textContent, status: s.dataset.status, meta: s.querySelector(".tool-meta").textContent })))`
);
check(
  "parent editing a file only the helper read is refused",
  JSON.parse(steps)[2]?.label === "修改" && JSON.parse(steps)[2]?.meta === "需先读取",
  steps
);
const second = await evalJs(
  `(d => d ? { title: d.querySelector(".tool-title").textContent, nested: [...d.querySelectorAll(".sub-steps .tool-step")].map(s => s.querySelector(".tool-label").textContent + ":" + s.dataset.status), thought: d.querySelector(".sub-timeline .reasoning .reasoning-body")?.textContent.slice(0, 12), report: d.querySelector(".sub-report")?.textContent.trim() } : null)(document.querySelectorAll(".message.assistant .tool-step-delegate")[1])`
);
check(
  "second helper's card: thought folded in, write step, report",
  second?.title === "建 b.js" &&
    second.nested.join() === "写入:done" &&
    second.thought.startsWith("帮手乙想第 1 步。") &&
    second.report === "回报乙：已新建 src/b.js。",
  JSON.stringify(second)
);
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
const after = await evalJs(
  `(d => d ? { nested: d.querySelectorAll(".sub-steps .tool-step").length, report: !!d.querySelector(".sub-report") } : null)(document.querySelector(".message.assistant .tool-step-delegate"))`
);
check("delegate card survives reload", after?.nested === 2 && after.report, JSON.stringify(after));
close();
