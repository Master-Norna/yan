// 待寄补言撤下：它之后建的旁注要跟着原文回到正文，重复文字也不能标回前一句。
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(
  `!!document.documentElement && !document.documentElement.hasAttribute('data-booting') && !!document.querySelector('#welcomeInput')`
);
const cases = [
  { name: "plain", prompt: "TRAILPENDING", prefix: "前段重复短语", occurrence: 1 },
  { name: "link URL", prompt: "TRAILPENDING LINK", prefix: "前段可见标签", occurrence: 0 },
  { name: "bold span", prompt: "TRAILPENDING BOLD", prefix: "前段重复短语", occurrence: 1 },
  { name: "spaced text", prompt: "TRAILPENDING SPACE", prefix: "前段重 复短语", occurrence: 1 }
];
for (const [index, example] of cases.entries()) {
  if (index) {
    await evalJs(`document.querySelector('#newChat').click(); true`);
    await waitFor(`!!document.querySelector('#welcome:not(.hidden)')`);
  }
  await evalJs(
    `document.querySelector('#welcomeInput').value = ${JSON.stringify(example.prompt)}; document.querySelector('#welcomeInput').dispatchEvent(new Event('input')); document.querySelector('#welcome .send-trigger').click(); true`
  );
  await waitFor(`document.querySelector('#messages .message.assistant')?.textContent.includes(${JSON.stringify(example.prefix)})`, 10000);
  await evalJs(
    `(() => { const input = document.querySelector('#chatInput'); input.value = '稍后再说'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`
  );
  await waitFor(`!!document.querySelector('#messages .tool-step-note[data-status="running"]')`);
  await waitFor(`document.querySelector('#messages .trail-live .markdown')?.textContent.includes('目标短语')`, 10000);
  const conversation = `__yanState().conversations.find(c => c.messages.some(m => m.id === document.querySelector('#messages .message.assistant').dataset.message))`,
    pendingId = await evalJs(`${conversation}.messages.at(-1).steps.find(s => s.name === 'user_note').id`);
  const select = async text => {
    await evalJs(
      `(() => { const body = document.querySelector('#messages .trail-live .markdown'), w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); let n; while (n = w.nextNode()) { const at = n.data.indexOf(${JSON.stringify(text)}); if (at < 0) continue; const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + ${text.length}); getSelection().removeAllRanges(); getSelection().addRange(r); return true; } throw Error('fixture text not found'); })()`
    );
    await waitFor(`!document.querySelector('#quoteTip').classList.contains('hidden')`, 3000);
    await evalJs(`document.querySelector('#quoteTip [data-tip="note"]').click(); true`);
    const id = await evalJs(`${conversation}.threads.at(-1).id`);
    await evalJs(`document.querySelector('#sideClose').click(); true`);
    return id;
  };
  const target = await select("目标短语"),
    repeat = await select("重复短语");
  check(
    `${example.name}: pending notes point to its step`,
    await evalJs(`${conversation}.threads.slice(-2).every(t => t.anchor.trail?.after === ${JSON.stringify(pendingId)})`)
  );
  await evalJs(`document.querySelector('#chatSend').click(); true`);
  await waitFor(`document.querySelector('#messages .message.assistant')?.dataset.status === 'stopped'`, 10000);
  check(
    `${example.name}: stopping rebases both notes by visible text`,
    await evalJs(
      `(() => { const c = ${conversation}, m = c.messages.at(-1), t = c.threads.slice(-2); return !m.steps?.length && t.every(n => !n.anchor.trail) && t[1].anchor.occurrence === ${example.occurrence}; })()`
    )
  );
  const verify = async phase => {
    for (const [id, text] of [
      [target, "目标短语"],
      [repeat, "重复短语"]
    ])
      check(
        `${example.name} ${phase}: ${text} keeps its mark and footnote`,
        await evalJs(
          `[...document.querySelectorAll('#messages mark.note-anchor[data-thread="${id}"]')].map(n => n.textContent).join('') === ${JSON.stringify(text)} && document.querySelectorAll('#messages sup.note-ref[data-thread="${id}"]').length === 1`
        )
      );
    check(
      `${example.name} ${phase}: the repeated note marks the first suffix occurrence`,
      await evalJs(
        `(() => { const mark = document.querySelector('#messages mark.note-anchor[data-thread="${repeat}"]'), body = document.querySelector('#messages .message.assistant .markdown'); if (!mark || !body) return false; const r = document.createRange(); r.selectNodeContents(body); r.setEndBefore(mark); const before = r.toString(); return before.includes(${JSON.stringify(example.prefix)}) && !before.includes('后面的'); })()`
      )
    );
  };
  await verify("stopped");
  const token = Date.now(),
    script = await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__pendingReload = ${token}` });
  await send("Page.reload");
  await waitFor(
    `window.__pendingReload === ${token} && !!document.documentElement && !document.documentElement.hasAttribute('data-booting') && !!document.querySelector('#messages .message.assistant')`
  );
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
  await verify("reload");
}
close();
