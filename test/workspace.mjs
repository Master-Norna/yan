// 工作区：游目里的一层，看某一处目录——簿录、走层、查找、路径、空态，以及顶栏那一枚与地址行下那一对的分工。
// 不含「点一件去开」那一段（要真浏览器，见 test/stage.mjs）；也不碰系统的选夹子窗：进来之前先把绑过的目录写进 localStorage。
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
// 工作区的实情（页面脚本包在闭包里读不到变量，只好看 DOM 与本机记下的那一份）：断言不过时一并写出来，省得再猜
const workState = () =>
  evalJs(
    `JSON.stringify({ stored: localStorage.getItem("yan-work-root") || "", crumbs: document.querySelector("#workCrumbs")?.textContent || "", facts: document.querySelector("#workFacts")?.textContent || "", rows: [...document.querySelectorAll("#workStrips .strip-name strong")].map(el => el.textContent), said: document.querySelector("#workStrips").textContent.trim().slice(0, 90), hidden: document.querySelector("#stageWork").classList.contains("hidden") })`
  );

const ROOT = `${TMP}/工作区`,
  HOME_SETTINGS = {
    version: 5,
    settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, mcpServers: {} },
    profiles: [
      {
        id: "p1",
        source: "custom",
        name: "假模型",
        model: "fake",
        baseUrl: "http://127.0.0.1:8798/v1",
        apiKey: "k",
        temperature: 0.7,
        quota: "",
        usedTokens: 0
      }
    ],
    conversations: [],
    library: [],
    drafts: {}
  };
mkdirSync(`${ROOT}/子夹`, { recursive: true });
writeFileSync(`${ROOT}/笔记.md`, "# 笔记\n\n工作区里的这一份。\n");
writeFileSync(`${ROOT}/一页.txt`, "只有一页字。\n");
writeFileSync(`${ROOT}/子夹/深.md`, "# 深一层\n");

await send("Page.navigate", { url: `${PAGE}preview.html` });
await sleep(400);
await evalJs(
  `localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(HOME_SETTINGS))}); localStorage.setItem("yan-work-root", ${JSON.stringify(ROOT)}); true`
);
await send("Page.navigate", { url: PAGE });
await evalJs(
  `window.__yanExceptions = []; window.addEventListener("error", e => window.__yanExceptions.push(String(e.error || e.message))); window.addEventListener("unhandledrejection", e => window.__yanExceptions.push(String(e.reason))); true`
);

// 打开游目（没有浏览器，入口那一笔是藏着的；点它照旧开面板），再点顶栏那一枚
await evalJs(`document.querySelector("#stagePin").click(); document.querySelector("#stageWorkBtn").click(); true`);
await waitFor(`document.querySelectorAll("#workStrips .strip").length >= 3`, 8000).catch(() => {});

const names = await evalJs(`[...document.querySelectorAll("#workStrips .strip-name strong")].map(el => el.textContent)`);
check("工作区列出这一层：夹在前、件在后", JSON.stringify(names) === JSON.stringify(["子夹", "一页.txt", "笔记.md"]), JSON.stringify(names));
check("地址行写这一层目录", await evalJs(`document.querySelector("#stageAddr").textContent.includes("工作区")`));
check("件数与小计在路径行上", await evalJs(`/\\d+ 件 · /.test(document.querySelector("#workFacts").textContent)`));
check("工作区里不挂收藏（没有「这一页」可收）", await evalJs(`document.querySelector("#stageMarks").classList.contains("hidden")`));
check(
  "顶栏那一枚不表态，表态的是地址行下那一对",
  await evalJs(
    `!document.querySelector("#stageWorkBtn").hasAttribute("aria-pressed") && [...document.querySelectorAll("#stageWork [data-work-mode]")].filter(b => b.getAttribute("aria-pressed") === "true").length === 1`
  )
);

// 走层：点夹子下去，点路径回来
await evalJs(`document.querySelector("#workStrips .strip.dir").click(); true`);
await waitFor(`[...document.querySelectorAll("#workStrips .strip-name strong")].some(el => el.textContent === "深.md")`, 8000).catch(
  () => {}
);
check(
  "点夹子下到那一层",
  await evalJs(`[...document.querySelectorAll("#workStrips .strip-name strong")].some(el => el.textContent === "深.md")`)
);
check("路径里多了一级", await evalJs(`document.querySelector("#workCrumbs .here").textContent === "子夹"`));
// 那一级要写整条绝对路径：POSIX 上丢了开头的 / 就成了相对路径，点下去整块工作区空掉（macOS 上踩过）
const crumbAt = await evalJs(
  `[...document.querySelectorAll('#workCrumbs [data-work-dir]')].find(b => b.textContent === '工作区')?.dataset.workDir || ""`
);
check("路径里那一级写的是整条绝对路径", crumbAt === ROOT, `${JSON.stringify(crumbAt)} vs ${JSON.stringify(ROOT)}`);
await evalJs(`[...document.querySelectorAll('#workCrumbs [data-work-dir]')].find(b => b.textContent === '工作区').click(); true`);
await waitFor(`document.querySelector("#workCrumbs .here")?.textContent === "工作区"`, 8000).catch(() => {});
check("点路径回到上一层", await evalJs(`document.querySelector("#workCrumbs .here").textContent === "工作区"`));
await waitFor(`document.querySelectorAll("#workStrips .strip").length >= 3`, 8000).catch(() => {});
check("回到上一层，簿录又是这一层的三件", await evalJs(`document.querySelectorAll("#workStrips .strip").length >= 3`), await workState());

// 查找：跨层平铺，没了的夹子不再列
await evalJs(
  `(() => { const field = document.querySelector("#workFind"); field.value = "深"; field.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`
);
await waitFor(`document.querySelectorAll("#workStrips .strip").length === 1`, 8000).catch(() => {});
const found = await evalJs(`[...document.querySelectorAll("#workStrips .strip-name strong")].map(el => el.textContent)`);
check(
  "查找跨层：深处那一件也找得到，名字前注着它所在的层",
  JSON.stringify(found) === JSON.stringify(["子夹/深.md"]),
  `${JSON.stringify(found)} · ${await workState()}`
);
await evalJs(
  `(() => { const field = document.querySelector("#workFind"); field.value = ""; field.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`
);

// 改动那一面：没有对话，也就没有改过的件；两枚里仍只有一枚朱
await evalJs(`document.querySelector('#stageWork [data-work-mode="changes"]').click(); true`);
await waitFor(`/还没改过文件/.test(document.querySelector("#workStrips").textContent)`, 8000).catch(() => {});
check(
  "改动那一面此时空着",
  await evalJs(`/还没改过文件/.test(document.querySelector("#workStrips").textContent)`),
  `${await evalJs('document.querySelector("#workStrips").textContent.slice(0, 80)')} · ${await workState()}`
);
check(
  "切到改动：仍只有一枚选着",
  await evalJs(
    `[...document.querySelectorAll("#stageWork [data-work-mode]")].filter(b => b.getAttribute("aria-pressed") === "true").length === 1`
  )
);
await evalJs(`document.querySelector('#stageWork [data-work-mode="list"]').click(); true`);
await waitFor(`document.querySelectorAll("#workStrips .strip").length >= 3`, 8000).catch(() => {});
check("再点第一枚回到整层", await evalJs(`document.querySelectorAll("#workStrips .strip").length >= 3`), await workState());

// 地址行：点开即改，写着这一层的整条路径
await evalJs(`document.querySelector("#stageAddr").click(); true`);
const addrValue = await evalJs(`document.querySelector("#stageUrl").value`);
check(
  "地址行里写的是这一层的整条路径",
  addrValue === ROOT,
  `${JSON.stringify(addrValue)} vs ${JSON.stringify(ROOT)} · ${await workState()}`
);
await evalJs(`document.querySelector("#stageUrl").blur(); true`);

// 调律那张纸签里不再有「打开本机文件」
await evalJs(`document.querySelector("#stageMenuBtn").click(); true`);
await sleep(300);
check("纸签里不再有「打开本机文件」", await evalJs(`!document.body.textContent.includes("打开本机文件")`));
await evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);

// 改动那一面：本段对话改过的件，件图自己换色——石绿新建、泥金改、朱删（盘上已经没有的那件）
writeFileSync(`${ROOT}/新建.md`, "# 新建\n");
writeFileSync(`${ROOT}/.gitignore`, "dist\n");
await fetch(`${PAGE}api/chats/save`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: "work-changes",
      title: "工作区改动",
      createdAt: "2026-11-27",
      updatedAt: new Date().toISOString(),
      workdir: ROOT,
      forks: [],
      threads: [],
      messages: [
        { id: "u", role: "user", content: "改一改这三件。", timestamp: "2026-11-27" },
        {
          id: "a",
          role: "assistant",
          content: "改好了。",
          status: "complete",
          work: true,
          timestamp: "2026-11-27",
          steps: [
            {
              id: "c1",
              name: "write_file",
              arguments: "{}",
              status: "done",
              at: 1,
              title: "新建.md",
              result: "已写入",
              change: { path: `${ROOT}/新建.md`, added: 3, removed: 0, created: true }
            },
            {
              id: "c2",
              name: "edit_file",
              arguments: "{}",
              status: "done",
              at: 2,
              title: ".gitignore",
              result: "已修改",
              change: { path: `${ROOT}/.gitignore`, added: 2, removed: 1 }
            },
            {
              id: "c3",
              name: "write_file",
              arguments: "{}",
              status: "done",
              at: 3,
              title: "旧件.md",
              result: "已写入",
              change: { path: `${ROOT}/旧件.md`, added: 5, removed: 0 }
            }
          ]
        }
      ]
    }
  })
});
await send("Page.navigate", { url: PAGE });
await evalJs(
  `window.__yanExceptions = []; window.addEventListener("error", e => window.__yanExceptions.push(String(e.error || e.message))); window.addEventListener("unhandledrejection", e => window.__yanExceptions.push(String(e.reason))); true`
);
await waitFor(`!!document.querySelector('[data-conversation="work-changes"]')`, 10000).catch(() => {});
await evalJs(`document.querySelector('[data-conversation="work-changes"] .history-open').click(); true`);
await waitFor(`__yanState().conversations.length === 1`, 8000).catch(() => {});
await evalJs(`document.querySelector("#stagePin").click(); true`);
await sleep(300);
await evalJs(`document.querySelector("#stageWorkBtn").click(); true`);
await evalJs(`document.querySelector('#stageWork [data-work-mode="changes"]').click(); true`);
await waitFor(`document.querySelectorAll("#workStrips .strip").length === 3`, 8000).catch(() => {});
const states = await evalJs(`[...document.querySelectorAll("#workStrips .fi[data-state]")].map(el => el.dataset.state).sort()`);
check(
  "改动那一面：三件各按新建 / 改 / 删上色",
  JSON.stringify(states) === JSON.stringify(["add", "del", "mod"]),
  `${JSON.stringify(states)} · ${await workState()}`
);
check(
  "改动那一面不写字（没有增删改、也没有 +几 −几）",
  await evalJs(
    `!/[+−]\\d/.test(document.querySelector("#workStrips").textContent) && !/增|删 |改 /.test(document.querySelector("#workStrips").textContent)`
  )
);
check(
  "件数与小注写的是本段对话改过",
  await evalJs(`/本段对话改过/.test(document.querySelector("#workFacts").textContent)`),
  `${await evalJs('document.querySelector("#workFacts").textContent')} · ${await workState()}`
);

check("全程没有页面异常", await evalJs(`window.__yanExceptions.length === 0`), await evalJs(`JSON.stringify(window.__yanExceptions)`));
close();
process.exit(0);
