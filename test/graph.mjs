// 纲：自称成立要过验的人（同一个模型、干净的上下文、只读）；验后又改了相关文件，已成立的转待复验，收尾的闸先复验，
// 根没立住就把缺口递回去接着做，立住了才放行。验的那一枚签与差遣同一种，点开是验的人那条时间线
import { mkdirSync, rmSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const work = `${TMP}/graph-work`;
rmSync(work, { recursive: true, force: true });
mkdirSync(`${work}/src`, { recursive: true });
const workdir = work.split("/").join(process.platform === "win32" ? "\\" : "/");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, pendingWorkdir: ${JSON.stringify(workdir)}, workAutoDefault: true }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const lastAssistant = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`;
await evalJs(
  `document.querySelector("#welcomeInput").value = "GRAPHRUN 立纲试试"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`${lastAssistant}?.dataset.status === "complete"`, 60000);
const answer = await evalJs(
  `(m => ({ content: m.content, steps: (m.steps || []).map(s => ({ name: s.name, status: s.status, result: s.result, holds: s.verdict?.holds, node: s.verdict?.node, report: s.sub?.report, view: s.view, gate: s.gate })) }))(__yanState().conversations[0].messages.at(-1))`
);
const byName = name => answer.steps.filter(s => s.name === name);
const checks = byName("graph_check");
check(
  "a claim goes to the checker: the bad file fails, the fixed one holds, the gate re-checks after the file changed again, the root holds",
  checks.map(s => `${s.node}:${s.holds}`).join() === "parse:false,parse:true,parse:true,ship:true",
  JSON.stringify(checks.map(s => [s.node, s.holds, s.result]))
);
check(
  "the doer reads the checker's verdicts in the tool results",
  /GRAPHSTEP1\|first:true\|second:true/.test(answer.content),
  answer.content
);
check(
  "the checker gets read-only tools plus verdict: no write_file, no update_graph",
  checks.every(s => s.report === "AUDIT|verdict:true|write:false|graph:false"),
  JSON.stringify(checks.map(s => s.report))
);
check(
  "the closing gate passed the gap once, the model finished the root, then the gate let it go",
  byName("graph_gate").length === 1 && /GRAPHDONE\|gate:true/.test(answer.content),
  JSON.stringify({ gates: byName("graph_gate"), content: answer.content })
);
check(
  "the last graph card shows every item standing",
  byName("update_graph")
    .at(-1)
    ?.view?.map(item => `${item.id}:${item.state}`)
    .join() === "parse:holds,ship:holds",
  JSON.stringify(byName("update_graph").at(-1)?.view)
);
const ui = await evalJs(
  `(m => ({ checks: m.querySelectorAll('.tool-step-delegate[data-kind="验"]').length, gate: !!m.querySelector('.tool-step-note[data-tool="graph_gate"]'), tags: [...m.querySelectorAll(".tool-step-plan:not(.plan-old) .plan-tag")].length }))(${lastAssistant})`
);
check(
  "trail: four 验 markers, one gate note, the latest graph card has nothing left to flag",
  ui.checks === 4 && ui.gate && ui.tags === 0,
  JSON.stringify(ui)
);
// 点开验的那一枚签：差遣面板里是验的人的时间线（读了 p.js、交了判词）
await evalJs(`${lastAssistant}.querySelector('.tool-step-delegate[data-kind="验"] > .tool-step-head').click(); true`);
await sleep(500);
const panel = await evalJs(
  `({ open: !document.querySelector("#helperModal").classList.contains("hidden"), steps: [...document.querySelectorAll("#helperModal .tool-step")].map(s => s.dataset.tool || s.querySelector(".tool-label")?.textContent).join(",") })`
);
check("the 验 marker opens the checker's own timeline in the helper panel", panel.open && panel.steps === "read_file,verdict", JSON.stringify(panel));
// 下一问：纲已立住，不再附着；问一句无关的，闸不拦
const sent = await evalJs(`__yanState().conversations[0].messages.length`);
await evalJs(
  `document.querySelector("#chatInput").value = "随便问一句"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `__yanState().conversations[0].messages.length > ${sent} && __yanState().conversations[0].messages.at(-1).status === "complete"`,
  30000
);
const next = await evalJs(`(__yanState().conversations[0].messages.at(-1).steps || []).filter(s => s.name === "graph_gate").length`);
check("an unrelated question afterwards is not gated", next === 0, String(next));
close();
