// 对话里发出去的附件：点开是看，不是下载——CSV 进预览器成表，Esc 关得掉；预览不了的（压缩包）才落到下载
import { existsSync, readFileSync } from "node:fs";
import { connect, check, sleep, PAGE, HOME } from "./lib.mjs";
const FILES = `${HOME}/附件`;
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
// 原件与对话一起落在存储根的 附件/：一个原件、一份元数据；浏览器的 IndexedDB 里不留
const [csvId, zipId] = await evalJs(`__yanState().conversations[0].messages[0].attachments.map(a => a.id)`);
check(
  "attachment originals are written into the storage root, not the browser",
  existsSync(`${FILES}/${csvId}.csv`) &&
    readFileSync(`${FILES}/${csvId}.csv`, "utf8") === "a,b\n1,2\n3,4" &&
    JSON.parse(readFileSync(`${FILES}/${csvId}.json`, "utf8")).name === "报表.csv" &&
    existsSync(`${FILES}/${zipId}.zip`)
);
const idbKeys = `new Promise(r => { const q = indexedDB.open("yan-chat-files-v1", 1); q.onupgradeneeded = () => q.result.createObjectStore("attachments", { keyPath: "id" }); q.onsuccess = () => { const g = q.result.transaction("attachments", "readonly").objectStore("attachments").getAllKeys(); g.onsuccess = () => { q.result.close(); r(g.result); }; }; })`;
check("nothing of it is kept in IndexedDB", (await evalJs(idbKeys)).length === 0);
// 旧版留在浏览器里的原件：接上桥接、对话读全后推进 附件/，表里的清掉
await evalJs(
  `new Promise(r => { const q = indexedDB.open("yan-chat-files-v1", 1); q.onsuccess = () => { const t = q.result.transaction("attachments", "readwrite"); t.objectStore("attachments").put({ id: "legacy-att-1", kind: "text", name: "旧件.txt", mime: "text/plain", size: 9, data: "旧件之文" }); t.oncomplete = () => { q.result.close(); r(true); }; }; })`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector(".history [data-conversation]")`, 8000);
await waitFor(`${idbKeys}.then(keys => keys.length === 0)`, 8000);
check(
  "a legacy original left in IndexedDB moves into the storage root after reconnecting",
  existsSync(`${FILES}/legacy-att-1.txt`) && readFileSync(`${FILES}/legacy-att-1.txt`, "utf8") === "旧件之文"
);
check(
  "after a reload the sent csv still previews, read back from the storage root",
  await evalJs(
    `(async () => { document.querySelector(".history [data-conversation]").click(); await new Promise(r => setTimeout(r, 400)); document.querySelector(".message.user .attachment-card.sent[data-open-attachment]").click(); for (let i = 0; i < 40 && !document.querySelector("#fileViewerStage .file-viewer-table td"); i++) await new Promise(r => setTimeout(r, 150)); return document.querySelectorAll("#fileViewerStage .file-viewer-table td").length === 4; })()`
  )
);
await close();
