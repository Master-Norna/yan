// Anthropic 接口：经桥接把 OpenAI 格式换成 Messages API、事件流换回来——思考块、工具调用、签名回传、用量，页面一字不改
import { mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(WORK, { recursive: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(800);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, workAutoDefault: true, autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假 Claude", model: "claude-test", api: "anthropic", baseUrl: "http://127.0.0.1:8798", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const lastAssistant = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`;
await evalJs(
  `document.querySelector("#welcomeInput").value = "ANTHROPIC 看看"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`${lastAssistant}?.dataset.status === "complete"`, 20000);
const got = await evalJs(
  `(a => ({ text: [...a.querySelectorAll(".markdown")].map(n => n.textContent).join(" "), steps: [...a.querySelectorAll(".tool-step")].map(s => s.querySelector(".tool-label").textContent + ":" + s.dataset.status).join(), thought: a.querySelector(".reasoning-body")?.textContent || "" }))(${lastAssistant})`
);
check(
  "anthropic round trip: system, tools with input_schema, list_files ran, thinking block signed and passed back",
  got.text.includes("ANTHROPIC|sys:yes|think:yes|tools:") && got.text.includes("|schema:yes|result:") && got.steps === "列目录:done",
  JSON.stringify(got)
);
check("thinking shown as 思绪", got.thought.includes("想一想先看目录"), got.thought);
const usage = await evalJs(`__yanState().conversations[0].messages.at(-1).tokenCount`);
check("usage summed from both rounds (12+9 + 30+11)", usage === 62, JSON.stringify(usage));
// 设置页：接口类型可选；测试连接走 /v1/models
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
await evalJs(`document.querySelector('.tab-btn[data-tab="models"]').click(); true`);
await sleep(300);
check(
  "settings: 接口 shows Anthropic selected",
  await evalJs(
    `document.querySelector('[data-profile-card="p1"] [data-choice-field="api"][data-value="anthropic"]').classList.contains("active")`
  )
);
await evalJs(`document.querySelector('[data-profile-card="p1"] [data-profile-action="test"]').click(); true`);
await waitFor(`document.querySelector('[data-profile-card="p1"] .profile-status').textContent.startsWith("可用")`, 8000);
check("test connection via /v1/models works", true);
close();
