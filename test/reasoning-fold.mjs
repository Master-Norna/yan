// 思绪的自动收起：写着的时候摊开，正文起笔、一答写完就收。读者在思绪框里往上翻着看（滚的是框，对话没动），
// 不算离开底部；一答收尾时，用户没亲手开合过的思绪一律收起
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "on", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const last = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`,
  reasoning = `${last}?.querySelector(":scope .assistant-block > .reasoning")`;
await evalJs(
  `document.querySelector("#welcomeInput").value = "LONGTHINK 想想"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
// 思绪写得装不下了：在思绪框里往上翻一下
await waitFor(`(b => b && b.scrollHeight > b.clientHeight + 40)(${reasoning}?.querySelector(".reasoning-body"))`, 20000);
const open = await evalJs(`${reasoning}.open`);
check("reasoning is open while it is being written", open === true);
await evalJs(
  `(b => { b.scrollTop = b.scrollHeight; b.scrollTop -= 30; b.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true })); })(${reasoning}.querySelector(".reasoning-body")); true`
);
await waitFor(`${last}?.dataset.status === "complete"`, 20000);
await sleep(1600);
const after = await evalJs(
  `({ open: ${reasoning}.open, bottom: (s => s.scrollHeight - s.scrollTop - s.clientHeight)(document.querySelector("#chatScroll")) })`
);
check(
  "scrolling inside the reasoning box does not stop following, and the reasoning folds once the answer is done",
  after.open === false,
  JSON.stringify(after)
);
// 用户亲手摊开的，重画后照旧摊开，不替他收
await evalJs(`${reasoning}.querySelector("summary").click(); true`);
await sleep(800);
const kept = await evalJs(`__yanState().conversations[0].messages.at(-1).reasoningTouched === true && ${reasoning}.open`);
check("a reasoning block the user opened by hand stays open", kept);
await close();
process.exit(0);
