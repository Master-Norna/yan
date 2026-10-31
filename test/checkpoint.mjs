// 检查点：一答动手改文件前记下目录，回复动作里的「退回」把写的、指令改的一并退回到开工前；确认窗列出要动哪几件；
// 退回之后的下一问开头注明退过；删了对话，它的检查点跟着清
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK, HOME } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(`${WORK}/ck`, { recursive: true });
writeFileSync(`${WORK}/ck/old.txt`, "原样");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const ask = (text, first = false) =>
  evalJs(
    first
      ? `(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); })(document.querySelector("#welcomeInput")); true`
      : `(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); })(document.querySelector("#chatInput")); true`
  );
const last = `[...document.querySelectorAll("#messages .message.assistant")].at(-1)`;
await ask("CHKPT 改一改", true);
await waitFor(`${last}?.dataset.status === "complete" && /CHKPT\\|done/.test(${last}.textContent)`, 30000);
check(
  "the answer wrote a new file and a command changed an old one",
  readFileSync(`${WORK}/ck/new.txt`, "utf8") === "新出的" && readFileSync(`${WORK}/ck/old.txt`, "utf8") === "改过"
);
check(
  "the answer carries a checkpoint and offers 退回",
  await evalJs(`!!__yanState().conversations[0].messages.at(-1).checkpoint && !!${last}.querySelector('[data-action="rewind"]')`)
);
// 退回：确认窗列出两件，点了才动
await evalJs(`${last}.querySelector('[data-action="rewind"]').click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`, 10000);
const body = await evalJs(`document.querySelector("#confirmBody").textContent`);
check("the confirm lists what will change", /改回　ck\/old\.txt/.test(body) && /删去　ck\/new\.txt/.test(body), body);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await waitFor(`!!__yanState().conversations[0].messages.at(-1).rewound`, 10000);
check(
  "rewinding undoes the written file and the command's change alike",
  !existsSync(`${WORK}/ck/new.txt`) && readFileSync(`${WORK}/ck/old.txt`, "utf8") === "原样"
);
// 下一问开头注明退过
await ask("CHKNOTE 接着");
await waitFor(`/CHKNOTE\\|/.test(${last}?.textContent || "") && ${last}.dataset.status === "complete"`, 30000);
check("the next question tells the model the files were rewound", /CHKNOTE\|note:true/.test(await evalJs(`${last}.textContent`)));
// 删了对话：检查点的册跟着清
const books = () => {
  const root = `${HOME}/检查点`;
  return existsSync(root) ? readdirSync(root, { recursive: true }).filter(name => /册[\\/].+\.json$/.test(name)).length : 0;
};
const before = books();
const id = await evalJs(`__yanState().conversations[0].id`);
await evalJs(
  `fetch("/api/chats/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ${JSON.stringify(id)} }) }).then(r => r.ok)`
);
await sleep(500);
check("deleting the conversation drops its checkpoints", before > 0 && books() === 0, `${before} → ${books()}`);
await close();
