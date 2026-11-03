// 行里的成品：答复里链到的工作目录文件挂在答末，点「预览」就地看；写了却没链的、链了却不存在的都不列。
// 图片的件图照它自己的根取；预览里 Markdown 的相对链接照那份文件所在的那一层开
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connect, check, PAGE, WORK } from "./lib.mjs";
rmSync(WORK + "/docs", { recursive: true, force: true });
mkdirSync(WORK + "/docs/附", { recursive: true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
writeFileSync(WORK + "/docs/图.png", PNG);
writeFileSync(WORK + "/docs/附/下篇.md", "# 下篇\n\n下篇正文。\n");
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await waitFor(`document.readyState === "complete"`);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", commandPolicy: "auto", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector("#welcome:not(.hidden)")`);
await evalJs(
  `document.querySelector("#welcomeInput").value = "DELIVER 写份报告"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`, 20000);
await waitFor(`!!document.querySelector(".message.assistant .deliver-bar")`, 5000);
await shot("deliver-work.png");
const stored = await evalJs(`JSON.stringify(__yanState().conversations[0].messages.at(-1).deliverables)`),
  root = path.resolve(WORK),
  report = Buffer.byteLength("# 报告\n\n结论在此，另见[下篇](附/下篇.md)。\n");
check(
  "only the linked files that exist become deliverables, kept with their folder",
  stored ===
    JSON.stringify([
      { path: "docs/报告.md", name: "报告.md", size: report, root },
      { path: "docs/图.png", name: "图.png", size: PNG.length, root }
    ]),
  stored
);
check(
  "the bar outside Files does not claim the file went into Files",
  (await evalJs(`document.querySelector(".message.assistant .deliver-head").textContent`)) === "成成品 2 件"
);
check(
  "an image deliverable's thumbnail is read from its own folder",
  await waitFor(`document.querySelector(".message.assistant .deliver-bar .fi-thumb img")?.naturalWidth > 0`, 5000).then(
    () => true,
    () => false
  )
);
await evalJs(`document.querySelector('.message.assistant .deliver-bar [data-deliver-action="view"]').click(); true`);
await waitFor(`/结论在此/.test(document.querySelector("#fileViewerStage")?.textContent || "")`, 8000);
check(
  "preview reads the file from the working folder",
  (await evalJs(`document.querySelector("#fileViewerName").textContent`)) === "报告.md"
);
await evalJs(`document.querySelector("#fileViewerStage a[data-file]").click(); true`);
check(
  "a relative link inside the previewed Markdown opens beside that file",
  await waitFor(`/下篇正文/.test(document.querySelector("#fileViewerStage")?.textContent || "")`, 8000).then(
    () => true,
    () => false
  )
);
close();
