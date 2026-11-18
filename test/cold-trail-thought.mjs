// 走真实落盘、重载和展开入口：只有认得出且收着的纯思绪不随开页读回。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { connect, check, sleep, CHATS, PAGE } from "./lib.mjs";

const id = "cold-thoughts",
  stamp = new Date().toISOString(),
  reasoning = "同一句也出现在正文。\n" + "只有打开才取回这一段。\n".repeat(1800),
  answer = (id, extra = {}) => ({
    id,
    role: "assistant",
    status: "complete",
    content: `正文 ${id}：同一句也出现在正文。`,
    reasoning,
    timestamp: stamp,
    ...extra
  }),
  conversation = (id, messages, threads = []) => ({ id, title: id, createdAt: stamp, updatedAt: stamp, messages, forks: [], threads });
const post = async (route, body) => {
  const res = await fetch(PAGE + `api/chats/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw Error(`${route}: ${res.status}`);
};
const note = {
  id: "note",
  anchor: { messageId: "lazy", text: "同一句也出现在正文。", part: 0 },
  createdAt: stamp,
  updatedAt: stamp,
  messages: [answer("side")]
};
await post("trail/put", { id, key: "legacy-key", piece: { reasoning, subs: {} } });
await post("save", {
  savedAt: Date.now(),
  conversation: conversation(
    id,
    [
      answer("lazy"),
      answer("backup"),
      answer("opened", { reasoningTouched: true, reasoningOpen: true }),
      answer("legacy", { reasoning: undefined, cold: { key: "legacy-key" } }),
      answer("lost")
    ],
    [note]
  )
});
await post("save", { savedAt: Date.now(), conversation: conversation("cold-other", [answer("other", { reasoning: "" })]) });

const { send, evalJs, waitFor, close } = await connect();
const mine = `__yanState().conversations.find(c => c.id === '${id}')`,
  msg = id => `${mine}.messages.find(m => m.id === '${id}')`,
  article = id => `document.querySelector('[data-message="${id}"]')`,
  details = id => `${article(id)}?.querySelector('.reasoning')`,
  body = id => `${details(id)}?.querySelector('.reasoning-body')`,
  clickThought = id => evalJs(`${details(id)}.querySelector('summary').click(); true`);
const open = async id => {
  await waitFor(`!!document.querySelector('[data-conversation="${id}"] .history-open')`);
  await evalJs(`document.querySelector('[data-conversation="${id}"] .history-open').click(); true`);
};
// 单独的浏览器源：本例有意挂住行迹响应，不能与后续用例共享浏览器的同源连接。
const app = PAGE.replace("127.0.0.1", "localhost");
const navigate = async (suffix = "") => {
  const url = app + suffix;
  await send("Page.navigate", { url });
  await waitFor(`location.href === ${JSON.stringify(url)} && typeof document.querySelector('#openLibrary')?.onclick === 'function'`);
};
let trailInterceptor;
try {
  await navigate();
  await open(id);
  await evalJs(`${mine}.pinned = true; __yanSave(); true`);
  const code = createHash("sha1").update(id).digest("hex").slice(0, 10);
  let disk;
  const limit = Date.now() + 10000;
  while (Date.now() < limit) {
    try {
      const name = readdirSync(CHATS).find(name => name.endsWith(`·${code}.json`));
      disk = JSON.parse(readFileSync(`${CHATS}/${name}`, "utf8")).conversation;
      if (disk.messages[0].cold?.reasoningOnly && disk.threads[0].messages[0].cold?.reasoningOnly) break;
    } catch {}
    await sleep(120);
  }
  check(
    "a new step-free thought is marked on disk without its text",
    disk?.messages[0].cold?.reasoningOnly && disk.messages[0].reasoning === undefined
  );
  const [lazy, backup, opened, legacy, lost] = disk.messages.map(m => m.cold.key),
    side = disk.threads[0].messages[0].cold.key;
  // 去掉其中一片，守住读不成也会收口。其余沿用桥接、浏览器实际读取。
  rmSync(`${CHATS}/行迹/${code}/${lost}.json`);
  const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      if (location.search !== '?thoughts-on-demand') return;
      window.trailReads = [];
      window.releaseThought = {};
      const original = window.fetch;
      const gates = new Map(${JSON.stringify([lazy, lost])}.map(key => [key, new Promise(resolve => { releaseThought[key] = resolve; })]));
      window.fetch = (url, init) => {
        const request = original(url, init);
        if (!String(url).endsWith('/api/chats/trail/get')) return request;
        const { keys } = JSON.parse(init.body);
        trailReads.push(keys);
        return request.then(async response => { await Promise.all(keys.map(key => gates.get(key))); return response; });
      };
    })()`
  });
  trailInterceptor = identifier;
  await navigate("?thoughts-on-demand");
  await open(id);
  await waitFor(`${msg("opened")}.reasoning?.length === ${reasoning.length} && ${msg("legacy")}.reasoning?.length === ${reasoning.length}`);
  const eager = (await evalJs("trailReads")).flat();
  check(
    "opening the chat requests only the restored-open and old unmarked keys",
    eager.length === 2 && eager.includes(opened) && eager.includes(legacy),
    JSON.stringify(eager)
  );
  check(
    "folded thoughts keep their summaries but are absent from memory and the DOM body",
    await evalJs(`!${details("lazy")}.open && ${body("lazy")}.textContent === '' && ${msg("lazy")}.reasoning === undefined`)
  );
  check(
    "a note attached to the unread thought is not rebound to matching reply text",
    await evalJs(`!${article("lazy")}.querySelector('mark.note-anchor')`)
  );

  await clickThought("lazy");
  await waitFor(`trailReads.some(keys => keys.includes(${JSON.stringify(lazy)}))`);
  check("explicit expansion asks for just the clicked key", JSON.stringify((await evalJs("trailReads")).at(-1)) === JSON.stringify([lazy]));
  await clickThought("lazy"); // 收起再换段，迟到的结果不应复开或把人拉回。
  await open("cold-other");
  await waitFor(`!!${article("other")}`);
  await evalJs(`releaseThought[${JSON.stringify(lazy)}](); true`);
  await waitFor(`${msg("lazy")}.reasoning?.length === ${reasoning.length}`);
  check("late thought does not change the open conversation", await evalJs(`!!${article("other")} && !${article("lazy")}`));
  await open(id);
  await waitFor(`!!${details("lazy")}`);
  check(
    "returning keeps the thought folded and restores its own note anchor",
    await evalJs(`!${details("lazy")}.open && !!${body("lazy")}.querySelector('mark[data-thread="note"]')`)
  );
  await clickThought("lazy");
  check(
    "the warmed thought reopens without another read",
    await evalJs(`${details("lazy")}.open && trailReads.flat().filter(key => key === ${JSON.stringify(lazy)}).length === 1`)
  );

  await clickThought("lost");
  await waitFor(`trailReads.flat().includes(${JSON.stringify(lost)}) && ${details("lost")}.hasAttribute('aria-busy')`);
  await open("cold-other");
  await waitFor(`!!${article("other")}`);
  await evalJs(`releaseThought[${JSON.stringify(lost)}](); true`);
  await waitFor(`${msg("lost")}.reasoningOpen === false`);
  await open(id);
  await waitFor(`!!${details("lost")}`);
  check(
    "an absent piece that returns offscreen reopens as a closed summary",
    await evalJs(`!${details("lost")}.open && !${details("lost")}.hasAttribute('aria-busy')`)
  );
  await clickThought("lost");
  await waitFor(`document.querySelector('#toast').textContent.includes('思绪 读取失败')`);
  check(
    "the closed summary still responds without starting a permanent load",
    await evalJs(`!${details("lost")}.open && !${details("lost")}.hasAttribute('aria-busy')`)
  );
  await evalJs(`${body("lazy")}.querySelector('mark[data-thread="note"]').click(); true`);
  await waitFor(`!!${details("side")}`);
  check(
    "opening a side note does not fetch its folded thought",
    await evalJs(`!${details("side")}.open && !trailReads.flat().includes(${JSON.stringify(side)})`)
  );
  await waitFor(`document.activeElement === document.querySelector('#sideInput')`); // 开旁注时先聚焦输入框，等它交还焦点。
  await evalJs(`${details("side")}.querySelector('summary').focus(); true`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", text: " ", windowsVirtualKeyCode: 32 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await waitFor(`${body("side")}?.textContent.length === ${reasoning.length}`);
  check(
    "the side-note summary opens with the keyboard, fetches only its thought, and keeps focus",
    JSON.stringify((await evalJs("trailReads")).at(-1)) === JSON.stringify([side]) &&
      (await evalJs(`document.activeElement === ${details("side")}.querySelector('summary')`))
  );

  // 备份的按钮取全，包含依旧没展开的一答；读前后都从真实产品入口走。
  await evalJs(
    `document.querySelector('#openSettings').click(); document.querySelector('#settingsModal [data-tab="general"]').click(); true`
  );
  await waitFor(`!!document.querySelector('#exportData')`);
  await evalJs(`(() => {
    window.backupBlobs = new Map();
    const createUrl = URL.createObjectURL;
    URL.createObjectURL = blob => { const url = createUrl(blob); backupBlobs.set(url, blob); return url; };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { if (this.download && backupBlobs.has(this.href)) window.backupBlob = backupBlobs.get(this.href); else click.call(this); };
    document.querySelector('#exportData').click();
    return true;
  })()`);
  await waitFor("!!window.backupBlob");
  const exported = await evalJs(
    `window.backupBlob.text().then(text => JSON.parse(text).conversations.find(c => c.id === '${id}').messages.find(m => m.id === 'backup'))`
  );
  check(
    "full backup reads folded thoughts and exports text without the cold marker",
    exported.reasoning === reasoning && !exported.cold && (await evalJs("trailReads")).flat().includes(backup)
  );
  await evalJs(`document.querySelector('#closeSettings').click(); true`);
  await clickThought("backup");
  await waitFor(`${body("backup")}?.textContent.length === ${reasoning.length}`);
  check(
    "a folded summary painted before backup still opens without another read",
    (await evalJs("trailReads")).flat().filter(key => key === backup).length === 1
  );
} finally {
  // 测试器复用同一个浏览器目标；这一用例的 CDP 注入和挂起的读回不能带到下一页。
  if (trailInterceptor) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: trailInterceptor }).catch(() => {});
  await send("Page.navigate", { url: "about:blank" }).catch(() => {});
  await send("Storage.clearDataForOrigin", { origin: new URL(app).origin, storageTypes: "all" }).catch(() => {});
  close();
}
