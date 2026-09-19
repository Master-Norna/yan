// 言里的 shell 同样不是进程隔离：首条非只读指令须确认；可只放行本答，下一答重新询问
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";

const ARCHIVE = `${TMP}/chat-command-archive`.split("/").join(process.platform === "win32" ? "\\" : "/");
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, archiveDir: ${JSON.stringify(ARCHIVE)} }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], memory: { enabled: true, items: [] }, drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(900);

await evalJs(
  `document.querySelector("#welcomeInput").value = "CHAT-AUTO"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`!document.querySelector("#approvalBar").classList.contains("hidden") && !!document.querySelector('#approvalBar [data-approve="auto"]')`);
check(
  "chat command asks through the local-computer approval bar",
  (await evalJs(`document.querySelector("#approvalBar .approval-title").textContent`)) === "本机请示 · 运行此指令"
);
check(
  "chat can only auto-approve the current answer",
  (await evalJs(`document.querySelector('#approvalBar [data-approve="auto"]').textContent`)) === "本答径行"
);
await evalJs(`document.querySelector('#approvalBar [data-approve="auto"]').click(); true`);
await waitFor(`document.querySelector('.message.assistant')?.dataset.status === "complete"`);
check(
  "the second command in the same answer ran without another prompt",
  await evalJs(`document.querySelectorAll('.tool-step[data-status="done"] .tool-label').length === 2 && document.querySelector("#approvalBar").classList.contains("hidden")`)
);
check("answer-scoped approval was not persisted on the conversation", !(await evalJs(`JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0].workAuto`)));

await evalJs(
  `document.querySelector("#chatInput").value = "CHAT-AUTO again"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(`!document.querySelector("#approvalBar").classList.contains("hidden") && !!document.querySelector('#approvalBar [data-approve="run"]')`);
check("the next answer asks again", (await evalJs(`document.querySelector("#approvalBar .approval-title").textContent`)) === "本机请示 · 运行此指令");
await evalJs(`document.querySelector('#approvalBar [data-approve="auto"]').click(); true`);
await waitFor(`document.querySelectorAll('.message.assistant').length === 2 && [...document.querySelectorAll('.message.assistant')].at(-1).dataset.status === "complete"`);

close();
