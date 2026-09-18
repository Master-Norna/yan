// 编码工具链：edit 前必读、edit 成功带 diff、只读指令免确认、search / list pattern、行迹摘要带入下一问
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK, TMP } from "./lib.mjs";
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
check(
  "suggestions are code-oriented",
  (await evalJs(`[...document.querySelectorAll("#welcome .suggestion")].map(b => b.textContent).join("|")`)) ===
    "读懂这个项目|修一个问题|加一个功能|写一段脚本并运行"
);
await evalJs(
  `document.querySelector("#welcomeInput").value = "EDIT"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
// 进行中：有了步骤之后，每一轮的话都应写在时间线里（进行中分组），外面不该出现又消失
let outsideLeaks = 0,
  liveSeen = 0,
  polls = 0,
  liveThinking = 0,
  topThinking = 0;
const drafting = new Set();
for (;;) {
  const s = await evalJs(
    `(a => a ? { status: a.dataset.status, outer: a.querySelector(".assistant-block > .markdown")?.textContent || "", stack: !!a.querySelector(".tool-stack"), live: !!a.querySelector(".trail-group.trail-live .markdown"), thinking: !!a.querySelector('.reasoning[data-state="live"]'), topThinking: !!a.querySelector('.assistant-block > .reasoning + .tool-stack'), drafting: a.querySelector(".trail-drafting")?.textContent || "" } : null)(document.querySelector(".message.assistant"))`
  );
  if (s?.status === "complete") break;
  polls++;
  if (s?.stack && s.outer.trim()) outsideLeaks++;
  if (s?.live) liveSeen++;
  if (s?.thinking) liveThinking++;
  if (s?.stack && s.topThinking) topThinking++;
  if (s?.drafting) drafting.add(s.drafting);
  if (polls > 2000) break;
  await sleep(15);
}
check(
  "while working, narration streams inside the timeline, never outside",
  outsideLeaks === 0 && liveSeen > 0,
  `leaks=${outsideLeaks} live=${liveSeen} polls=${polls}`
);
check("no live group left after completion", await evalJs(`!document.querySelector(".trail-group.trail-live")`));
check(
  "reasoning of later rounds pulses inside the timeline, never at the top",
  liveThinking > 0 && topThinking === 0,
  `live=${liveThinking} top=${topThinking}`
);
check(
  "tool arguments being drafted are announced",
  [...drafting].some(t => /正在拟 (修改|读取|运行|搜索|列目录)/.test(t)),
  JSON.stringify([...drafting])
);
const trailThoughts = await evalJs(
  `({ groups: [...document.querySelectorAll(".trail-group")].map(g => g.querySelector(".trail-reasoning .reasoning-body")?.textContent || ""), states: [...document.querySelectorAll(".reasoning")].map(d => d.dataset.state), top: document.querySelector(".assistant-block > .tool-stack + .reasoning .reasoning-body")?.textContent, drafting: !!document.querySelector(".trail-drafting") })`
);
check(
  "each round's thought sits in its group, final thought after the trail, all ticked",
  trailThoughts.groups.every((t, i) => t === `想一想 ${i + 1}，再想想。`) &&
    trailThoughts.top === "最后想一想。" &&
    trailThoughts.states.every(s => s === "done") &&
    !trailThoughts.drafting,
  JSON.stringify(trailThoughts)
);
const steps = await evalJs(
  `[...document.querySelectorAll(".tool-step")].map(s => ({ label: s.querySelector(".tool-label").textContent, status: s.dataset.status, meta: s.querySelector(".tool-meta").textContent, diff: !!s.querySelector(".tool-diff"), out: s.querySelector(".tool-output")?.textContent?.slice(0, 60) || "" }))`
);
console.log("  steps:", JSON.stringify(steps));
check("edit before read is refused", steps[0].label === "修改" && steps[0].status === "error" && steps[0].meta === "需先读取");
check(
  "read then edit succeeds with diff",
  steps[1].label === "读取" &&
    steps[2].label === "修改" &&
    steps[2].status === "done" &&
    steps[2].diff &&
    /第 2 行 · 1 处/.test(steps[2].meta)
);
check("file actually changed", readFileSync(WORK + "/src/a.js", "utf8").includes("return 2;"));
check(
  "change summary sits at the end of that reply",
  await evalJs(
    `(b => !!b && b.querySelector(".change-summary").textContent.replace(/\\s+/g, " ").trim() === "1 个文件已更改+1 −1" && b.previousElementSibling?.classList.contains("markdown"))(document.querySelector(".message.assistant .assistant-block .change-bar"))`
  ),
  await evalJs(`document.querySelector(".message.assistant .change-summary")?.textContent`)
);
await evalJs(`document.querySelector(".message.assistant .change-summary").click(); true`);
check(
  "change summary lists the file",
  await evalJs(
    `!document.querySelector(".message.assistant .change-files").classList.contains("hidden") && document.querySelector(".message.assistant .change-files .path").textContent === "src/a.js"`
  )
);
check(
  "read-only command ran without approval",
  steps[3].label === "运行" && steps[3].status === "done" && steps[3].meta.includes("只读免确认") && steps[3].out.includes("return 2")
);
check(
  "search_files results",
  steps[4].label === "搜索" && steps[4].status === "done" && steps[4].out.includes("src/a.js:2:") && /1 处 · 1 文件/.test(steps[4].meta)
);
check("list_files with pattern", steps[5].label === "列目录" && steps[5].out.includes("src/a.js") && !steps[5].out.includes("src/\n"));
check(
  "no pending approval happened",
  await evalJs(`!document.querySelector('#messages [data-approve]') && document.querySelector('#approvalBar').classList.contains('hidden')`)
);
const text = await evalJs(`document.querySelector(".message.assistant .markdown").textContent`);
check("model got refusal text then results", text.includes("尚未读过") && text.includes("已修改 src/a.js"), text.slice(0, 200));
// 行迹摘要：冠在下一问的开头（假模型同时确认 assistant 消息里没有）
await evalJs(
  `document.querySelector("#chatInput").value = "DIGEST"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll('.message.assistant').length === 2 && [...document.querySelectorAll('.message.assistant')].at(-1)?.dataset.status === "complete"`
);
const dump = await evalJs(
  `JSON.stringify([...document.querySelectorAll('.message.assistant')].map(a => ({ status: a.dataset.status, head: (a.querySelector(".markdown")?.textContent || "").slice(0, 40), tail: (a.querySelector(".markdown")?.textContent || "").slice(-40) })))`
);
check("digest carried into next turn", JSON.parse(dump).at(-1)?.tail.trim() === "有行迹", dump);
// 并行只读调用
await evalJs(
  `document.querySelector("#chatInput").value = "PAR"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll('.message.assistant').length === 3 && [...document.querySelectorAll('.message.assistant')].at(-1)?.dataset.status === "complete"`,
  40000
);
const par = await evalJs(
  `(a => ({ text: a.querySelector(".assistant-block > .markdown").textContent.trim(), steps: [...a.querySelectorAll(".tool-step")].map(s => s.querySelector(".tool-label").textContent + ":" + s.dataset.status), cost: a.querySelector(".message-cost")?.textContent }))([...document.querySelectorAll(".message.assistant")].at(-1))`
);
check(
  "three read-only calls ran in one round, results in order",
  par.text === "PAR|call_p0,call_p1,call_p2" && par.steps.join() === "列目录:done,搜索:done,读取:done",
  JSON.stringify(par)
);
check(
  "context cost shown on the reply, composer has none",
  par.cost === "耗墨 1.2k" && (await evalJs(`!document.querySelector("#contextCost")`)),
  JSON.stringify(par.cost)
);
check("digest not shown in UI", !(await evalJs(`document.querySelector('.message.assistant .markdown').textContent`)).includes("［行迹］"));
close();
