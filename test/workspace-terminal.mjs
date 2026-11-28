// 工作区的键盘与终端：临时页签 Shift+Enter 固定、终端分批领取完整输出、两路输出按到达先后显示。
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, ARCHIVE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();

const ROOT = `${ARCHIVE}/终端键位`;
mkdirSync(ROOT, { recursive: true });
writeFileSync(`${ROOT}/a.txt`, "一页字\n");
await fetch(PAGE + "api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: "terminal-keys",
      title: "终端键位",
      createdAt: "2026-11-28",
      updatedAt: new Date().toISOString(),
      workdir: ROOT,
      forks: [],
      threads: [],
      messages: [{ id: "u", role: "user", content: "开工。", timestamp: "2026-11-28" }]
    }
  })
});

await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="terminal-keys"]')`, 10000);
await evalJs(`document.querySelector('[data-conversation="terminal-keys"] .history-open').click(); true`);
await waitFor(`__yanState().conversations.length === 1`, 8000).catch(() => {});
await sleep(200);
await evalJs(`document.querySelector("#stagePin").click(); true`);
await sleep(300);
await evalJs(`document.querySelector("#stageWorkBtn").click(); true`);
await waitFor(`document.querySelector("#workCrumbs .here")?.title === ${JSON.stringify(ROOT)}`, 8000).catch(() => {});
await waitFor(`!!document.querySelector('[data-work-file$="/a.txt"]')`, 8000).catch(() => {});
await evalJs(`document.querySelector('[data-work-file$="/a.txt"]').click(); true`);
await waitFor(`!!document.querySelector("#workTabs .work-tab-preview")`, 8000);
await evalJs(`document.querySelector('#workTabs [data-work-tab]').focus(); true`);
// 真实按键：Enter 只选签，Shift+Enter 才固定（与双击同一条路）
await send("Input.dispatchKeyEvent", {
  type: "keyDown",
  modifiers: 8,
  key: "Enter",
  code: "Enter",
  windowsVirtualKeyCode: 13,
  nativeVirtualKeyCode: 13
});
await send("Input.dispatchKeyEvent", {
  type: "keyUp",
  modifiers: 8,
  key: "Enter",
  code: "Enter",
  windowsVirtualKeyCode: 13,
  nativeVirtualKeyCode: 13
});
await waitFor(`!document.querySelector("#workTabs .work-tab-preview")`, 5000).catch(() => {});
check("Shift+Enter 固定临时页签", await evalJs(`!document.querySelector("#workTabs .work-tab-preview")`));

await evalJs(`document.querySelector('.work-rail [data-work-terminal]').click(); true`);
await waitFor(
  `!document.querySelector("#workTerminal").classList.contains("hidden") && document.querySelector("#workTerminal").clientHeight > 80`
);
const run = async command => {
  await evalJs(
    `(() => { const f = document.querySelector("#workCommand"); f.querySelector("input").value = ${JSON.stringify(command)}; f.requestSubmit(); return true; })()`
  );
};
await run(`node -e "process.stdout.write('x'.repeat(26010))"`);
await waitFor(
  `!document.querySelector("#workCommand input").readOnly && document.querySelector("#workTerminalOutput").textContent.includes("退出码：0")`,
  30000
).catch(() => {});
const output = await evalJs(`document.querySelector("#workTerminalOutput").textContent`);
check(
  "终端分批领取也能拿到完整输出",
  output.includes("x".repeat(26010)) && output.includes("退出码：0"),
  JSON.stringify({ length: output.length, head: output.slice(0, 60) })
);

await evalJs(`document.querySelector("[data-work-clear]").click(); true`);
await run(
  `node -e "process.stderr.write('ERR1\\n');setTimeout(()=>process.stdout.write('OUT2\\n'),80);setTimeout(()=>process.stderr.write('ERR3\\n'),160)"`
);
await waitFor(
  `!document.querySelector("#workCommand input").readOnly && document.querySelector("#workTerminalOutput").textContent.includes("退出码：0")`,
  30000
).catch(() => {});
const ordered = await evalJs(`document.querySelector("#workTerminalOutput").textContent`);
const at = ["ERR1", "OUT2", "ERR3"].map(mark => ordered.indexOf(mark));
check("终端按到达先后显示两路输出", at.every(index => index >= 0) && at[0] < at[1] && at[1] < at[2], JSON.stringify({ at }));

await close();
