// 问而后行里的沙箱：严的沙箱会拦下的指令不直接拒，转成请示并写明原因；用户批了这一条就出沙箱跑
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const probe = path.join(WORK, "..", "escalate-probe.txt");
rmSync(probe, { force: true });
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "ask" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(
  `document.querySelector("#welcomeInput").value = "ESCALATE 写到上一级"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`!!document.querySelector("#approvalBar:not(.hidden) .approval-sandbox")`, 15000);
const why = await evalJs(`document.querySelector("#approvalBar .approval-sandbox").textContent`);
check("the approval bar says the sandbox would stop it and why", /沙箱会拦下：.*\.\. 上溯/.test(why) && /沙箱外/.test(why), why);
await shot("sandbox-escalate.png");
await evalJs(`document.querySelector('#approvalBar [data-approve="run"]').click(); true`);
await waitFor(`[...document.querySelectorAll(".message.assistant")].at(-1)?.dataset.status === "complete"`, 20000);
const done = await evalJs(
  `(a => ({ text: a.querySelector(".markdown")?.textContent.trim(), meta: a.querySelector('.tool-step[data-tool="run_command"] .tool-meta, .tool-step .tool-meta')?.textContent }))([...document.querySelectorAll(".message.assistant")].at(-1))`
);
check(
  "approved, it runs outside the sandbox and the step says so",
  existsSync(probe) && readFileSync(probe, "utf8").trim() === "ok" && /wrote/.test(done.text) && /出沙箱/.test(done.meta || ""),
  JSON.stringify(done)
);
rmSync(probe, { force: true });
close();
