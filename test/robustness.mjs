// 健壮性：截断的参数不许写文件（只读工具照跑）、缺必填项不执行、SSE 末尾没换行也不丢字与 usage、拟题失败下次再试、
// 卷宗里删掉的成品在答末标成「已移出卷宗」
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
const ARCHIVE = `${TMP}/archive3`;
rmSync(ARCHIVE, { recursive: true, force: true });
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: true, archiveDir: ${JSON.stringify(ARCHIVE.split("/").join(process.platform === "win32" ? "\\" : "/"))} }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const lastAssistant = `[...document.querySelectorAll(".message.assistant")].at(-1)`;
const store = async () => JSON.parse(await evalJs(`localStorage.getItem("yan-chat-v1")`));

// ---- 截断 / 缺项的参数：两次 write_file 都不许执行，list_files 截断了照样跑。同时头一次拟题装作失败
await evalJs(
  `document.querySelector("#welcomeInput").value = "TRUNC TITLEFAIL 写个文件"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`, 20000);
const steps = JSON.parse(
  await evalJs(
    `JSON.stringify([...document.querySelectorAll(".message.assistant .tool-step")].map(s => [s.dataset.status, s.querySelector(".tool-meta")?.textContent || ""]))`
  )
);
check(
  "truncated write_file is refused, missing content is refused, truncated list_files still runs",
  steps.length === 3 && steps[0].join() === "error,参数不完整" && steps[1].join() === "error,参数不合要求" && steps[2][0] === "done",
  JSON.stringify(steps)
);
check("no file was written from the broken calls", !existsSync(`${ARCHIVE}/截断.txt`) && !existsSync(`${ARCHIVE}/缺内容.txt`));
const text1 = await evalJs(`document.querySelector(".message.assistant .assistant-block").textContent`);
check(
  "model is told why: incomplete JSON and the missing field",
  /参数 JSON 不完整/.test(text1) && /缺少必填参数 content/.test(text1),
  text1.slice(0, 300)
);
await shot("robust-trunc.png");

// ---- 拟题：发问时就拟，头一次失败不该把 titled 锁死，那一答收尾时再试并成功
await waitFor(`JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0].titled === true`, 8000).catch(() => {});
let s1 = await store();
check(
  "first titling failed at send time, retried at the end of the first reply and succeeded",
  s1.conversations[0].titled === true && s1.conversations[0].title === "测试标题" && s1.conversations[0].titleTries === undefined,
  JSON.stringify([s1.conversations[0].titled, s1.conversations[0].title])
);

// ---- 页内可视化流式未闭合时的占位框：一页草图（网页是一页版式），行数记在节点上，每来一行草图上蘸一笔朱，不像卡住
await evalJs(
  `document.querySelector("#chatInput").value = "SLOWHTML 画个页"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(`document.querySelectorAll(".message.assistant").length === 2 && !!${lastAssistant}.querySelector(".viz-sketch")`, 20000);
const lines1 = await evalJs(`Number(${lastAssistant}.querySelector(".viz-pending")?.dataset.lines)`);
await waitFor(`Number(${lastAssistant}.querySelector(".viz-pending")?.dataset.lines || 0) > ${lines1}`, 5000);
const sketch = await evalJs(
  `(v => ({ lines: Number(v.dataset.lines), ink: v.querySelectorAll(".viz-sketch path").length >= 5, kind: v.dataset.vizPending, label: v.getAttribute("aria-label") }))(${lastAssistant}.querySelector(".viz-pending"))`
);
check(
  "pending viz box reports a growing line count and holds the sketch for its kind",
  sketch.lines > lines1 && sketch.ink && sketch.kind === "html" && /已写 \d+ 行$/.test(sketch.label),
  JSON.stringify([lines1, sketch])
);
await waitFor(`${lastAssistant}.dataset.status === "complete"`, 20000);
check(
  "placeholder replaced by the html app once closed",
  await evalJs(`!${lastAssistant}.querySelector(".viz-pending") && !!${lastAssistant}.querySelector(".html-app")`)
);

// ---- SSE 末尾没有换行：最后几个字与 usage 都不能丢
await evalJs(
  `document.querySelector("#chatInput").value = "NOEOL 说一句"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(`document.querySelectorAll(".message.assistant").length === 3 && ${lastAssistant}.dataset.status === "complete"`, 20000);
const text2 = await evalJs(`${lastAssistant}.querySelector(".assistant-block > .markdown").textContent`);
check("text after the last newline-less data: line is kept", text2.trim() === "开头，结尾在此", text2);
await waitFor(`JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0].titled === true`, 8000).catch(() => {});
s1 = await store();
check(
  "usage from the final unterminated frame is accounted",
  s1.conversations[0].messages.at(-1).tokenCount === 77 && s1.conversations[0].messages.at(-1).tokenEstimated === false,
  JSON.stringify(s1.conversations[0].messages.at(-1).usage)
);
check(
  "title still set after later replies",
  s1.conversations[0].titled === true && s1.conversations[0].title === "测试标题",
  JSON.stringify([s1.conversations[0].titled, s1.conversations[0].title])
);

// ---- 成品在卷宗里被删掉：答末的条目留着，标成已移出，按钮收起
await evalJs(
  `document.querySelector("#chatInput").value = "ARCHIVE 做个表"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(`document.querySelectorAll(".message.assistant").length === 4 && ${lastAssistant}.dataset.status === "complete"`, 20000);
await waitFor(`!!${lastAssistant}.querySelector(".deliver-bar")`, 5000);
check("deliverable listed with actions", await evalJs(`${lastAssistant}.querySelectorAll(".deliver-btn").length === 2`));
unlinkSync(`${ARCHIVE}/报表.csv`);
await evalJs(`document.querySelector("#openLibrary").click(); true`);
await sleep(900);
await evalJs(`document.querySelector("#openLibrary").click(); true`);
await sleep(300);
const gone = await evalJs(
  `(f => ({ missing: f.classList.contains("missing"), note: f.querySelector(".deliver-gone")?.textContent || "", btns: f.querySelectorAll(".deliver-btn").length }))(${lastAssistant}.querySelector(".deliver-file"))`
);
check(
  "deleted deliverable is marked 已移出卷宗 without view / download",
  gone.missing && gone.note === "已移出卷宗" && gone.btns === 0,
  JSON.stringify(gone)
);
await shot("robust-deliver-gone.png");
close();
