// 拟题与首答并行：首答先写完时，收尾调用会撞上尚未结束的拟题请求；若它随后失败，仍要自动补试一次
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: true }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(
  `document.querySelector("#welcomeInput").value = "PLAIN TITLESLOWFAIL"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`, 10000);
check(
  "the first reply completes while the first title request is still pending",
  (await evalJs(`__yanState().conversations[0].titled`)) !== true
);
await waitFor(`__yanState().conversations[0].titled === true`, 5000);
const state = await evalJs(`__yanState()`);
check(
  "a late title failure is retried after the completed first reply",
  state.conversations[0].title === "测试标题" && state.conversations[0].titleTries === undefined,
  JSON.stringify([state.conversations[0].title, state.conversations[0].titleTries])
);
close();
