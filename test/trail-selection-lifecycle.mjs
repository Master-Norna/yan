// 审阅回归：目录另起旁注、流式尾段收尾、前一步展开后定位、工具输出重画。
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(WORK + "/src", { recursive: true });
writeFileSync(WORK + "/src/a.js", "export const value = 1;\n");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
const first = "先读取文件。\n\n",
  later = "目录片段在这里，重复片段也在这一步核对。\n\n",
  output = ["输出首行需要核对。", ...Array.from({ length: 9 }, (_, i) => `第 ${i + 2} 行`), "重复片段藏在第十一行。", "最后一行。"].join(
    "\n"
  ),
  process = `#messages .trail-group[data-at="${first.length + later.length}"] .trail-note`,
  step = '#messages .tool-step[data-step-id="first-read"]';
await fetch(PAGE + "api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: "trail-lifecycle",
      title: "旁注落点生命周期",
      createdAt: "2026-10-26",
      updatedAt: new Date().toISOString(),
      workdir: WORK,
      profileId: "p1",
      forks: [],
      threads: [],
      messages: [
        { id: "question", role: "user", content: "核对两步输出。", timestamp: "2026-10-26" },
        {
          id: "answer",
          role: "assistant",
          content: first + later + "正文再次提到目录片段。",
          status: "complete",
          work: true,
          toolsTouched: true,
          toolsOpen: true,
          timestamp: "2026-10-26",
          steps: [
            {
              id: "first-read",
              name: "read_file",
              arguments: '{"path":"first.txt"}',
              title: "first.txt",
              status: "done",
              at: first.length,
              rat: 0,
              expanded: true,
              output,
              result: "12 行"
            },
            {
              id: "second-read",
              name: "read_file",
              arguments: '{"path":"second.txt"}',
              title: "second.txt",
              status: "done",
              at: first.length + later.length,
              rat: 0,
              expanded: true,
              output: "后一步输出。",
              result: "1 行"
            }
          ]
        }
      ]
    }
  })
});
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="trail-lifecycle"]')`);
await evalJs(`document.querySelector('[data-conversation="trail-lifecycle"] .history-open').click(); true`);
await waitFor(`!!document.querySelector(${JSON.stringify(process)})`);
await sleep(400);
const select = async (selector, text, streaming = false) => {
  await evalJs(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center", behavior: "instant" }); true`);
  if (!streaming) await sleep(150);
  await evalJs(
    `(() => { const body = document.querySelector(${JSON.stringify(selector)}), w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); let n; while (n = w.nextNode()) { const at = n.data.indexOf(${JSON.stringify(text)}); if (at < 0) continue; const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + ${text.length}); getSelection().removeAllRanges(); getSelection().addRange(r); return true; } return false; })()`
  );
  await waitFor(`!document.querySelector('#quoteTip').classList.contains('hidden')`, 3000);
};
const noteSelection = async () => {
  await evalJs(`document.querySelector('#quoteTip [data-tip="note"]').click(); true`);
  await sleep(200);
};
const closeSide = async () => {
  await evalJs(`document.querySelector('#sideClose').click(); true`);
  await sleep(100);
};
const hasMark = (selector, text) =>
  `!![...document.querySelectorAll(${JSON.stringify(selector + " mark.note-anchor")})].find(n => n.textContent === ${JSON.stringify(text)})`;

// 正常目录入口也必须保留来源；最终正文故意包含同文。
await evalJs(`document.querySelector('#messages [data-action="note"]').click(); true`);
await select(process, "目录片段");
await evalJs(`document.querySelector('#sideMessages [data-side-new]').click(); true`);
await sleep(200);
check("index + keeps the trail location instead of final body", await evalJs(hasMark(process, "目录片段")));
await closeSide();

// 第一份输出的同文原先不在 DOM 中，展开它不应改变后一步旁注的身份。
check(
  "earlier matching output starts clipped",
  !(await evalJs(`document.querySelector(${JSON.stringify(step + " .tool-output")}).textContent.includes('重复片段')`))
);
await select(process, "重复片段");
await noteSelection();
await evalJs(`document.querySelector(${JSON.stringify(step + " [data-step-more]")}).click(); true`);
await waitFor(`document.querySelector(${JSON.stringify(step + " .tool-output")}).textContent.includes('重复片段')`);
await sleep(1200);
await send("Page.reload");
await sleep(1200);
await waitFor(`!!document.querySelector(${JSON.stringify(process)})`);
check("later process anchor survives earlier output expansion and reload", await evalJs(hasMark(process, "重复片段")));
check("earlier output does not steal the later anchor", !(await evalJs(hasMark(step + " .tool-output", "重复片段"))));

// 本轮输出全文 -> 前十行 -> 全文，首行始终可见，标记和激活态也应始终存在。
await select(step + " .tool-output", "输出首行");
await noteSelection();
check(
  "tool output note is initially active",
  await evalJs(`!!document.querySelector(${JSON.stringify(step + " .tool-output mark.note-anchor.active")})`)
);
for (const mode of ["clipped", "full"]) {
  await evalJs(`document.querySelector(${JSON.stringify(step + " [data-step-more]")}).click(); true`);
  await sleep(450);
  check(
    `tool output ${mode} repaint keeps its active note`,
    await evalJs(`!!document.querySelector(${JSON.stringify(step + " .tool-output mark.note-anchor.active")})`)
  );
}
await closeSide();

// 使用既有慢流式模型，真实经过尾段从行迹移到最终正文的生命周期。
await evalJs(`document.querySelector('#newChat').click(); true`);
await sleep(200);
await evalJs(
  `document.querySelector('#welcomeInput').value = 'DUPTAIL'; document.querySelector('#welcomeInput').dispatchEvent(new Event('input')); document.querySelector('#welcome .send-trigger').click(); true`
);
await waitFor(`document.querySelector('#messages .trail-live .markdown')?.textContent.includes('尾段第1句')`, 10000);
await select("#messages .trail-live .markdown", "尾段第1句", true);
await noteSelection();
await waitFor(`document.querySelector('#messages .message.assistant')?.dataset.status === 'complete'`, 10000);
check(
  "streaming tail note moves to final body on completion",
  await evalJs(hasMark("#messages .assistant-block > .markdown", "尾段第1句"))
);
await sleep(500);
await send("Page.reload");
await sleep(1200);
await waitFor(`!!document.querySelector('#messages .assistant-block > .markdown')`);
check("streaming tail note stays in final body after reload", await evalJs(hasMark("#messages .assistant-block > .markdown", "尾段第1句")));
close();
