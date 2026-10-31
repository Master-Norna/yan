// 生图（设置 → 专司）：配好了才把 generate_image 交给模型；画好的图收进卷宗、挂在步骤上、随工具结果附给模型，正文引文件名就地画出；
// 硅基流动交回的是网址，桥接取成 data: 地址。没配生图时工具不交出，生图接口一问也收不到
import { existsSync } from "node:fs";
import { connect, check, usageOf, sleep, PAGE, ARCHIVE } from "./lib.mjs";

const asks = async () => (await fetch("http://127.0.0.1:8798/image-asks")).json();
const { send, evalJs, waitFor, close } = await connect();
const duty = { on: true, api: "siliconflow", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", model: "Kwai-Kolors/Kolors", modelList: [] };
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, dutyImage: ${JSON.stringify(duty)} }, profiles: [{ id: "p1", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", quota: "", usedTokens: 0 }], conversations: [], memory: { enabled: true, items: [] }, drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(900);
await asks();

// 等本次新开的那篇对话答完（看状态，不看页面上残留的上一段）
const ask = async () => {
  const before = await evalJs(`__yanState().conversations.length`);
  await evalJs(
    `document.querySelector("#welcomeInput").value = "IMAGE-DUTY"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
  );
  await waitFor(
    `__yanState().conversations.length > ${before} && (m => m?.role === "assistant" && m.status === "complete")(__yanState().conversations[0].messages.at(-1))`,
    30000
  );
  return evalJs(
    `(m => ({ steps: (m.steps || []).map(s => ({ name: s.name, status: s.status, title: s.title, files: (s.attachments || []).map(a => a.name) })), reply: m.content, deliverables: (m.deliverables || []).map(d => d.name) }))(__yanState().conversations[0].messages.at(-1))`
  );
};

let state = await ask();
check(
  "配了生图：画好收进卷宗，挂在步骤上",
  state.steps[0]?.name === "generate_image" &&
    state.steps[0].status === "done" &&
    state.steps[0].files[0] === "墨猫.png" &&
    existsSync(`${ARCHIVE}/墨猫.png`),
  JSON.stringify(state.steps)
);
const log = await asks();
check(
  "硅基流动的参数名：image_size、batch_size",
  log.length === 1 &&
    log[0].model === "Kwai-Kolors/Kolors" &&
    log[0].image_size === "1024x1024" &&
    log[0].batch_size === 1 &&
    log[0].prompt === "一只墨色的猫",
  JSON.stringify(log)
);
check(
  "工具结果写明存处，图随结果附给模型",
  /存为 墨猫\.png/.test(state.reply) && /看到图 1 幅/.test(state.reply),
  state.reply.slice(0, 300)
);
await waitFor(
  '((m) => (m?.deliverables || []).some(d => d.name === "墨猫.png"))(__yanState().conversations[0]?.messages.at(-1))',
  10000
).catch(() => {});
const deliverables = await evalJs("(__yanState().conversations[0]?.messages.at(-1)?.deliverables || []).map(d => d.name)");
check("答末成品条列出这幅", deliverables.includes("墨猫.png"), JSON.stringify(deliverables));
await waitFor(`!!document.querySelector(".message.assistant .markdown .reply-shot img")`, 5000).catch(() => {});
check("正文引文件名就地画出", await evalJs(`!!document.querySelector(".message.assistant .markdown .reply-shot img")`));

// 一轮四稿：四件一起画，正文里接连几幅（同段换行的、另起一段的）收成一叠，不一路往下堆
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(400);
await asks();
const before = await evalJs(`__yanState().conversations.length`);
await evalJs(
  `document.querySelector("#welcomeInput").value = "IMAGE-FOUR"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(
  `__yanState().conversations.length > ${before} && (m => m?.role === "assistant" && m.status === "complete")(__yanState().conversations[0].messages.at(-1))`,
  30000
);
check(
  "一轮四稿都画好",
  (await asks()).length === 4 &&
    (await evalJs(`__yanState().conversations[0].messages.at(-1).steps.filter(s => s.status === "done").length`)) === 4
);
await waitFor(`document.querySelectorAll(".message.assistant .markdown .reply-shots > .reply-shot").length === 4`, 5000).catch(() => {});
check(
  "接连几幅收成一叠",
  await evalJs(
    `(m => m.querySelectorAll(".reply-shots").length === 1 && m.querySelectorAll(".reply-shots > .reply-shot").length === 4 && m.querySelector(".reply-shots").dataset.count === "共 4 幅" && !m.querySelector(".reply-shots + br, .reply-shots ~ p:empty"))(document.querySelector(".message.assistant .markdown"))`
  )
);
// 点开那一叠：叠里四幅同在一组，从最上那幅看起，← → 翻
const viewed = () =>
  evalJs(
    `JSON.stringify({ name: document.querySelector("#imageViewerName").textContent, marks: document.querySelectorAll("#imageViewerStrip [data-strip-index]").length, on: [...document.querySelectorAll("#imageViewerStrip [data-strip-index]")].findIndex(b => b.classList.contains("on")) })`
  ).then(JSON.parse);
await evalJs(`document.querySelector(".message.assistant .reply-shots > .reply-shot").click(); true`);
await waitFor(
  `!document.querySelector("#imageViewer").classList.contains("hidden") && document.querySelector("#imageViewerName").textContent.startsWith("墨猫甲")`,
  5000
).catch(() => {});
let seen = await viewed();
check(
  "点开那一叠：四幅同在一组，从最上那幅看起",
  seen.marks === 4 && seen.on === 0 && seen.name.startsWith("墨猫甲"),
  JSON.stringify(seen)
);
await evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); true`);
await waitFor(`document.querySelector("#imageViewerName").textContent.startsWith("墨猫乙")`, 5000).catch(() => {});
seen = await viewed();
check("→ 翻到叠里的下一幅", seen.on === 1 && seen.name.startsWith("墨猫乙"), JSON.stringify(seen));
await evalJs(`document.querySelector("#imageViewerClose").click(); true`);

// 没配生图：工具不交出，接口一问也没收到
await evalJs(`__yanState().settings.dutyImage.on = false; document.querySelector("#newChat").click(); true`);
await sleep(400);
state = await ask();
check("没配生图：工具不交出", state.steps[0]?.status !== "done" && !existsSync(`${ARCHIVE}/墨猫 (2).png`), JSON.stringify(state.steps));
check("没配生图：生图接口一问也没收到", (await asks()).length === 0);
const used = await usageOf("image");
check("生图记进用量簿，按张数", used > 0, String(used));
await close();
