// 工作区：游目里的一层，看某一处目录——簿录、走层、路径、空态，以及顶栏那一枚与地址行下那一对的分工。
// 不含「点一件去开」那一段（要真浏览器，见 test/stage.mjs）；言模式从卷宗进入，沿路径走到测试目录。
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, ARCHIVE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
// 工作区的实情（页面脚本包在闭包里读不到变量，只好看 DOM）：断言不过时一并写出来，省得再猜
const workState = () =>
  evalJs(
    `JSON.stringify({ crumbs: document.querySelector("#workCrumbs")?.textContent || "", rows: [...document.querySelectorAll("#workStrips .strip-name strong")].map(el => el.textContent), said: document.querySelector("#workStrips").textContent.trim().slice(0, 90), hidden: document.querySelector("#stageWork").classList.contains("hidden") })`
  );

const ROOT = `${ARCHIVE}/工作区`,
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
mkdirSync(`${ROOT}/空夹`, { recursive: true });
writeFileSync(`${ROOT}/笔记.md`, "# 笔记\n\n工作区里的这一份。\n");
writeFileSync(`${ROOT}/一页.txt`, "只有一页字。\n");
writeFileSync(`${ROOT}/子夹/深.md`, "# 深一层\n");

await send("Page.navigate", { url: `${PAGE}preview.html` });
await sleep(400);
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(HOME_SETTINGS))}); true`);
await send("Page.navigate", { url: PAGE });
await evalJs(
  `window.__yanExceptions = []; window.addEventListener("error", e => window.__yanExceptions.push(String(e.error || e.message))); window.addEventListener("unhandledrejection", e => window.__yanExceptions.push(String(e.reason))); true`
);

// 打开游目（没有浏览器，入口那一笔是藏着的；点它照旧开面板），再点顶栏那一枚
await evalJs(`document.querySelector("#stagePin").click(); document.querySelector("#stageWorkBtn").click(); true`);
await waitFor(`[...document.querySelectorAll("#workStrips .strip.dir")].some(el => el.querySelector("strong")?.textContent === "工作区")`);
check("言模式默认打开卷宗", await evalJs(`document.querySelector("#workCrumbs .here")?.textContent === "卷宗"`));
await evalJs(`[...document.querySelectorAll("#workStrips .strip.dir")].find(el => el.querySelector("strong")?.textContent === "工作区").click(); true`);
await waitFor(`document.querySelectorAll("#workStrips .strip").length >= 3`, 8000).catch(() => {});

const names = await evalJs(`[...document.querySelectorAll("#workStrips .strip-name strong")].map(el => el.textContent)`);
check("工作区列出这一层：夹在前、件在后", JSON.stringify(names) === JSON.stringify(["空夹", "子夹", "一页.txt", "笔记.md"]), JSON.stringify(names));
check("路径行写这一层目录", await evalJs(`document.querySelector("#workCrumbs .here").textContent === "工作区"`));
check(
  "工作区的图形切换在路径工具行，文件夹入口不添分隔线",
  await evalJs(
    `document.querySelector('#stageWorkBtn svg').dataset.brush === 'folder' && !document.querySelector('.stage-tool-sep') && document.querySelectorAll('#stageWork .work-bar [data-work-mode] svg').length === 2 && [...document.querySelectorAll('#stageWork [data-work-mode]')].every(b => !b.textContent.trim() && b.getAttribute('aria-label'))`
  )
);
check("路径行只留路径和切换，不另列查找与统计", await evalJs(`!document.querySelector("#workFind, #workFacts")`));
check("浏览器未开时工作区独占，浏览器导航不出现", await evalJs(`document.querySelector("#stageBrowser").classList.contains("hidden")`));
check(
  "顶栏文件夹显示打开，路径行只选中一种视图",
  await evalJs(
    `document.querySelector("#stageWorkBtn").getAttribute("aria-pressed") === "true" && [...document.querySelectorAll("#stageWork [data-work-mode]")].filter(b => b.getAttribute("aria-pressed") === "true").length === 1`
  )
);

// 走层：点夹子下去，点路径回来
check(
  "换层时旧列表立即收起，不能拿新根拼旧文件名",
  await evalJs(`[...document.querySelectorAll("#workStrips .strip.dir")].find(el => el.querySelector("strong")?.textContent === "子夹").click(); !document.querySelector("#workStrips [data-work-file]")`)
);
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

// 空目录用游目空台样式，没有重复的返回箭头。
await evalJs(`[...document.querySelectorAll("#workStrips .strip.dir")].find(el => el.querySelector("strong")?.textContent === "空夹").click(); true`);
await waitFor(`document.querySelector("#workStrips .work-empty")?.textContent.includes("此层尚空")`);
check("空目录居中件图、只留路径导航", await evalJs(`!!document.querySelector("#workStrips .stage-empty .work-leaf") && !document.querySelector("#workStrips .strip-back")`));
await evalJs(`[...document.querySelectorAll('#workCrumbs [data-work-dir]')].find(b => b.textContent === '工作区').click(); true`);
await waitFor(`document.querySelector("#workCrumbs .here")?.textContent === "工作区"`);

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

// 工作区开合不改浏览器网址，重新展开保持目录。
await evalJs(`document.querySelector("#stageWorkBtn").click(); true`);
check("收起后文件夹取消选中", await evalJs(`document.querySelector("#stageWorkBtn").getAttribute("aria-pressed") === "false"`));
await evalJs(`document.querySelector("#stageWorkBtn").click(); true`);
await waitFor(`document.querySelector("#workCrumbs .here")?.textContent === "工作区"`);

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
await waitFor(`document.querySelector("#workCrumbs .here")?.title === ${JSON.stringify(ROOT)}`, 8000).catch(() => {});
check(
  "对话已绑目录时跟随它，而不是卷宗",
  await evalJs(`document.querySelector("#workCrumbs .here")?.title === ${JSON.stringify(ROOT)}`)
);
await waitFor(`[...document.querySelectorAll("#workStrips .strip.dir")].some(el => el.querySelector("strong")?.textContent === "空夹")`);
await evalJs(
  `[...document.querySelectorAll("#workStrips .strip.dir")].find(el => el.querySelector("strong")?.textContent === "空夹").click(); true`
);
await evalJs(`document.querySelector('#stageWork [data-work-mode="changes"]').click(); true`);
await waitFor(`document.querySelectorAll("#workStrips .strip").length === 3`, 8000).catch(() => {});
const states = await evalJs(`[...document.querySelectorAll("#workStrips .fi[data-state]")].map(el => el.dataset.state).sort()`);
check(
  "改动那一面：三件各按新建 / 改 / 删上色",
  JSON.stringify(states) === JSON.stringify(["add", "del", "mod"]),
  `${JSON.stringify(states)} · ${await workState()}`
);
check(
  "改动沿用件图着色，无额外条首色线",
  await evalJs(
    `new Set([...document.querySelectorAll('#workStrips .fi[data-state]')].map(el => getComputedStyle(el).getPropertyValue('--fc').trim())).size === 3 && !document.querySelector('#workStrips [data-change]')`
  )
);
check(
  "改动那一面不写字（没有增删改、也没有 +几 −几）",
  await evalJs(
    `!/[+−]\\d/.test(document.querySelector("#workStrips").textContent) && !/增|删 |改 /.test(document.querySelector("#workStrips").textContent)`
  )
);
await evalJs(`document.querySelector('#stageWork [data-work-mode="list"]').click(); true`);
check("切回目录仍停在原来的空夹", await evalJs(`document.querySelector("#workCrumbs .here")?.textContent === "空夹"`));
check("全程没有页面异常", await evalJs(`window.__yanExceptions.length === 0`), await evalJs(`JSON.stringify(window.__yanExceptions)`));
close();
process.exit(0);
