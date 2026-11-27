// 简约模式：设置持久化、流式思绪默认折起、手动开合仍生效。
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(`document.querySelector("#openSettings").click(); document.querySelector('[data-tab="appearance"]').click(); true`);
const on = `document.querySelector('[data-setting="compactTrail"][data-value="true"]')`,
  off = `document.querySelector('[data-setting="compactTrail"][data-value="false"]')`;
check("compact mode is off by default", await evalJs(`${off}.classList.contains("active")`));
await evalJs(`${on}.click(); true`);
check("compact mode is selected and saved", await evalJs(`${on}.classList.contains("active") && __yanState().settings.compactTrail === true`));
await shot("compact-trail-settings.png");
await evalJs(`document.querySelector("#closeSettings").click(); true`);
const last = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`,
  reasoning = `${last}?.querySelector(":scope .assistant-block > .reasoning")`;
await evalJs(
  `document.querySelector("#welcomeInput").value = "LONGTHINK 想想"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`${reasoning}?.dataset.state === "live"`, 10000);
check("live thinking defaults to closed", await evalJs(`${reasoning}.open === false`));
await evalJs(`${reasoning}.querySelector("summary").click(); true`);
check("manual expansion works", await evalJs(`${reasoning}.open`));
await waitFor(`${last}?.dataset.status === "complete"`, 20000);
check("manual expansion survives subsequent updates", await evalJs(`${reasoning}.open`));
await close();
process.exit(0);
