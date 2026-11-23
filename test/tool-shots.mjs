// 工具交回的画面：假 MCP 的 snap 回一张图，连截两幅（第二幅像 Playwright 给了 filename：只落盘、回链接，桥接读回补进结果）。模型看得到最新那幅（紧跟工具结果的一条用户消息），旧的换成一行字；
// 步骤卡里露出缩略图（折着也露），原件挂在步骤上存着，点开进图片查看器
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, check, sleep, PAGE } from "./lib.mjs";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-mcp.mjs");
const { send, evalJs, waitFor, close } = await connect();
// 附件里的图：落了盘的原件照同源地址画（浏览器自己取、自己缓存），只暂存在浏览器里的才编成 data: URL。
// 两样都算「画出来了」——断言认的是这一点，不是取图走哪条路
const drawnImage = `(el => {
  const src = (el && el.getAttribute("src")) || "";
  return !!el && (src.startsWith("data:image") || src.startsWith("/api/files/raw?id="));
})`;
const seed = {
  version: 4,
  settings: {
    name: "测",
    theme: "light",
    inkMotion: "off",
    activeProfileId: "p1",
    autoTitle: false,
    // 测试用截图工具由用户显式信任为只读；不能依赖服务端自报的 readOnlyHint。
    mcpServers: { cam: { command: process.execPath, args: [FAKE, "--snap"], readOnlyTools: ["snap"] } }
  },
  profiles: [
    {
      id: "p1",
      source: "custom",
      name: "假模型",
      model: "fake",
      baseUrl: "http://127.0.0.1:8798/v1",
      apiKey: "k",
      temperature: 0.7,
      maxTokens: 8192,
      quota: "",
      usedTokens: 0,
      systemPrompt: ""
    }
  ],
  // 一段带游目圈点引文的旧对话：画面是随引文的附件（原件不在也照样画出位置）
  conversations: [
    {
      id: "q1",
      title: "圈点",
      forks: [],
      threads: [],
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      profileId: "p1",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "这一季为什么涨这么多？",
          timestamp: "2026-10-02T00:00:00.000Z",
          attachments: [
            { id: "img1", kind: "image", name: "游目 · example.com.jpg", mime: "image/jpeg", size: 100, quoted: true },
            { id: "doc1", kind: "text", name: "笔记.txt", mime: "text/plain", size: 10 }
          ],
          quote: {
            text: "游目 · example.com　圈「营收」",
            model: "游目 · https://example.com/",
            url: "https://example.com/",
            image: "img1"
          }
        },
        { id: "a1", role: "assistant", content: "好的。", timestamp: "2026-10-02T00:00:01.000Z", status: "complete" }
      ]
    }
  ],
  library: [],
  drafts: {}
};
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(seed))}); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1500);
const lastAssistant = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`;
await evalJs(
  `document.querySelector("#welcomeInput").value = "MCPSHOT 截两幅"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`${lastAssistant}?.dataset.status === "complete"`, 60000);
const reply = await evalJs(`${lastAssistant}.textContent`);
check("only the latest picture rides along, right after the tool results", /images:1\|tail:true/.test(reply), reply.slice(0, 200));
check("the earlier picture is replaced by a line of text", /stale:true/.test(reply), reply.slice(0, 200));
check("the picture goes to the model as a data: url", /png:true/.test(reply), reply.slice(0, 200));
check("the tool result tells the model the picture's name and how to show it", /named:true/.test(reply), reply.slice(0, 200));
await waitFor(`${drawnImage}(${lastAssistant}.querySelector(".markdown .reply-shot img"))`, 8000).catch(() => {});
check(
  "a picture the reply refers to by name is drawn right in the reply",
  await evalJs(
    `(img => ${drawnImage}(img) && img.complete && img.naturalWidth > 0)(${lastAssistant}.querySelector(".markdown .reply-shot[data-open-image] img"))`
  )
);
const steps = JSON.parse(
  await evalJs(
    `JSON.stringify(__yanState().conversations[0].messages.at(-1).steps.map(s => ({ name: s.name, files: s.attachments || [] })))`
  )
);
check(
  "each snap step keeps its picture as an attachment (metadata only in the conversation)",
  steps.length === 2 && steps.every(s => s.files.length === 1 && s.files[0].kind === "image" && s.files[0].data === undefined),
  JSON.stringify(steps).slice(0, 300)
);
await waitFor(
  `${lastAssistant}.querySelectorAll(".tool-shot img").length === 2 && [...${lastAssistant}.querySelectorAll(".tool-shot img")].every(${drawnImage})`,
  10000
).catch(() => {});
const shots = await evalJs(
  `[...${lastAssistant}.querySelectorAll(".tool-shot")].map(el => ({ src: (el.querySelector("img").getAttribute("src") || "").slice(0, 22), shown: el.getBoundingClientRect().height > 0 }))`
);
check(
  "trail shows a thumbnail per picture, visible even with the step folded",
  shots.length === 2 && shots.every(s => s.shown && (s.src.startsWith("data:image/png;base64,") || s.src.startsWith("/api/files/raw?id="))),
  JSON.stringify(shots)
);
await evalJs(`${lastAssistant}.querySelector(".tool-shot").click(); true`);
await waitFor(`!document.querySelector("#imageViewer")?.classList.contains("hidden")`, 5000).catch(() => {});
check("clicking a thumbnail opens the image viewer", await evalJs(`!document.querySelector("#imageViewer")?.classList.contains("hidden")`));

// 带画面的引文：发出后字在上、图在下，随问句靠右；那幅不在件条里再列一回，别的附件照常
await evalJs(`document.querySelector("#imageViewerClose").click(); true`);
await evalJs(`document.querySelector('#history [data-conversation="q1"]')?.click(); true`);
await waitFor(`!!document.querySelector('#messages [data-message="u1"]')`, 8000).catch(() => {});
const quoted = await evalJs(
  `(m => ({ shot: !!m.querySelector(".user-quote.has-shot .quote-shot[data-open-image='img1']"), files: [...m.querySelectorAll(".sent-attachments .attachment-name")].map(n => n.textContent) }))(document.querySelector('#messages [data-message="u1"]'))`
);
check(
  "a quote with a picture draws it inside the quote; only the other attachments stay as cards",
  quoted.shot && quoted.files.length === 1 && quoted.files[0] === "笔记.txt",
  JSON.stringify(quoted)
);
await close();
process.exit(0);
