// 简约模式：设置持久化、流式思绪默认折起、手动开合仍生效、键盘可到达截图。
import { fileURLToPath } from "node:url";
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
const fakeMcp = JSON.stringify([fileURLToPath(new URL("./fake-mcp.mjs", import.meta.url)), "--snap"]);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, mcpServers: { cam: { command: ${JSON.stringify(process.execPath)}, args: ${fakeMcp}, readOnlyTools: ["snap"] } } }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
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
async function keypress(key, code, windowsVirtualKeyCode) {
  const text = key === "Enter" ? "\r" : key === " " ? " " : "";
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode, text });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}
// 第一段思绪进了行迹，仍是刚才手动打开的那一段；下一组不借这个开合状态。
await evalJs(`(() => {
  const input = document.querySelector("#chatInput");
  input.value = "THOUGHTHANDOFF";
  input.dispatchEvent(new Event("input"));
  document.querySelector("#chatSend").click();
  return true;
})()`);
const oldThought = `${last}?.querySelector(".assistant-block > .reasoning")`,
  trailThoughts = `${last}?.querySelectorAll(".tool-stack .trail-reasoning")`;
await waitFor(`${oldThought}?.textContent.includes("先想一想")`, 10000);
await evalJs(`${oldThought}.querySelector("summary").click(); true`);
await waitFor(`${trailThoughts}[0]?.textContent.includes("接着原来的思路")`, 10000);
check("manual expansion follows the first thought into the live timeline", await evalJs(`${trailThoughts}[0].open`));
const liveShot = `${last}?.querySelector(".tool-shot")`,
  liveShotHead = `${last}?.querySelector(".compact-shots > .tool-step-head")`;
await waitFor(`!!${liveShotHead}`, 8000);
await evalJs(`${liveShotHead}.focus(); true`);
await keypress("Enter", "Enter", 13);
await keypress("Tab", "Tab", 9);
check(
  "keyboard reaches the screenshot before the next tool starts",
  await evalJs(`(window.liveShot = ${liveShot}) === document.activeElement && !${last}.querySelector('[data-tool="run_js"]')`)
);
await waitFor(`!!${last}?.querySelector('[data-tool="run_js"]')`, 8000);
check(
  "the next tool step leaves keyboard focus on the original screenshot",
  await evalJs(`${last}.dataset.status === "streaming" && window.liveShot === ${liveShot} && window.liveShot === document.activeElement`)
);
await waitFor(`${last}?.dataset.status === "complete"`, 10000);
check(
  "only the first timeline thought inherits manual expansion",
  await evalJs(
    `${trailThoughts}[0]?.open === true && ${trailThoughts}[1]?.open === false && ${trailThoughts}[1].textContent.includes("另一段思绪")`
  )
);
const tailThought = `${last}?.querySelector(".assistant-block > .reasoning")`;
check(
  "the separate final thought does not inherit the first thought's state",
  await evalJs(`${tailThought}?.textContent.includes("末轮另外想") && !${tailThought}.open`)
);
const originalReply = await evalJs(`${last}.dataset.message`),
  originalConversation = await evalJs(
    `__yanState().conversations.find(c => c.messages.some(m => m.id === ${JSON.stringify(originalReply)})).id`
  );
// 同一份行迹：整段保持摊开，原先自动摊开的文件差异与目录清单收起，计划卡不变。
const image = { id: "compact-image", kind: "image", name: "截图.png" },
  header = Buffer.from(JSON.stringify({ record: image })),
  pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const uploaded = await fetch(`${PAGE}api/files/put?head=${header.length}`, { method: "POST", body: Buffer.concat([header, pixel]) });
if (!uploaded.ok) throw Error(`Cannot seed screenshot: ${await uploaded.text()}`);
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
              id: "compact-shot",
              name: "mcp__test__screenshot",
              arguments: "{}",
              title: "截图",
              status: "done",
              attachments: [image]
            },
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
// 整页重开后从磁盘读回这一答，不借上次的 DOM 或内存。
await waitFor(`!!document.querySelector('[data-conversation="${originalConversation}"] .history-open')`, 10000);
await evalJs(`document.querySelector('[data-conversation="${originalConversation}"] .history-open').click(); true`);
await waitFor(
  `${last}?.dataset.message === ${JSON.stringify(originalReply)} && !!${tailThought}?.textContent.includes("末轮另外想")`,
  8000
);
const thoughtStack = `${last}.querySelector(".tool-stack")`;
await evalJs(`if (!${thoughtStack}.open) ${thoughtStack}.querySelector("summary").click(); true`);
check(
  "remount preserves the first thought's expansion without opening the final thought",
  await evalJs(`${trailThoughts}[0]?.open === true && ${tailThought}.open === false`)
);

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
const screenshot = `document.querySelector('[data-step-id="compact-shot"] .tool-shot')`,
  shotHead = `document.querySelector('[data-step-id="compact-shot"] .tool-step-head')`;
check("compact mode hides the screenshot until expanded", await evalJs(`${screenshot}.getClientRects().length === 0`));
await evalJs(`${stack}.querySelector("summary").focus(); true`);
await keypress("Tab", "Tab", 9);
const headFocused = `document.activeElement === ${shotHead}`,
  shotFocused = `document.activeElement === ${screenshot}`;
check("Tab reaches a collapsed screenshot step", await evalJs(`${headFocused} && ${shotHead}.getAttribute("aria-expanded") === "false"`));
// 如果 Tab 落到别处，不在无关控件上继续按键，让失败留在该断言。
if (await evalJs(headFocused)) {
  await keypress("Enter", "Enter", 13);
  check(
    "Enter expands the screenshot step",
    await evalJs(`${shotHead}.getAttribute("aria-expanded") === "true" && ${screenshot}.getClientRects().length > 0`)
  );
  await keypress(" ", "Space", 32);
  check(
    "Space collapses the same step",
    await evalJs(`${shotHead}.getAttribute("aria-expanded") === "false" && ${screenshot}.getClientRects().length === 0`)
  );
  await keypress(" ", "Space", 32);
  await keypress("Tab", "Tab", 9);
  check("Tab reaches the revealed screenshot", await evalJs(shotFocused));
  if (await evalJs(shotFocused)) {
    await keypress("Enter", "Enter", 13);
    const imageOpen = `!document.querySelector("#imageViewer").classList.contains("hidden") && document.querySelector("#imageViewerImage").naturalWidth === 1`;
    await waitFor(imageOpen, 3000).catch(() => {});
    check("keyboard opens the screenshot viewer", await evalJs(imageOpen));
    if (await evalJs(imageOpen)) {
      await keypress("Escape", "Escape", 27);
      await waitFor(`document.querySelector("#imageViewer").classList.contains("hidden")`, 3000);
    }
  }
}
await evalJs(`${diff}.querySelector(".tool-step-head").click(); true`);
check("individual details can be expanded", await evalJs(`!${diff}.classList.contains("folded")`));
await evalJs(
  `document.querySelector("#openSettings").click(); document.querySelector('[data-tab="appearance"]').click(); ${off}.click(); true`
);
check("turning compact mode off restores normal defaults", await evalJs(`!${list}.classList.contains("folded") && ${stack}.open`));
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await evalJs(`${stack}.querySelector("summary").focus(); true`);
await keypress("Tab", "Tab", 9);
check("normal mode still reaches the screenshot directly", await evalJs(shotFocused));
await close();
process.exit(0);
