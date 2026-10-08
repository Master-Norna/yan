// 账本：目录下 .yan/账本.md 每一答开工时读一回，接在这一问之后（之前的问不带）；附着全文即算读过，主模型可径直改；下一问看到的是改后的那份
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(WORK + "/.yan", { recursive: true });
writeFileSync(WORK + "/.yan/账本.md", "# 目标\n- 分类准确率达标线 0.9\n# 约束\n- 只用 CPU\n");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
// 按问句认这段对话：上一个用例的页面离开时可能补写进来，第一段未必是它
const reply = n =>
  `((__yanState().conversations.find(c => c.messages[0]?.content === "LEDGER 开工")?.messages || []).filter(m => m.role === "assistant" && m.status === "complete")[${n}]?.content || "")`;
try {
  await evalJs(
    `document.querySelector("#welcomeInput").value = "LEDGER 开工"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
  );
  await waitFor(`${reply(0)}.startsWith("LEDGER|")`, 30000);
  const first = await evalJs(reply(0));
  check(
    "the ledger follows this question as its own part and the system prompt names it",
    /tail:yes\|once:yes\|sys:yes/.test(first),
    first
  );
  check("the main model edits the ledger without reading it first", first.includes("edit:yes"), first);
  check("the edit landed in the file", readFileSync(WORK + "/.yan/账本.md", "utf8").includes("达标线 0.95"));
  await evalJs(
    `document.querySelector("#chatInput").value = "接着"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
  );
  await waitFor(`${reply(1)}.startsWith("LEDGER|")`, 30000);
  const second = await evalJs(reply(1));
  check("next question carries the edited ledger, and only once", /tail:yes\|once:yes/.test(second) && second.includes("now:0.95"), second);

  // 记多少不设限，附多少随窗口：四百行的账本、两万窗口的模型，只附开头并写明共几行；截过的不算读过，不读就改被挡下
  writeFileSync(
    WORK + "/.yan/账本.md",
    ["# 目标 TOPMARK", ...Array.from({ length: 400 }, (_, i) => `- 第${i}条：实验记录良好，继续推进下一步`), "- 末条 TAILMARK"].join("\n")
  );
  await evalJs(
    `__yanState().profiles[0].contextWindow = 20000; document.querySelector("#newChat").click(); setTimeout(() => { document.querySelector("#welcomeInput").value = "LEDGERBIG 开工"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
  );
  const big = `__yanState().conversations.find(c => c.messages[0]?.content === "LEDGERBIG 开工")?.messages.at(-1)`;
  await waitFor(`${big}?.status === "complete"`, 30000);
  const cut = await evalJs(`${big}.content`);
  check(
    "a long ledger is kept whole on disk but only its head rides along, with the line count",
    cut === "LEDGERBIG|cut:yes|head:yes|tail:no|edit:no",
    cut
  );
  check("the cut ledger was not overwritten unread", readFileSync(WORK + "/.yan/账本.md", "utf8").includes("# 目标 TOPMARK\n"));
} finally {
  // 工作目录各用例共用：别让账本冠到后面用例的问上
  rmSync(WORK + "/.yan", { recursive: true, force: true });
}
close();
