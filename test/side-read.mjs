// 旁注能读的都读、只是不改：绑了目录的对话里，旁注读得了文件、搜得了目录、跑得了只读的指令；会写的指令、POST 回绝，
// 不请示、不留检查点，目录里也没多出东西
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(WORK, { recursive: true });
writeFileSync(`${WORK}/note.txt`, "旁注可读的一行");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "ask" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const last = `[...document.querySelectorAll("#messages .message.assistant")].at(-1)`;
await evalJs(
  `document.querySelector("#welcomeInput").value = "CHKNOTE 起头"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`${last}?.dataset.status === "complete"`, 30000);
await evalJs(`${last}.querySelector('[data-action="note"]').click(); true`);
await waitFor(`!!document.querySelector("#sideMessages [data-side-new]")`, 5000);
await evalJs(`getSelection().removeAllRanges(); document.querySelector("#sideMessages [data-side-new]").click(); true`);
await waitFor(`!!document.querySelector(".side-empty")`, 5000);
await evalJs(`document.querySelector("#sideInput").value = "SIDEREAD 看看"; document.querySelector("#sideSend").click(); true`);
await waitFor(`[...document.querySelectorAll('#sideMessages .message.assistant')].at(-1)?.dataset.status === "complete"`, 60000);
const side = await evalJs(`[...document.querySelectorAll('#sideMessages .message.assistant .markdown')].at(-1).textContent.trim()`);
check(
  "a side note in a work chat gets the read tools, none of the writing ones",
  /tools:read_file\+list_files\+search_files\+run_command\|/.test(side),
  side.slice(0, 200)
);
check("it reads a file in the folder", /旁注可读的一行/.test(side), side.slice(0, 400));
check("it runs a read-only command", /退出码：0/.test(side.split("▸")[1] || ""), side.slice(0, 400));
check(
  "a writing command is refused, not asked",
  /旁注只查不改：这条指令不算只读/.test(side) && !existsSync(`${WORK}/side.txt`),
  side.slice(0, 400)
);
check("a POST is refused", /POST 不调，只许 GET、HEAD/.test(side), side.slice(0, 400));
check("it searches the folder", /note\.txt:1/.test(side), side.slice(0, 500));
check(
  "nothing asked for approval and no checkpoint was taken for the side note",
  await evalJs(
    `document.querySelector("#approvalBar").classList.contains("hidden") && !__yanState().conversations[0].threads.some(th => th.messages.some(m => m.checkpoint))`
  )
);
await close();
