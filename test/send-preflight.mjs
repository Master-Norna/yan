// 准备工作目录还在等待时，连续按发送只应建立一问；失败后应允许重新发送。
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";

const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", lastView: "chat", lastConversationId: "preflight-chat", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", maxTokens: 8192, quota: "100k", usedTokens: 0 }], conversations: [{ id: "preflight-chat", title: "发送准备", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", profileId: "p1", workdir: ${JSON.stringify(WORK)}, messages: [], forks: [], threads: [] }], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`document.querySelector("#chatInput") && !document.querySelector("#chat").classList.contains("hidden")`);

await evalJs(`(() => {
  const original = window.fetch.bind(window);
  let release;
  const gate = new Promise(resolve => release = resolve);
  window.__preflight = { calls: 0, release, original };
  window.fetch = (...args) => {
    // 走总线时路径在请求体里
    const prepare = String(args[0]).includes("/api/work/prepare") || String(args[1]?.body || "").includes('"path":"/api/work/prepare"');
    if (prepare && ++window.__preflight.calls === 1)
      return gate.then(() => new Response('{"error":"临时故障"}', { status: 503, headers: { "Content-Type": "application/json" } }));
    return original(...args);
  };
  const input = document.querySelector("#chatInput");
  input.value = "只发送一次";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return true;
})()`);
await waitFor(`window.__preflight.calls === 1`);
check(
  "preflight blocks repeated Enter and keeps the draft visible",
  await evalJs(
    `window.__preflight.calls === 1 && document.querySelector("#chatInput").value === "只发送一次" && document.querySelector("#chatSend").disabled && __yanState().conversations[0].messages.length === 0`
  )
);
await evalJs(`window.__preflight.release(); true`);
await waitFor(`!document.querySelector("#chatSend").disabled`);
check("failed preflight leaves the message unsent", await evalJs(`__yanState().conversations[0].messages.length === 0`));

await evalJs(`document.querySelector("#chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); true`);
await waitFor(`__yanState().conversations[0].messages.length >= 2`);
check(
  "retry creates exactly one user message and one reply",
  await evalJs(
    `(() => { const messages = __yanState().conversations[0].messages; return messages.length === 2 && messages[0].role === "user" && messages[0].content === "只发送一次" && messages[1].role === "assistant"; })()`
  )
);
await evalJs(`window.fetch = window.__preflight.original; true`);

// 等工作目录的空当里换到另一段对话：发出去的仍是点发送那一刻的话，落进原来那段；另一段的草稿与引文原样留着
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", lastView: "chat", lastConversationId: "switch-a", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", maxTokens: 8192, quota: "100k", usedTokens: 0 }], conversations: [{ id: "switch-a", title: "甲段", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", profileId: "p1", workdir: ${JSON.stringify(WORK)}, messages: [], forks: [], threads: [] }, { id: "switch-b", title: "乙段", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", profileId: "p1", messages: [], forks: [], threads: [] }], library: [], drafts: { "switch-b": { text: "乙的草稿", attachments: [], quote: { text: "乙的引文", messageId: "" } } } })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('#history [data-conversation="switch-a"] .history-open')`);
await evalJs(`document.querySelector('#history [data-conversation="switch-a"] .history-open').click(); true`);
await waitFor(`__yanState().settings.lastConversationId === "switch-a" && !!document.querySelector("#chatInput")`);
await evalJs(`(() => {
  const original = window.fetch.bind(window);
  let release;
  const gate = new Promise(resolve => release = resolve);
  window.__preflight = { calls: 0, release, original };
  window.fetch = (...args) => {
    const prepare = String(args[0]).includes("/api/work/prepare") || String(args[1]?.body || "").includes('"path":"/api/work/prepare"');
    if (prepare && ++window.__preflight.calls === 1) return gate.then(() => original(...args));
    return original(...args);
  };
  const input = document.querySelector("#chatInput");
  input.value = "甲的话";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return true;
})()`);
await waitFor(`window.__preflight.calls === 1`);
await evalJs(`document.querySelector('#history [data-conversation="switch-b"] .history-open').click(); true`);
await waitFor(`__yanState().settings.lastConversationId === "switch-b" && document.querySelector("#chatInput").value === "乙的草稿"`);
await evalJs(`window.__preflight.release(); true`);
await waitFor(`__yanState().conversations.find(c => c.id === "switch-a").messages.length >= 2`);
check(
  "switching away while the send waits still sends the first conversation's words there",
  await evalJs(
    `(() => { const s = __yanState(), a = s.conversations.find(c => c.id === "switch-a"), b = s.conversations.find(c => c.id === "switch-b"); return a.messages[0].content === "甲的话" && !a.messages[0].quote && b.messages.length === 0; })()`
  )
);
check(
  "the conversation now in view keeps its draft and quote, and stays in view",
  await evalJs(
    `__yanState().settings.lastConversationId === "switch-b" && document.querySelector("#chatInput").value === "乙的草稿" && !!document.querySelector("#composerQuote:not(.hidden), .composer-quote:not(.hidden)")?.textContent.includes("乙的引文")`
  )
);
await evalJs(`window.fetch = window.__preflight.original; true`);
// 已点发送的附件由快照拿住：等待里摘掉也不能删原件；准备失败则解除保留、清掉孤件。
await evalJs(`__yanState().conversations.find(c => c.id === "switch-b").workdir = ${JSON.stringify(WORK)}; true`);
for (const ready of [false, true]) {
  await evalJs(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["发送快照的原件"], "快照.txt", { type: "text/plain" }));
    window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  })(); true`);
  await waitFor(`document.querySelectorAll("#attachments [data-remove-attachment]").length === 1`);
  const id = await evalJs(`__yanState().drafts["switch-b"].attachments[0].id`);
  await evalJs(`(() => {
    const original = window.fetch.bind(window);
    let release;
    const gate = new Promise(resolve => release = resolve);
    window.__preflight = { calls: 0, release, original };
    window.fetch = (...args) => {
      const prepare = String(args[0]).includes("/api/work/prepare") || String(args[1]?.body || "").includes('"path":"/api/work/prepare"');
      if (prepare && ++window.__preflight.calls === 1)
        return gate.then(() => ${ready ? "original(...args)" : 'new Response(\'{"error":"临时故障"}\', { status: 503, headers: { "Content-Type": "application/json" } })'});
      return original(...args);
    };
    const input = document.querySelector("#chatInput");
    input.value = "PLAIN 查看附件";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  })(); true`);
  await waitFor(`window.__preflight.calls === 1`);
  await evalJs(`document.querySelector("#attachments [data-remove-attachment]").click(); true`);
  await sleep(300);
  check(
    "removing an attachment during preflight keeps the snapshot's original",
    (await fetch(`${PAGE}api/files/raw?id=${id}`)).status === 200
  );
  await evalJs(`window.__preflight.release(); true`);
  if (ready) {
    await waitFor(`__yanState().conversations.find(c => c.id === "switch-b").messages.length >= 2`);
    check(
      "a successful preflight passes the attachment to the sent message with its original intact",
      (await evalJs(`__yanState().conversations.find(c => c.id === "switch-b").messages[0].attachments[0].id`)) === id &&
        (await fetch(`${PAGE}api/files/raw?id=${id}`)).status === 200
    );
  } else {
    await waitFor(`!document.querySelector("#chatSend").disabled`);
    await waitFor(`fetch("/api/files/raw?id=${id}").then(r => r.status === 404)`);
    check(
      "a failed preflight cleans up an attachment removed from the draft",
      await evalJs(`__yanState().conversations.find(c => c.id === "switch-b").messages.length === 0`)
    );
  }
  await evalJs(`window.fetch = window.__preflight.original; true`);
}
close();
