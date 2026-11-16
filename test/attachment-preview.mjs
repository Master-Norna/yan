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
// 纸先沉下去、底淡掉，淡完才藏起、清台面。等它收定再判：固定睡一小段，机器慢一点就抢在动画中间，白红一条（macOS 上撞过）
const closedAndFocused = `document.querySelector("#fileViewer").classList.contains("hidden") && !document.querySelector("#fileViewerStage").innerHTML && document.activeElement === document.querySelector(".message.user .attachment-card.sent[data-open-attachment]")`;
await waitFor(closedAndFocused, 3000).catch(() => {});
check("Esc closes the file preview and returns keyboard focus to its attachment", await evalJs(closedAndFocused));
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
// 案上的附件不必等发出：点开即看。PDF、音频走桥接的同源地址（页面 CSP 只许同源框架与媒体，blob: 会被挡），音频可拖进度（Range）
await evalJs(`document.querySelector("#newChat")?.click(); true`);
await sleep(400);
// 一份合法的单页 PDF：xref 里的偏移按字节算准，阅读器才肯打开
const pdfText = "BT /F1 28 Tf 30 50 Td (Yan PDF) Tj ET",
  pdfObjects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 240 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${pdfText.length}>>\nstream\n${pdfText}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"
  ];
let pdf = "%PDF-1.4\n";
const pdfOffsets = pdfObjects.map((body, index) => {
  const at = pdf.length;
  pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  return at;
});
const xref = pdf.length;
pdf += `xref\n0 ${pdfObjects.length + 1}\n0000000000 65535 f \n${pdfOffsets.map(at => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}`;
pdf += `trailer\n<</Size ${pdfObjects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
await evalJs(
  `(async () => {
    const wav = new Uint8Array(44 + 8000), v = new DataView(wav.buffer), w = (o, t) => [...t].forEach((c, i) => (wav[o + i] = c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + 8000, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, 8000, true);
    // 一秒的 webm：画布逐帧换色，就地录下
    const canvas = Object.assign(document.createElement("canvas"), { width: 320, height: 180 }), g = canvas.getContext("2d"),
      recorder = new MediaRecorder(canvas.captureStream(20), { mimeType: "video/webm" }), parts = [];
    let hue = 0;
    const paint = setInterval(() => { g.fillStyle = "hsl(" + (hue += 15) + ",45%,60%)"; g.fillRect(0, 0, 320, 180); }, 50);
    recorder.ondataavailable = e => parts.push(e.data);
    recorder.start();
    await new Promise(r => setTimeout(r, 1200));
    await new Promise(r => { recorder.onstop = r; recorder.stop(); });
    clearInterval(paint);
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(pdf)}], "讲义.pdf", { type: "application/pdf" }));
    dt.items.add(new File([wav], "一声.wav", { type: "audio/wav" }));
    dt.items.add(new File(parts, "一片.webm", { type: "video/webm" }));
    dt.items.add(new File(["not a video"], "坏片.mp4", { type: "video/mp4" }));
    window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`
);
await waitFor(`document.querySelectorAll("#welcomeAttachments .attachment-card[data-open-attachment]").length === 4`, 8000);
const openPending = name =>
  evalJs(
    `(() => { document.querySelector(${JSON.stringify(`#welcomeAttachments .attachment-card[data-name="${name}"]`)}).click(); return true; })()`
  );
await openPending("讲义.pdf");
await waitFor(`!!document.querySelector("#fileViewerStage iframe.file-viewer-frame")`, 8000);
await sleep(800);
await shot("attachment-pdf.png");
const pdfSrc = await evalJs(`document.querySelector("#fileViewerStage iframe").src`);
const pdfHead = await fetch(pdfSrc, { method: "HEAD" });
check(
  "a PDF still on the desk previews from a same-origin bridge address",
  pdfSrc.startsWith(PAGE + "api/files/raw?id=") && pdfHead.ok && pdfHead.headers.get("content-type") === "application/pdf",
  pdfSrc
);
await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
await openPending("一声.wav");
await waitFor(`document.querySelector("#listenAudio")?.readyState >= 1 && !!document.querySelector("#fileViewerStage .listen-page")`, 8000);
await sleep(500);
await shot("attachment-audio.png");
const audio = await evalJs(`(a => ({ src: a.src, duration: a.duration }))(document.querySelector("#listenAudio"))`);
check("audio opens as a listening page with its duration known", Math.abs(audio.duration - 1) < 0.05, JSON.stringify(audio));
const part = await fetch(audio.src, { headers: { Range: "bytes=0-3" } });
check(
  "media answers byte ranges so the player can seek",
  part.status === 206 && part.headers.get("content-range") === "bytes 0-3/8044" && (await part.text()) === "RIFF"
);
// 放着点空白：预览收起，声不断，顶栏垂下一根绳（一秒的样本太短，循环着放）
const gesture = expression => send("Runtime.evaluate", { expression, userGesture: true, awaitPromise: true });
await evalJs(`document.querySelector("#listenAudio").loop = true; true`);
await gesture(`document.querySelector('#fileViewerStage [data-listen-do="toggle"]').click()`);
await waitFor(`!document.querySelector("#listenAudio").paused`, 4000);
await evalJs(`document.querySelector("#fileViewerStage").click(); true`);
await waitFor(
  `document.querySelector("#fileViewer").classList.contains("hidden") && !document.querySelector("#listenPendant").classList.contains("hidden")`,
  3000
);
await sleep(300);
await shot("listen-rope.png");
check(
  "leaving the page by a blank click keeps playing and hangs the pendant",
  await evalJs(`!document.querySelector("#listenAudio").paused`)
);
await evalJs(
  `document.querySelector('#listenPendant [data-listen="rope"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); true`
);
await sleep(700);
await shot("listen-pendant.png");
check("the rope lowers the pendant", await evalJs(`document.querySelector("#listenPendant").classList.contains("open")`));
// 点题名回整页：玉佩收起，仍在放；× 才停
await evalJs(`document.querySelector('#listenPendant [data-listen="page"]').click(); true`);
await waitFor(`!!document.querySelector("#fileViewerStage .listen-page")`, 4000);
check(
  "the title returns to the page, still playing",
  await evalJs(`document.querySelector("#listenPendant").classList.contains("hidden") && !document.querySelector("#listenAudio").paused`)
);
await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
await sleep(200);
check(
  "× stops it and nothing hangs",
  await evalJs(
    `document.querySelector("#listenAudio").paused && !document.querySelector("#listenAudio").getAttribute("src") && document.querySelector("#listenPendant").classList.contains("hidden")`
  )
);
// 没放就离开：不挂
await openPending("一声.wav");
await waitFor(`!!document.querySelector("#fileViewerStage .listen-page")`, 8000);
await evalJs(`document.querySelector("#fileViewerStage").click(); true`);
await sleep(200);
check("leaving without playing hangs nothing", await evalJs(`document.querySelector("#listenPendant").classList.contains("hidden")`));
await openPending("一片.webm");
await waitFor(`document.querySelector("#fileViewerStage video")?.readyState >= 1`, 8000);
await evalJs(`document.querySelector("#fileViewerStage video").currentTime = 0.5; true`);
await sleep(500);
await shot("attachment-video.png");
check("video plays in place at its own size", await evalJs(`document.querySelector("#fileViewerStage video").videoWidth === 320`));
await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
await openPending("坏片.mp4");
await waitFor(
  `!!document.querySelector("#fileViewerStage [data-viewer-download]") || !!document.querySelector("#fileViewerStage video")?.error`,
  8000
);
await sleep(300);
check(
  "a video the browser cannot decode turns into open-locally and download",
  await evalJs(
    `!document.querySelector("#fileViewerStage video") && document.querySelector("#fileViewerStage").textContent.includes("浏览器放不了") && !!document.querySelector("#fileViewerStage [data-viewer-open]")`
  )
);
await close();
