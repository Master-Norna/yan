// 跟随到底与程序滚动：生成中点书眉回得到顶；触控板式的小步上翻不被落墨的下一帧拽回底部
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const filler = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段：这是一段较长的回答，用来把对话撑高，好让标题滚出视口。`).join("\n\n");
const messages = [];
for (let i = 0; i < 4; i++) {
  messages.push({ id: `u${i}`, role: "user", content: `问题 ${i}`, timestamp: "2026-10-07" });
  messages.push({ id: `a${i}`, role: "assistant", content: filler, status: "complete", timestamp: "2026-10-07" });
}
const conv = {
  id: "follow",
  title: "跟随",
  createdAt: "2026-10-07",
  updatedAt: new Date().toISOString(),
  forks: [],
  threads: [],
  messages
};
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "on", mode: "chat", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [${JSON.stringify(conv)}], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="follow"]')`, 10000);
await evalJs(`document.querySelector('[data-conversation="follow"] .history-open').click(); true`);
await sleep(800);
const last = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`;
const ask = async text => {
  await evalJs(
    `(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); })(document.querySelector("#chatInput")); true`
  );
  await evalJs(
    `document.querySelector("#chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); true`
  );
  await waitFor(`${last}?.dataset.status === "streaming"`, 10000);
  await sleep(1200);
};
const gap = `(h => h.scrollHeight - h.scrollTop - h.clientHeight)(document.querySelector("#chatScroll"))`;

// 书眉：平滑滚动的头一步只挪几像素，不能当作「又到底了」重新跟随
await ask("SLOWLONG 说长些");
check(
  "streaming keeps the view at the bottom, the running head shown",
  await evalJs(`${gap} < 8 && document.querySelector("#runningHead").classList.contains("shown")`)
);
await evalJs(`document.querySelector("#runningHead").click(); true`);
await sleep(2000);
const top = await evalJs(`document.querySelector("#chatScroll").scrollTop`);
check("clicking the running head while streaming scrolls back to the top", top < 5, `scrollTop=${top}`);

// 触控板：每次上翻 3px
await waitFor(`${last}?.dataset.status === "complete"`, 30000);
await ask("SLOWLONG 再说长些");
const pad = await evalJs(`(async () => {
  const h = document.querySelector("#chatScroll");
  for (let i = 0; i < 10; i++) {
    h.dispatchEvent(new WheelEvent("wheel", { deltaY: -3, bubbles: true }));
    h.scrollTop -= 3;
    await new Promise(r => setTimeout(r, 40));
  }
  await new Promise(r => setTimeout(r, 600));
  return Math.round(h.scrollHeight - h.scrollTop - h.clientHeight);
})()`);
check("touchpad-sized upward steps while streaming are not pulled back to the bottom", pad >= 30, `gap=${pad}`);

// 内容自己长高、位置没动（图片落定、内联作品撑开）：跟随不该被关，长多少仍贴到底
await evalJs(`document.querySelector("#jumpBottom").click(); true`);
await sleep(900); // 让「人刚动过手」的窗口过去，下面两下都是程序弄的
const addBlock = height =>
  evalJs(
    `(() => { const d = document.createElement("div"); d.style.height = "${height}px"; document.querySelector("#messages").appendChild(d); return true; })()`
  );
await addBlock(200);
await sleep(600);
const grew = await evalJs(gap);
check("content growing below without a scroll does not stop following", grew < 8, `gap=${grew}`);

// 一版内容重排：高度同时变了、位置也被挪小（浏览器把越界的位置夹回）。人没碰过，跟随仍不该被关，之后长高还贴底
const shifted = await evalJs(
  `(h => {
     document.querySelector("#messages").insertAdjacentHTML("beforeend", '<div style="height:200px"></div>');
     h.scrollTop = Math.max(0, h.scrollTop - 300);
     return Math.round(h.scrollHeight - h.scrollTop - h.clientHeight);
   })(document.querySelector("#chatScroll"))`
);
await addBlock(200);
await sleep(600);
const back = await evalJs(gap);
check("a relayout shifting the view up does not stop following", shifted >= 300 && back < 8, `gap=${shifted} → ${back}`);

// 切到卷宗页，这段在别处又长了一截：切回来仍该贴着底，不是停在离开时的位置
await evalJs(`document.querySelector("#jumpBottom").click(); true`);
await sleep(600);
await evalJs(`document.querySelector("#openLibrary").onclick(); true`);
await sleep(600);
await evalJs(
  `(() => { const c = __yanState().conversations.find(c => c.id === "follow"); const m = c.messages.at(-1); m.content += "\\n\\n" + ${JSON.stringify(filler)}; return m.content.length; })()`
);
await evalJs(`document.querySelector("#openLibrary").onclick(); true`);
await sleep(800);
const resumed = await evalJs(gap);
check("coming back to a followed chat lands at the bottom, not where it was left", resumed < 8, `gap=${resumed}`);
close();
