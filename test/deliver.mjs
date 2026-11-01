// 行里的成品：答复里链到的工作目录文件挂在答末，点「预览」就地看；写了却没链的、链了却不存在的都不列
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { connect, check, PAGE, WORK } from "./lib.mjs";
rmSync(WORK + "/docs", { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
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
const stored = await evalJs(`JSON.stringify(__yanState().conversations[0].messages.at(-1).deliverables)`);
check(
  "only the linked file that exists becomes a deliverable, kept with its folder",
  stored === JSON.stringify([{ path: "docs/报告.md", name: "报告.md", size: 26, root: path.resolve(WORK) }]),
  stored
);
check(
  "the bar outside Files does not claim the file went into Files",
  (await evalJs(`document.querySelector(".message.assistant .deliver-head").textContent`)) === "成成品 1 件"
);
await evalJs(`document.querySelector('.message.assistant .deliver-bar [data-deliver-action="view"]').click(); true`);
await waitFor(`/结论在此/.test(document.querySelector("#fileViewerStage")?.textContent || "")`, 8000);
check(
  "preview reads the file from the working folder",
  (await evalJs(`document.querySelector("#fileViewerName").textContent`)) === "报告.md"
);
close();
