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
check(
  "compact mode is selected and saved",
  await evalJs(`${on}.classList.contains("active") && __yanState().settings.compactTrail === true`)
);
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
// 同一份行迹：整段保持摊开，原先自动摊开的文件差异与目录清单收起，计划卡不变。
await fetch(PAGE + "api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: "compact-fixture",
      title: "简约行迹",
      createdAt: "2026-09-28",
      updatedAt: new Date().toISOString(),
      forks: [],
      threads: [],
      messages: [
        { id: "compact-u", role: "user", content: "修改文件并查看目录", timestamp: "2026-09-28" },
        {
          id: "compact-a",
          role: "assistant",
          content: "已完成。",
          status: "complete",
          timestamp: "2026-09-28",
          toolsTouched: true,
          toolsOpen: true,
          steps: [
            {
              id: "compact-diff",
              name: "edit_file",
              arguments: JSON.stringify({ path: "a.js", old: "let a = 1;", new: "let a = 2;" }),
              title: "a.js",
              status: "done",
              result: "已修改"
            },
            {
              id: "compact-list",
              name: "list_files",
              arguments: "{}",
              title: ".",
              status: "done",
              output: "a.js\nb.js",
              result: "2 件"
            },
            {
              id: "compact-plan",
              name: "update_plan",
              arguments: "{}",
              title: "计划",
              status: "done",
              plan: [{ text: "修改文件", status: "done" }]
            }
          ]
        }
      ]
    }
  })
});
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="compact-fixture"]')`, 10000);
await evalJs(`document.querySelector('[data-conversation="compact-fixture"] .history-open').click(); true`);
await waitFor(`!!document.querySelector('[data-step-id="compact-diff"]')`, 8000);
const diff = `document.querySelector('[data-step-id="compact-diff"]')`,
  list = `document.querySelector('[data-step-id="compact-list"]')`,
  stack = `document.querySelector('[data-message="compact-a"] .tool-stack')`;
check("compact mode persists on reload", await evalJs(`__yanState().settings.compactTrail === true`));
check("the enclosing Steps timeline stays open", await evalJs(`${stack}.open`));
check(
  "diff and directory details default to closed",
  await evalJs(`${diff}.classList.contains("folded") && ${list}.classList.contains("folded")`)
);
check("plan is not folded", await evalJs(`!document.querySelector('[data-step-id="compact-plan"]').classList.contains("folded")`));
await evalJs(`${diff}.querySelector(".tool-step-head").click(); true`);
check("individual details can be expanded", await evalJs(`!${diff}.classList.contains("folded")`));
await evalJs(
  `document.querySelector("#openSettings").click(); document.querySelector('[data-tab="appearance"]').click(); ${off}.click(); true`
);
check("turning compact mode off restores normal defaults", await evalJs(`!${list}.classList.contains("folded") && ${stack}.open`));
await close();
process.exit(0);
