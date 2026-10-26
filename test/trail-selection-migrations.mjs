// 文字在行迹、末轮思绪、最终正文之间换位置：同文、跨段、收尾对照、继续工具与停止。
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
mkdirSync(WORK + "/src", { recursive: true });
writeFileSync(WORK + "/src/a.js", "export const value = 1;\n");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(
  `location.pathname === '/' && !!document.documentElement && !document.documentElement.hasAttribute('data-booting') && !!document.querySelector('#welcomeInput')`
);
const start = async command => {
  await evalJs(`__yanState().settings.pendingWorkdir = ${JSON.stringify(WORK)}; document.querySelector('#newChat').click(); true`);
  await evalJs(
    `document.querySelector('#welcomeInput').value = ${JSON.stringify(command)}; document.querySelector('#welcomeInput').dispatchEvent(new Event('input')); document.querySelector('#welcome .send-trigger').click(); true`
  );
};
const select = async (selector, text, occurrence = 0, keepOpen = false) => {
  await evalJs(
    `(() => { const body = document.querySelector(${JSON.stringify(selector)}); for (let el = body.parentElement; el; el = el.parentElement) { if (!el.matches('details')) continue; const summary = el.querySelector(':scope > summary'); if (el.matches('.reasoning') && el.open && !el.dataset.touched) summary.click(); if (!el.open) summary.click(); } body.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`
  );
  await sleep(180);
  await evalJs(
    `(() => { const body = document.querySelector(${JSON.stringify(selector)}), w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); let n, found = 0; while (n = w.nextNode()) { for (let at = n.data.indexOf(${JSON.stringify(text)}); at >= 0; at = n.data.indexOf(${JSON.stringify(text)}, at + 1)) { if (found++ !== ${occurrence}) continue; const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + ${text.length}); getSelection().removeAllRanges(); getSelection().addRange(r); return true; } } throw Error('fixture text not found'); })()`
  );
  if (selector.includes(".trail-live .markdown")) {
    await sleep(550);
    check("streaming repaint keeps the selected tail text", await evalJs(`getSelection().toString() === ${JSON.stringify(text)}`));
  }
  await waitFor(`!document.querySelector('#quoteTip').classList.contains('hidden')`, 3000);
  await evalJs(`document.querySelector('#quoteTip [data-tip="note"]').click(); true`);
  const id = await evalJs(
    `__yanState().conversations.find(c => c.messages.some(m => m.id === document.querySelector('#messages .message.assistant').dataset.message)).threads.at(-1).id`
  );
  if (!keepOpen) await evalJs(`document.querySelector('#sideClose').click(); true`);
  return id;
};
const marked = (id, selector = "#messages") => `${selector} mark.note-anchor[data-thread="${id}"]`;
const textOf = id => `[...document.querySelectorAll(${JSON.stringify(marked(id))})].map(n => n.textContent).join('').replace(/\\s+/g, '')`;
const verify = async (label, id, text) => {
  check(
    label,
    await evalJs(
      `${textOf(id)} === ${JSON.stringify(text.replace(/\s+/g, ""))} && document.querySelectorAll('#messages sup.note-ref[data-thread="${id}"]').length === 1`
    )
  );
};
const reload = async () => {
  await sleep(1200);
  const token = Date.now(),
    script = await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__migrationReload = ${token}` });
  await send("Page.reload");
  await waitFor(
    `window.__migrationReload === ${token} && !!document.documentElement && !document.documentElement.hasAttribute('data-booting') && !!document.querySelector('#messages .message.assistant')`
  );
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
};

for (const mode of ["finish", "more", "stop"]) {
  await start("TRAILMOVE" + (mode === "more" ? " MORE" : ""));
  await waitFor(`document.querySelector('#messages .trail-live .markdown')?.textContent.includes('末轮第1句')`, 10000);
  if (mode === "finish") {
    await evalJs(
      `(() => { const body = document.querySelector('#messages .trail-live .markdown'), first = document.createTreeWalker(body.querySelector('.md-stable'), NodeFilter.SHOW_TEXT).nextNode(), w = document.createTreeWalker(body.querySelector('.md-tail'), NodeFilter.SHOW_TEXT); let last; while (last = w.nextNode()) if (last.data.includes('目标短语')) break; const r = document.createRange(); r.setStart(first, 0); r.setEnd(last, last.data.indexOf('目标短语') + 4); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`
    );
    await sleep(550);
    check(
      "selection across stable and live paragraphs survives streaming repaint",
      await evalJs(`getSelection().toString().includes('已写段落') && getSelection().toString().includes('目标短语')`)
    );
    await waitFor(`!document.querySelector('#quoteTip').classList.contains('hidden')`);
    await evalJs(`getSelection().removeAllRanges(); true`);
  }
  const body = "#messages .trail-group[data-at] .reasoning-body",
    old = await select(body, "同文思绪", 0),
    fresh = await select(body, "同文思绪", 1),
    live = await select("#messages .trail-live .markdown", "目标短语"),
    cross = await select(body, "跨段起点。跨段终点。", 0, true);
  check(
    `${mode}: all notes created while streaming`,
    await evalJs(`document.querySelector('#messages .message.assistant').dataset.status === 'streaming'`)
  );
  if (mode === "stop") await evalJs(`document.querySelector('#chatSend').click(); true`);
  await waitFor(
    `document.querySelector('#messages .message.assistant')?.dataset.status === '${mode === "stop" ? "stopped" : "complete"}'`,
    15000
  );
  check(
    `${mode}: settling preserves the open note's active markers`,
    await evalJs(
      `document.querySelectorAll(${JSON.stringify(marked(cross))}).length > 0 && [...document.querySelectorAll(${JSON.stringify(marked(cross))})].every(n => n.classList.contains('active')) && !!document.querySelector('#messages sup.note-ref.active[data-thread="${cross}"]')`
    )
  );
  for (const phase of ["settled", "reload"]) {
    if (phase === "reload") await reload();
    await verify(`${mode}/${phase}: old reasoning stays anchored`, old, "同文思绪");
    await verify(`${mode}/${phase}: new reasoning stays anchored`, fresh, "同文思绪");
    await verify(`${mode}/${phase}: completing Markdown preserves the live text note`, live, "目标短语");
    await verify(`${mode}/${phase}: cross-boundary text keeps one reference`, cross, "跨段起点。跨段终点。");
    check(
      `${mode}/${phase}: repeated new reasoning keeps the correct round`,
      await evalJs(
        `(() => { const a = document.querySelector(${JSON.stringify(marked(old))}), b = document.querySelector(${JSON.stringify(marked(fresh))}); return !!a && !!b && a.closest('.reasoning-body') !== b.closest('.reasoning-body') && ${mode === "more" ? "!!b.closest('.trail-group')" : "!b.closest('.tool-stack')"}; })()`
      )
    );
  }
}

for (const mode of ["finish", "more"]) {
  await start("TRAILCODA" + (mode === "more" ? " MORE" : ""));
  await waitFor(
    `!!document.querySelector('#messages .tool-stack [data-tool="intent_gate"]') && document.querySelector('#messages .trail-live .markdown')?.textContent.includes('对照后第1句')`,
    15000
  );
  const gateGroup = '#messages .trail-group:has([data-tool="intent_gate"])',
    old = await select('#messages .trail-group:has([data-tool="update_intent"]) .trail-note', "门前重复"),
    answer = await select(gateGroup + " .trail-note", "门前重复"),
    thought = await select(gateGroup + " .reasoning-body", "同文思绪", 0),
    after = await select(gateGroup + " .reasoning-body", "门后思绪", 0, true);
  check(
    `coda/${mode}: notes created before completion`,
    await evalJs(`document.querySelector('#messages .message.assistant').dataset.status === 'streaming'`)
  );
  await waitFor(`document.querySelector('#messages .message.assistant')?.dataset.status === 'complete'`, 15000);
  check(
    `coda/${mode}: settling preserves the open note's active markers`,
    await evalJs(
      `!!document.querySelector(${JSON.stringify(marked(after) + ".active")}) && !!document.querySelector('#messages sup.note-ref.active[data-thread="${after}"]')`
    )
  );
  for (const phase of ["settled", "reload"]) {
    if (phase === "reload") await reload();
    await verify(`coda/${mode}/${phase}: old process note survives`, old, "门前重复");
    await verify(`coda/${mode}/${phase}: answer before gate survives`, answer, "门前重复");
    await verify(`coda/${mode}/${phase}: reasoning before gate survives`, thought, "同文思绪");
    await verify(`coda/${mode}/${phase}: reasoning after gate survives`, after, "门后思绪");
    check(
      `coda/${mode}/${phase}: identical text is not borrowed from the old process`,
      await evalJs(
        `(() => { const a = document.querySelector(${JSON.stringify(marked(old))}), b = document.querySelector(${JSON.stringify(marked(answer))}); return !!a && !!b && a.closest('.trail-note, .markdown') !== b.closest('.trail-note, .markdown') && ${mode === "more" ? "!!b.closest('.trail-group')" : "!!b.closest('.assistant-block > .markdown')"}; })()`
      )
    );
    check(
      `coda/${mode}/${phase}: gate follows the expected rendering contract`,
      await evalJs(
        mode === "more"
          ? `!!document.querySelector('#messages .tool-stack [data-tool="intent_gate"]') && !document.querySelector('#messages .trail-coda')`
          : `!document.querySelector('#messages .tool-stack [data-tool="intent_gate"]') && !!document.querySelector('#messages .trail-coda [data-tool="intent_gate"]')`
      )
    );
  }
  if (mode === "finish") {
    await evalJs(`document.querySelector(${JSON.stringify(marked(answer))})?.click(); true`);
    await sleep(250);
    check(
      "migrated answer reopens its side note",
      await evalJs(
        `document.querySelector('#sideAnchor').textContent === '门前重复' && !document.querySelector('#sidePanel').classList.contains('hidden')`
      )
    );
    await shot("trail-selection-coda.png");
  }
}
// 公式从占位转为 KaTeX 后，不把公式显示文字计入正文的同文序号；重画与刷新都不能带偏后面的旁注。
await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*katex.min.js*"] });
try {
  const first = "公式 $x^2$。先读取文件。\n\n",
    second = "公式 $x^2$ 之后，x2 是需要旁注的文字。\n\n";
  await fetch(PAGE + "api/chats/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      savedAt: Date.now(),
      conversation: {
        id: "trail-math",
        title: "公式与旁注",
        createdAt: "2026-10-26",
        updatedAt: new Date().toISOString(),
        workdir: WORK,
        forks: [],
        threads: [],
        messages: [
          { id: "math-question", role: "user", content: "核对公式后的文字。", timestamp: "2026-10-26" },
          {
            id: "math-answer",
            role: "assistant",
            content: first + second + "收尾。",
            status: "complete",
            work: true,
            toolsTouched: true,
            toolsOpen: true,
            timestamp: "2026-10-26",
            steps: [
              {
                id: "math-read",
                name: "read_file",
                arguments: '{"path":"a.txt"}',
                title: "a.txt",
                status: "done",
                at: first.length,
                rat: 0,
                expanded: true,
                output: Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行`).join("\n"),
                result: "12 行"
              },
              {
                id: "math-next",
                name: "read_file",
                arguments: '{"path":"b.txt"}',
                title: "b.txt",
                status: "done",
                at: first.length + second.length,
                rat: 0,
                expanded: true,
                output: "后一步。",
                result: "1 行"
              }
            ]
          }
        ]
      }
    })
  });
  await reload();
  await waitFor(`!!document.querySelector('[data-conversation="trail-math"]')`);
  await evalJs(`document.querySelector('[data-conversation="trail-math"] .history-open').click(); true`);
  await waitFor(`!!document.querySelector('#messages .math-pending')`);
  check("blocked math starts as a pending placeholder", !(await evalJs(`!!document.querySelector('#messages .katex')`)));
  const note = await select('#messages .trail-group:has([data-step-id="math-next"]) .trail-note', "x2");
  await verify("note after pending math is anchored", note, "x2");
  await evalJs(
    `(() => { const n = document.querySelector('#messages .math-pending code').firstChild, r = document.createRange(); r.selectNodeContents(n); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`
  );
  await waitFor(`!document.querySelector('#quoteTip').classList.contains('hidden')`);
  check(
    "formula selection can still be quoted",
    await evalJs(`!document.querySelector('#quoteTip [data-tip="quote"]').classList.contains('hidden')`)
  );
  check(
    "formula selection cannot create a note that would lose its anchor",
    await evalJs(`document.querySelector('#quoteTip [data-tip="note"]').classList.contains('hidden')`)
  );
  await evalJs(`document.querySelector('#quoteTip [data-tip="quote"]').click(); true`);
  check(
    "formula quote reaches the composer",
    await evalJs(
      `!document.querySelector('#composerQuote').classList.contains('hidden') && document.querySelector('#composerQuote .composer-quote-text').textContent.includes('x^2')`
    )
  );
  await evalJs(`document.querySelector('#composerQuoteClose').click(); true`);
  await send("Network.setBlockedURLs", { urls: [] });
  for (const phase of ["loaded", "reload"]) {
    await reload();
    await waitFor(`!!document.querySelector('#messages .katex')`, 10000);
    await evalJs(`document.querySelector('#messages [data-step-id="math-read"] [data-step-more]').click(); true`);
    await sleep(250);
    await verify(`math/${phase}: output repaint keeps the note after rendered math`, note, "x2");
    check(
      `math/${phase}: formula does not borrow the text note`,
      await evalJs(`[...document.querySelectorAll(${JSON.stringify(marked(note))})].every(n => !n.closest('.katex, .math-pending'))`)
    );
  }
} finally {
  await send("Network.setBlockedURLs", { urls: [] });
  close();
}
