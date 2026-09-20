// 对话里发出去的附件：点开是看，不是下载——CSV 进预览器成表，Esc 关得掉；预览不了的（压缩包）才落到下载
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
// 拖两件到案上：一张表、一个压缩包
await evalJs(
  `(() => { const dt = new DataTransfer(); dt.items.add(new File(["a,b\\n1,2\\n3,4"], "报表.csv", { type: "text/csv" })); dt.items.add(new File(["x"], "包.zip", { type: "application/zip" })); window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt })); })(); true`
);
await waitFor(`document.querySelectorAll("#welcomeAttachments .attachment-card").length === 2`, 5000);
await evalJs(
  `document.querySelector("#welcomeInput").value = "PLAIN 看附件"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`, 15000);
check(
  "sent csv opens as preview, sent zip still downloads",
  await evalJs(
    `(c => c[0]?.dataset.openAttachment && c[0].title.startsWith("预览") && c[1]?.dataset.downloadAttachment && c[1].title.startsWith("下载"))([...document.querySelectorAll(".message.user .attachment-card.sent")])`
  )
);
await evalJs(
  `(() => { const card = document.querySelector(".message.user .attachment-card.sent[data-open-attachment]"); card.focus(); card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })(); true`
);
await waitFor(`!!document.querySelector("#fileViewerStage .file-viewer-table td")`, 8000);
await shot("attachment-preview.png");
check(
  "the csv from the browser store shows as a table with its own name",
  (await evalJs(
    `document.querySelector("#fileViewerName").textContent + "|" + [...document.querySelectorAll("#fileViewerStage .file-viewer-table th")].map(n => n.textContent).join(",") + "|" + document.querySelectorAll("#fileViewerStage .file-viewer-table td").length`
  )) === "报表.csv|a,b|4"
);
await evalJs(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
await sleep(100);
check(
  "Esc closes the file preview and returns keyboard focus to its attachment",
  await evalJs(
    `document.querySelector("#fileViewer").classList.contains("hidden") && !document.querySelector("#fileViewerStage").innerHTML && document.activeElement === document.querySelector(".message.user .attachment-card.sent[data-open-attachment]")`
  )
);
await close();
