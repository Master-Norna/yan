// 时间线：有了步骤之后，第一轮说的话只该出现在分组里，外面的正文区不能再画一遍（落墨动效开启时）
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
mkdirSync(WORK + "/src", { recursive: true });
writeFileSync(WORK + "/src/a.js", "function f() {\n  return 1;\n}\n");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "on", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(
  `document.querySelector("#welcomeInput").value = "DUP"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
let leaks = [],
  polls = 0,
  hopped = false;
for (;;) {
  // 第二轮思绪流到一半时翻去欢迎页再翻回来：生成期间页面上没有「当前对话」，时间线也不该乱
  if (!hopped && (await evalJs(`!!document.querySelector('.message.assistant .tool-stack .reasoning[data-state="live"]')`))) {
    hopped = true;
    await evalJs(
      `(w => { document.querySelector("#newChat").click(); __yanState().settings.pendingWorkdir = w; })(__yanState().settings.pendingWorkdir); true`
    );
    await sleep(300);
    await evalJs(
      `[...document.querySelectorAll("#history .history-item")].find(n => n.textContent.includes("DUP")).querySelector(".history-open").click(); true`
    );
    await sleep(200);
  }
  const s = await evalJs(
    `(a => a ? { status: a.dataset.status, stack: !!a.querySelector(".tool-stack"), outer: a.querySelector(".assistant-block > .markdown")?.textContent || "", notes: [...a.querySelectorAll(".trail-note")].map(n => n.textContent.slice(0, 20)) } : null)(document.querySelector(".message.assistant"))`
  );
  polls += 1;
  if (s?.stack && s.outer.includes("两个都做")) leaks.push(s.outer.slice(0, 30));
  if (s?.status && s.status !== "streaming") break;
  if (polls > 400) break;
  await sleep(50);
}
await shot("trail-dup.png");
check("hopped to welcome and back mid-generation", hopped);
check("round-1 text never painted outside the timeline once steps exist", !leaks.length, leaks.join(" | "));
const final = await evalJs(
  `(a => ({ outer: a.querySelector(".assistant-block > .markdown")?.textContent.trim(), notes: [...a.querySelectorAll(".trail-note")].map(n => n.textContent.trim().slice(0, 12)) }))(document.querySelector(".message.assistant"))`
);
check("final body is only the last round", final.outer === "DUP done", JSON.stringify(final));
check("round-1 text sits in the group note once", final.notes.length === 1 && final.notes[0].startsWith("两个都做"), JSON.stringify(final));

// 最后一步之后正写着的话（此时在行迹「进行中」那组里）：切去另一段对话再回来，整页重画不能在正文区另画一份大字的。
// 第一步之前没说话（步骤记在 0 处）也一样
await evalJs(
  `(w => { document.querySelector("#newChat").click(); __yanState().settings.pendingWorkdir = w; })(__yanState().settings.pendingWorkdir); true`
);
await sleep(300);
await evalJs(
  `document.querySelector("#welcomeInput").value = "DUPTAIL"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
const tailArticle = `[...document.querySelectorAll(".message.assistant")].at(-1)`,
  openChat = match =>
    `[...document.querySelectorAll("#history .history-item")].find(n => ${match}).querySelector(".history-open").click(); true`;
await waitFor(`(${tailArticle})?.querySelector(".trail-live")?.textContent.includes("尾段第2句")`, 10000);
await evalJs(openChat(`n.textContent.includes("DUP") && !n.textContent.includes("DUPTAIL")`));
await sleep(300);
await evalJs(openChat(`n.textContent.includes("DUPTAIL")`));
await sleep(400);
const mid = await evalJs(
  `(a => ({ streaming: a.dataset.status === "streaming", copies: [...a.querySelectorAll(".markdown")].filter(m => m.textContent.includes("尾段第1句")).length, outer: !!a.querySelector(".assistant-block > .markdown") }))(${tailArticle})`
);
check(
  "text after the last step is painted once after switching back",
  mid.streaming && mid.copies === 1 && !mid.outer,
  JSON.stringify(mid)
);
await waitFor(`(${tailArticle}).dataset.status !== "streaming"`, 10000);
const done = await evalJs(
  `(a => ({ outer: a.querySelector(".assistant-block > .markdown")?.textContent.trim(), live: !!a.querySelector(".trail-live"), copies: [...a.querySelectorAll(".markdown")].filter(m => m.textContent.includes("尾段第1句")).length }))(${tailArticle})`
);
check(
  "the tail lands in the body once when done",
  done.outer?.startsWith("尾段第1句") && !done.live && done.copies === 1,
  JSON.stringify(done)
);
await close();
