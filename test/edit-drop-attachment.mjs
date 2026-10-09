// 改问时可以摘掉附件：模型吃不下的图一报错，改问把它去掉再问，对话就能接着走；旧版本里原样留着
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
await evalJs(
  `(() => { const bin = atob("${PNG}"), bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], "截图.png", { type: "image/png" })); dt.items.add(new File(["a,b\\n1,2"], "表.csv", { type: "text/csv" })); window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt })); })(); true`
);
await waitFor(`document.querySelectorAll("#welcomeAttachments .attachment-card").length === 2`, 5000);
await evalJs(
  `document.querySelector("#welcomeInput").value = "IMGCOUNT 看图"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
const lastDone = `[...document.querySelectorAll(".message.assistant")].at(-1)?.dataset.status === "complete"`;
await waitFor(lastDone, 15000);
check(
  "the first ask carries the image",
  (await evalJs(`[...document.querySelectorAll(".message.assistant")].at(-1).textContent`)).includes("IMGCOUNT|1")
);

// 改问：附件随编辑框摆出来，各带 ×
await evalJs(`document.querySelector('.message.user [data-action="edit"]').click(); true`);
await waitFor(`!!document.querySelector(".message-edit-input")`, 3000);
check(
  "the editor lists the attachments with a remove button each",
  await evalJs(`document.querySelectorAll('.message.user [data-action="drop-attachment"]').length === 2`)
);
// 先改字、再摘图：改到一半的字不能被冲掉，点 × 也不该打开图片查看器
await evalJs(`document.querySelector(".message-edit-input").value = "IMGCOUNT 不看图了"; true`);
await evalJs(`document.querySelector('.message.user .attachment-card[data-kind="image"] [data-action="drop-attachment"]').click(); true`);
await sleep(150);
check(
  "removing the image keeps the typed text and does not open the viewer",
  await evalJs(
    `document.querySelector(".message-edit-input").value === "IMGCOUNT 不看图了" && document.querySelectorAll(".message.user .attachment-card").length === 1 && document.querySelector("#imageViewer").classList.contains("hidden")`
  )
);
await shot("edit-drop-attachment.png");
await evalJs(`document.querySelector('[data-action="save-edit"]').click(); true`);
await sleep(300);
await waitFor(lastDone, 15000);
check(
  "the re-ask goes out without the image",
  (await evalJs(`[...document.querySelectorAll(".message.assistant")].at(-1).textContent`)).includes("IMGCOUNT|0")
);
check(
  "the new ask keeps only the csv, the old version still holds the image",
  await evalJs(
    `(c => c.messages[0].attachments.map(a => a.name).join() === "表.csv" && JSON.stringify(c.forks || {}).includes("截图.png"))(__yanState().conversations[0])`
  )
);

// 字不改、只摘附件：也算改过，照样重答
await evalJs(`document.querySelector('.message.user [data-action="edit"]').click(); true`);
await waitFor(`!!document.querySelector('.message.user [data-action="drop-attachment"]')`, 3000);
await evalJs(
  `document.querySelector('.message.user [data-action="drop-attachment"]').click(); document.querySelector('[data-action="save-edit"]').click(); true`
);
await sleep(300);
await waitFor(lastDone, 15000);
check(
  "dropping an attachment alone still re-asks",
  await evalJs(`(c => !c.messages[0].attachments.length && c.messages[0].content === "IMGCOUNT 不看图了")(__yanState().conversations[0])`)
);
await close();
