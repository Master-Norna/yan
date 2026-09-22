// 通过 CDP 驱动无头 Edge，跑一遍执事模式：发送 → 工具调用 → 等待确认 → 运行 → 收尾；再测跳过、停止、轮次上限
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
// 先在不跑 support.js 的同源页面写入配置（主页面离开时会把内存里的旧 store 存回去，覆盖掉写入）
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(800);
// 写入模型配置与执事默认目录，再打开主页面
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: true }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
check("boot: bridge connected", (await evalJs(`document.querySelector("#connectionText").textContent`)) === "就绪");
console.log(
  "  debug:",
  await evalJs(
    `JSON.stringify({ mode: __yanState().settings.mode, welcomeMode: document.querySelector("#welcomeMode").textContent, chipHidden: document.querySelector("#workdirChip").className, chipText: document.querySelector("#workdirChip .chip-text").textContent, seal: document.querySelector("#modeSeal")?.dataset.mode })`
  )
);
check(
  "work mode chip visible",
  await evalJs(
    `!document.querySelector("#workdirChip").classList.contains("hidden") && document.querySelector("#welcomeMode").textContent === "执事"`
  )
);

// ---- 场景 1：问而后行 → 运行
await evalJs(
  `document.querySelector("#welcomeInput").value = "帮我打个招呼"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`!!document.querySelector('.tool-step[data-status="pending"] [data-approve="run"]')`);
check(
  "approval card shown with full command",
  (await evalJs(`document.querySelector('.tool-step[data-status="pending"] .tool-cmd-preview')?.textContent`)) ===
    "Write-Output '你好，世界'"
);
check("tool stack forced open", await evalJs(`document.querySelector(".tool-stack").open`));
check("connection label 等待确认", (await evalJs(`document.querySelector("#connectionText").textContent`)) === "等待确认");
check("sidebar waiting marker", await evalJs(`!!document.querySelector(".history-state.waiting")`));
check("meta 等待确认", (await evalJs(`document.querySelector(".tool-stack-meta").textContent`)) === "等待确认");
check(
  "approval bar above composer shows the command",
  await evalJs(
    `!document.querySelector("#approvalBar").classList.contains("hidden") && document.querySelector("#approvalBar .approval-cmd").textContent === "Write-Output '你好，世界'" && document.querySelector("#approvalBar").dataset.stepId === document.querySelector('.tool-step[data-status="pending"]').dataset.stepId`
  )
);
check(
  "jump-to-latest button clears the taller composer area",
  await evalJs(
    `parseInt(getComputedStyle(document.querySelector("#jumpBottom")).bottom) >= document.querySelector("#composerArea").offsetHeight + 10`
  ),
  await evalJs(
    `getComputedStyle(document.querySelector("#jumpBottom")).bottom + " vs " + document.querySelector("#composerArea").offsetHeight`
  )
);
check(
  "chat scroll padding follows the taller composer area",
  await evalJs(
    `parseInt(getComputedStyle(document.querySelector("#chatScroll")).paddingBottom) >= document.querySelector("#composerArea").offsetHeight`
  )
);
await evalJs(
  `(i => { i.value = ""; i.focus(); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })(document.querySelector("#chatInput")); true`
);
await waitFor(`document.querySelector('.message.assistant')?.dataset.status === "complete"`);
check(
  "Enter on an empty composer approved the command; bar gone",
  await evalJs(
    `document.querySelector("#approvalBar").classList.contains("hidden") || document.querySelector("#approvalBar").classList.contains("leaving")`
  )
);
// 收尾后停一拍才收（见 settleDetails），等它收起来
await waitFor(`!document.querySelector(".tool-stack").open`, 4000).catch(() => {});
check(
  "work trail collapses after completion with a duration label",
  await evalJs(
    `!document.querySelector(".tool-stack").open && document.querySelector(".tool-stack").classList.contains("is-work") && /^工作了 /.test(document.querySelector(".tool-stack-label").textContent)`
  ),
  await evalJs(`document.querySelector(".tool-stack-label").textContent`)
);
console.log(
  "  dom:",
  await evalJs(
    `(m => ({ cut: m?.dataset.cut, stable: m?.querySelector(".md-stable")?.textContent, tail: m?.querySelector(".md-tail")?.textContent, kids: [...document.querySelector(".assistant-block").children].map(n => n.className) }))(document.querySelector(".assistant-block > .markdown"))`
  )
);
const layout = await evalJs(
  `({ note: document.querySelector(".trail-group .trail-note")?.textContent.trim(), main: document.querySelector(".assistant-block > .markdown")?.textContent.trim(), groups: document.querySelectorAll(".trail-group").length, at: __yanState().conversations[0].messages.at(-1).steps.map(s => s.at) })`
);
check(
  "narration before the call sits inside the timeline, summary outside",
  layout.note === "我先执行一条指令。" && layout.main?.startsWith("指令结果"),
  JSON.stringify(layout)
);
await evalJs(`document.querySelector(".tool-stack > summary").click(); true`);
await sleep(400);
check(
  "opening the trail: command output is folded by default (only listings and diffs open)",
  await evalJs(
    `document.querySelector(".tool-stack").open && document.querySelector(".tool-step").classList.contains("folded") && getComputedStyle(document.querySelector(".tool-step .tool-output")).display === "none"`
  )
);
await evalJs(`document.querySelector(".tool-step .tool-step-head").click(); true`);
check("clicking the head unfolds the output", await evalJs(`!document.querySelector(".tool-step").classList.contains("folded")`));
await evalJs(`document.querySelector(".tool-step .tool-step-head").click(); true`);
check("clicking again folds it", await evalJs(`document.querySelector(".tool-step").classList.contains("folded")`));
await evalJs(`document.querySelector(".tool-step .tool-step-head").click(); true`);
const step1 = await evalJs(
  `(s => ({ status: s.dataset.status, meta: s.querySelector(".tool-meta").textContent, output: s.querySelector(".tool-output")?.textContent }))(document.querySelector(".tool-step"))`
);
check(
  "step completed with output",
  step1.status === "done" && /^完成 · /.test(step1.meta) && step1.output.includes("你好，世界"),
  JSON.stringify(step1)
);
const text1 = await evalJs(`document.querySelector(".message.assistant .assistant-block > .markdown").textContent`);
check("final answer references tool result", text1.includes("指令结果：成功"), text1);
check("stack meta after completion", (await evalJs(`document.querySelector(".tool-stack-meta").textContent`)) === "1 步");
check("waiting marker cleared", await evalJs(`!document.querySelector(".history-state.waiting, .history-state.running")`));
check("chat meta shows workdir", (await evalJs(`document.querySelector(".chat-meta-path")?.textContent || ""`)).includes("work"));
await sleep(600);
check("auto title applied", (await evalJs(`document.querySelector("#chatTitle").textContent`)) === "测试标题");

// ---- 场景 2：跳过
await evalJs(
  `document.querySelector("#chatInput").value = "再来一次"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(`document.querySelectorAll('.tool-step[data-status="pending"]').length === 1`);
await evalJs(`document.querySelector('.tool-step[data-status="pending"] [data-approve="skip"]').click(); true`);
await waitFor(`[...document.querySelectorAll('.message.assistant')].at(-1)?.dataset.status === "complete"`);
const step2 = await evalJs(
  `(s => ({ status: s.dataset.status, meta: s.querySelector(".tool-meta").textContent }))([...document.querySelectorAll(".tool-step")].at(-1))`
);
check("skipped step state", step2.status === "skipped" && step2.meta === "已跳过", JSON.stringify(step2));
check(
  "model told about skip",
  (await evalJs(`[...document.querySelectorAll(".message.assistant .markdown")].at(-1).textContent`)).includes("被跳过")
);
check(
  "stack meta counts skip",
  (await evalJs(`[...document.querySelectorAll(".tool-stack-meta")].at(-1).textContent`)) === "1 步 · 1 跳过"
);

// ---- 场景 3：等待确认时停止生成 → 步骤收束，无残留转圈
await evalJs(
  `document.querySelector("#chatInput").value = "第三次"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(`document.querySelectorAll('.tool-step[data-status="pending"]').length === 1`);
await evalJs(`document.querySelector("#chatSend").click(); true`);
await sleep(400);
const step3 = await evalJs(
  `(s => ({ status: s.dataset.status, meta: s.querySelector(".tool-meta").textContent, hasButtons: !!s.querySelector("[data-approve]") }))([...document.querySelectorAll(".tool-step")].at(-1))`
);
check("stop settles pending step", step3.status === "skipped" && step3.meta === "已停止" && !step3.hasButtons, JSON.stringify(step3));
check("message stopped", (await evalJs(`[...document.querySelectorAll('.message.assistant')].at(-1)?.dataset.status`)) === "stopped");
check("send button back to 寄", (await evalJs(`document.querySelector("#chatSend").textContent`)) === "寄");

// ---- 场景 4：三档切到径行 + 轮次上限（模型无限要求 list_files）；上限在「设置 → 通用」里改成 12
await evalJs(`document.querySelector("#openSettings")?.click() || document.querySelector('[data-open-settings]')?.click(); true`);
await sleep(300);
await evalJs(`document.querySelector('.tab-btn[data-tab="tools"]')?.click(); true`);
await sleep(200);
check(
  "default round caps shown in settings",
  (await evalJs(`document.querySelector("#settingToolRounds")?.value + "/" + document.querySelector("#settingSubRounds")?.value`)) ===
    "80/40"
);
await evalJs(
  `const i = document.querySelector("#settingToolRounds"); i.value = "12"; i.dispatchEvent(new Event("input")); document.querySelector("#closeSettings").click(); true`
);
await sleep(300);
await evalJs(`document.querySelector("#workAuto").click(); true`);
check("first policy step is automatic review", (await evalJs(`document.querySelector("#workAuto").textContent`)) === "审而后行");
await evalJs(`document.querySelector("#workAuto").click(); true`);
check("second policy step is auto-run", (await evalJs(`document.querySelector("#workAuto").textContent`)) === "径行");
mkdirSync(WORK, { recursive: true });
for (let i = 0; i < 14; i++) writeFileSync(`${WORK}/file-${i}.txt`, "x");
await evalJs(
  `document.querySelector("#chatInput").value = "LOOP"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(`[...document.querySelectorAll('.message.assistant')].at(-1)?.dataset.status === "complete"`, 60000);
const last = await evalJs(
  `(a => ({ steps: a.querySelectorAll(".tool-step").length, text: a.querySelector(".markdown").textContent.slice(-60) }))([...document.querySelectorAll('.message.assistant')].at(-1))`
);
check("round cap from settings stops the loop at 12", last.steps === 12, JSON.stringify(last));
check("final round sent without tools", last.text.includes("工具数 0"), last.text);
const folds = await evalJs(
  `(a => ({ folded: a.querySelectorAll(".tool-step.folded").length, foldable: a.querySelectorAll(".tool-step.foldable").length, lines: (a.querySelector(".tool-step .tool-output")?.textContent || "").split("\\n").length }))([...document.querySelectorAll('.message.assistant')].at(-1))`
);
// 长输出默认露前 10 行，底下一行「展开全部」；点它看全、再点回到前 10 行
check(
  "long directory listings show 10 lines by default",
  folds.folded === 0 && folds.foldable === 12 && folds.lines === 10,
  JSON.stringify(folds)
);
check(
  "a 展开全部 line follows the clipped output",
  /^展开全部 · \d+ 行$/.test(
    await evalJs(`[...document.querySelectorAll('.message.assistant')].at(-1).querySelector(".tool-step .tool-more")?.textContent || ""`)
  )
);
await evalJs(`[...document.querySelectorAll('.message.assistant')].at(-1).querySelector(".tool-step .tool-more").click(); true`);
check(
  "展开全部 reveals every line and offers to clip again",
  await evalJs(
    `(s => s.querySelector(".tool-output").textContent.split("\\n").length > 10 && s.querySelector(".tool-more").textContent === "只看前 10 行")([...document.querySelectorAll('.message.assistant')].at(-1).querySelector(".tool-step"))`
  )
);
await evalJs(`[...document.querySelectorAll('.message.assistant')].at(-1).querySelector(".tool-step .tool-more").click(); true`);
check(
  "clipping again shows 10 lines",
  await evalJs(
    `[...document.querySelectorAll('.message.assistant')].at(-1).querySelector(".tool-step .tool-output").textContent.split("\\n").length === 10`
  )
);

// ---- 场景 5：刷新后恢复（把一条消息伪造成 streaming + pending，存下再刷新）
await evalJs(
  `(() => { const s = __yanState(); const c = s.conversations[0]; c.messages.push({ id: "u9", role: "user", content: "x", timestamp: new Date().toISOString() }, { id: "a9", role: "assistant", content: "", timestamp: new Date().toISOString(), status: "streaming", modelName: "假模型", steps: [{ id: "s9", name: "run_command", arguments: "{}", title: "dir", status: "pending" }] }); __yanSave(); return true; })()`
);
await sleep(1500);
await send("Page.navigate", { url: PAGE });
await waitFor(`typeof __yanState === "function" && __yanState().conversations.some(c => c.messages.some(m => m.id === "a9"))`, 5000);
const recovered = await evalJs(
  `(() => { const m = __yanState().conversations.flatMap(c => c.messages).find(m => m.id === "a9"); return { status: m.status, step: m.steps[0].status, result: m.steps[0].result }; })()`
);
check(
  "reload settles pending step",
  recovered.status === "interrupted" && recovered.step === "skipped" && recovered.result === "连接中断",
  JSON.stringify(recovered)
);
close();
