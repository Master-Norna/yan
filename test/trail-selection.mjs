// 行迹里的过程话、思绪与工具输出也能划选引用、起旁注；同文的正文不能抢走落点。
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const note = "我先看一下重复片段是从哪里进来的，确认是读取了两次，还是显示时重复拼上了。\n\n",
  thought = "先沿着测试词查一下调用顺序，再看渲染时有没有重复追加。",
  content = note + "看过了，重复片段不是读了两遍，是显示时又追加了一次。可以先从这处入手，其他流程暂时不用动。";
await fetch(PAGE + "api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: "trail-selection",
      title: "排查重复显示",
      createdAt: "2026-10-26",
      updatedAt: new Date().toISOString(),
      workdir: WORK,
      forks: [],
      threads: [],
      messages: [
        { id: "u", role: "user", content: "帮我看看这段处理流程，为什么重复片段会出现两次？", timestamp: "2026-10-26" },
        {
          id: "a",
          role: "assistant",
          content,
          reasoning: thought,
          reasoningTouched: true,
          reasoningOpen: true,
          status: "complete",
          work: true,
          toolsTouched: true,
          toolsOpen: true,
          timestamp: "2026-10-26",
          steps: [
            {
              id: "read",
              name: "read_file",
              arguments: '{"path":"sample.txt"}',
              title: "sample.txt",
              status: "done",
              at: note.length,
              rat: thought.length,
              expanded: true,
              output: "测试结果：读取调用 1 次，页面追加 2 次。",
              result: "1 行"
            }
          ]
        }
      ]
    }
  })
});
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="trail-selection"]')`);
await evalJs(`document.querySelector('[data-conversation="trail-selection"] .history-open').click(); true`);
await waitFor(`!!document.querySelector('#messages .trail-note p')`);
await sleep(600);
const select = async (selector, text) => {
  await evalJs(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center", behavior: "instant" }); true`);
  await sleep(150); // 滚动会收起浮条，先等它落稳，再像人停下来划选一样取文字。
  await evalJs(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while (n = w.nextNode()) { const at = n.data.indexOf(${JSON.stringify(text)}); if (at < 0) continue; const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + ${text.length}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); break; } return true; })()`
  );
  await sleep(250);
  return await evalJs(`!document.querySelector('#quoteTip').classList.contains('hidden')`);
};
const quoted = await select("#messages .trail-note p", "重复片段");
check("trail selection offers quote and side note", quoted);
await shot("trail-selection.png");
if (quoted) {
  await evalJs(`document.querySelector('#quoteTip [data-tip="quote"]').click(); true`);
  check(
    "trail quote reaches composer",
    await evalJs(`document.querySelector('#composerQuote .composer-quote-text').textContent === '重复片段'`)
  );
}
const noted = await select("#messages .trail-note p", "重复片段");
check("trail selection can start a side note", noted);
if (noted) {
  await evalJs(`document.querySelector('#quoteTip [data-tip="note"]').click(); true`);
  await sleep(250);
  check(
    "side note uses trail excerpt",
    await evalJs(
      `!document.querySelector('#sidePanel').classList.contains('hidden') && document.querySelector('#sideAnchor').textContent === '重复片段'`
    )
  );
  check(
    "anchor stays in trail, not matching final reply",
    await evalJs(
      `document.querySelectorAll('#messages .tool-stack-body mark.note-anchor').length > 0 && [...document.querySelectorAll('#messages .markdown mark.note-anchor')].every(mark => mark.closest('.tool-stack-body'))`
    )
  );
  await send("Page.reload");
  await sleep(1000);
  await waitFor(`!!document.querySelector('#messages .tool-stack-body mark.note-anchor')`);
  check(
    "trail anchor survives reload",
    await evalJs(`document.querySelector('#messages .tool-stack-body mark.note-anchor').textContent === '重复片段'`)
  );
  await evalJs(`document.querySelector('#messages .tool-stack-body mark.note-anchor').click(); true`);
  await sleep(250);
  check(
    "trail anchor reopens its side note",
    await evalJs(
      `document.querySelector('#sideAnchor').textContent === '重复片段' && !document.querySelector('#sidePanel').classList.contains('hidden')`
    )
  );
  await evalJs(`document.querySelector('#sideClose').click(); true`);
}
await evalJs(`document.querySelector('#messages .trail-reasoning').open = true; true`);
await sleep(300);
check("trail reasoning can be quoted", await select("#messages .reasoning-body", "测试词"));
check("tool output can be quoted", await select("#messages .tool-output", "测试结果"));
check("trail heading is not a quote body", !(await select("#messages .tool-stack > summary", "行迹")));
check("final reply selection still works", await select("#messages .assistant-block .markdown", "重复片段"));
close();
