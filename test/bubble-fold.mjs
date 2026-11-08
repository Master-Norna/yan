// 长问句只露四行、末行淡出，右下折角「展开 / 收起」（设计稿/151 乙）；短问句不动；旁注落在截掉的那段里，回到所注处先摊开
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const long = Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行：这一问写得很长，要看收起之后只露四行。`).join("\n");
await fetch(PAGE + "api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: "bubble-fold",
      title: "问句收起",
      createdAt: "2026-11-08",
      updatedAt: new Date().toISOString(),
      workdir: WORK,
      forks: [],
      threads: [
        {
          id: "th1",
          anchor: { messageId: "u1", text: "第 11 行", occurrence: 0, part: 0 },
          createdAt: "2026-11-08",
          updatedAt: "2026-11-08",
          messages: []
        }
      ],
      messages: [
        { id: "u1", role: "user", content: long, timestamp: "2026-11-08" },
        { id: "a1", role: "assistant", content: "收到。", status: "complete", timestamp: "2026-11-08" },
        { id: "u2", role: "user", content: "短问句。", timestamp: "2026-11-08" },
        { id: "a2", role: "assistant", content: "好。", status: "complete", timestamp: "2026-11-08" }
      ]
    }
  })
});
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="bubble-fold"]')`, 10000);
await evalJs(`document.querySelector('[data-conversation="bubble-fold"] .history-open').click(); true`);
await waitFor(`!!document.querySelector('[data-message="u1"] .user-bubble.more')`, 8000).catch(() => {});
const bubble = `document.querySelector('[data-message="u1"] .user-bubble')`;
const state = () =>
  evalJs(
    `(b => ({ more: b.classList.contains("more"), open: b.classList.contains("open"), lines: Math.round(b.querySelector(".ub-text").clientHeight / parseFloat(getComputedStyle(b.querySelector(".ub-text")).lineHeight)), fold: b.querySelector(".ub-fold")?.textContent || "" }))(${bubble})`
  );
let s = await state();
check("a long question shows four lines and offers to expand", s.more && !s.open && s.lines === 4 && s.fold === "展开", JSON.stringify(s));
check(
  "a short question is left as is",
  await evalJs(
    `(b => !b.classList.contains("more") && !b.querySelector(".ub-fold"))(document.querySelector('[data-message="u2"] .user-bubble'))`
  )
);
check(
  "the fold mark is not part of the text (copy, notes, quotes)",
  // 旁注的小标（sup）是落点的记号，不算
  await evalJs(
    `(t => (t.querySelectorAll("sup.note-ref").forEach(n => n.remove()), t.textContent === ${JSON.stringify(long)}))(${bubble}.querySelector(".ub-text").cloneNode(true))`
  )
);
await sleep(800);
await shot("bubble-fold.png");
await evalJs(`${bubble}.querySelector(".ub-fold").click(); true`);
await sleep(600);
s = await state();
check("its mark opens it in full and turns to collapse", s.open && s.lines === 12 && s.fold === "收起", JSON.stringify(s));
await shot("bubble-fold-open.png");
await evalJs(`${bubble}.querySelector(".ub-fold").click(); true`);
await sleep(600);
s = await state();
check("collapsing brings it back to four lines", !s.open && s.lines === 4 && s.fold === "展开", JSON.stringify(s));
await evalJs(`${bubble}.querySelector(".ub-text").click(); true`);
await sleep(600);
check("clicking a folded question itself opens it", (await state()).open);
await evalJs(`${bubble}.querySelector(".ub-fold").click(); true`);
await sleep(600);
// 旁注落在截掉的第 11 行：从旁注面板回到所注处，先摊开
await evalJs(`document.querySelector('[data-message="u1"] .note-mark').click(); true`);
await waitFor(`!document.querySelector("#sidePanel").classList.contains("hidden")`, 5000).catch(() => {});
await evalJs(`document.querySelector("#sideAnchor").click(); true`);
await sleep(600);
check("going back to a note anchored in the hidden lines opens the question", (await state()).open);
close();
