// 长活：一答之内工具往来撑满窗口时压成工作笔记接着做，而不是整段失败。
// 帮手（没填窗口，靠接口回「放不下」时压）与主答（填了窗口，送出前估到七成半就压）走的是同一处 readReply
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(WORK, { recursive: true });
for (let i = 0; i < 12; i++) writeFileSync(`${WORK}/big${i}.txt`, `file ${i}\n` + "abcdefgh ".repeat(900));
const stats = async () => (await fetch("http://127.0.0.1:8798/long-stats")).json();
const seed = () =>
  evalJs(
    `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
  );
const run = async text => {
  await evalJs(
    `document.querySelector("#welcomeInput").value = ${JSON.stringify(text)}; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
  );
  const last = `__yanState().conversations.find(c => c.messages[0]?.content === ${JSON.stringify(text)})?.messages.at(-1)`;
  await waitFor(`["complete", "error", "interrupted"].includes(${last}?.status)`, 60000);
  return evalJs(`(m => ({ status: m.status, content: m.content, error: m.error || "", steps: m.steps.map(s => s.name + ":" + s.status + ":" + (s.result || "")) }))(${last})`);
};

// 帮手：没填窗口。请求超过假接口的上限就回 context_length_exceeded，页面压掉较早的往来再发，帮手读完十二个文件照常回报
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await seed();
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const sub = await run("LONGRUN-SUB 读十二个大文件");
let s = await stats();
check("the helper hit the context limit at least once", (s.overflows.LONGSUB || 0) >= 1, JSON.stringify(s));
check("each overflow was answered with a fold", (s.folds.LONGSUB || 0) >= (s.overflows.LONGSUB || 0) && s.folds.LONGSUB >= 1, JSON.stringify(s));
check(
  "the helper finished and reported after folding — task kept, work note in place of the old rounds",
  sub.status === "complete" && /LONGSUB done\|note:yes\|folded:yes\|task:yes/.test(sub.content),
  JSON.stringify(sub).slice(0, 400)
);
check("the helper ran all twelve reads", s.rounds.LONGSUB === 13, JSON.stringify(s));
const meta = await evalJs(`document.querySelector(".message.assistant .tool-step-delegate .tool-meta")?.textContent || ""`);
check("the errand marker says how many times it folded", /12 步 · 压缩 \d+ 回/.test(meta), meta);

// 主答：填了窗口（20k）。按接口报的提示用量估，到七成半就先压，一次「放不下」都不该撞上
await evalJs(`__yanState().profiles[0].contextWindow = 20000; document.querySelector("#newChat").click(); true`);
await sleep(400);
const main = await run("LONGMAIN 依次读 big0.txt 到 big11.txt");
s = await stats();
check("the main answer folded before the window filled", (s.folds.LONGMAIN || 0) >= 1 && !s.overflows.LONGMAIN, JSON.stringify(s));
check(
  "the main answer completed with the note and its own question kept",
  main.status === "complete" && /LONGMAIN done\|note:yes\|folded:yes\|task:yes/.test(main.content),
  JSON.stringify(main).slice(0, 400)
);
check("every read step stays on the page after folding", main.steps.filter(x => x.startsWith("read_file:done")).length === 12, main.steps.join(","));
close();
