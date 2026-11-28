// 工作区：独立树、页签、预览、搜索、命令区与浏览器切换。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { officeZipFixture } from "./helpers/office-zip.mjs";
import { createRequire } from "node:module";
const { readOffice } = createRequire(import.meta.url)("../server/work/office.js");
import { connect, check, sleep, PAGE, ARCHIVE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
// 工作区的实情（页面脚本包在闭包里读不到变量，只好看 DOM）：断言不过时一并写出来，省得再猜
const workState = () =>
  evalJs(
    `JSON.stringify({ crumbs: document.querySelector("#workCrumbs")?.textContent || "", rows: [...document.querySelectorAll("#workStrips .work-row strong")].map(el => el.textContent), said: document.querySelector("#workStrips").textContent.trim().slice(0, 90), hidden: document.querySelector("#stageWork").classList.contains("hidden") })`
  );

const dirNamed = name =>
    `[...document.querySelectorAll("#workStrips [data-work-dir]")].find(el => el.querySelector("strong")?.textContent === ${JSON.stringify(name)})`,
  openDir = name => evalJs(`${dirNamed(name)}.click(); true`),
  waitDir = name => waitFor(`!!${dirNamed(name)}`);

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

const wordNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const sheetNS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const wordPart = '<w:document xmlns:w="' + wordNS + '"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>原文字</w:t></w:r></w:p></w:body></w:document>';
const sheetPart = '<worksheet xmlns="' + sheetNS + '"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c><c r="C1"><f>1+1</f><v>2</v></c><c r="D1"><v>10</v></c></row></sheetData></worksheet>';
const sharedPart = '<sst xmlns="' + sheetNS + '" count="2" uniqueCount="1"><si><t>共享原值</t></si></sst>';
writeFileSync(ROOT + "/编辑.docx", officeZipFixture({ "word/document.xml": wordPart, "word/styles.xml": "<styles/>" }));
writeFileSync(ROOT + "/编辑.xlsx", officeZipFixture({ "xl/worksheets/sheet1.xml": sheetPart, "xl/sharedStrings.xml": sharedPart }));


await send("Page.navigate", { url: `${PAGE}preview.html` });
await sleep(400);
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(HOME_SETTINGS))}); true`);
await send("Page.navigate", { url: PAGE });
await evalJs(
  `window.__yanExceptions = []; window.addEventListener("error", e => window.__yanExceptions.push(String(e.error || e.message))); window.addEventListener("unhandledrejection", e => window.__yanExceptions.push(String(e.reason))); true`
);

// 没有浏览器也能打开游目。
await waitFor(`!document.querySelector("#stagePin").classList.contains("hidden")`);
await evalJs(`document.querySelector("#stagePin").click(); document.querySelector("#stageWorkBtn").click(); true`);
await waitDir("工作区");
check("言模式默认打开卷宗", await evalJs(`document.querySelector("#workCrumbs .here")?.textContent === "卷宗"`));
check("工作区入口在网页签左边", await evalJs(`document.querySelector("#stageWorkBtn").nextElementSibling.id === "stageTabs"`));
await openDir("工作区");
await waitDir("子夹");
check("展开子目录保留父级", await evalJs(`!!${dirNamed("工作区")} && ${dirNamed("工作区")}.getAttribute("aria-expanded") === "true"`));
await openDir("子夹");
await waitFor(`!!document.querySelector('[data-work-file$="/深.md"]')`);
check(
  "父级文件与子级文件同时可见",
  await evalJs(`!!document.querySelector('[data-work-file$="/深.md"]') && !!document.querySelector('[data-work-file$="/笔记.md"]')`)
);
await openDir("空夹");
await waitFor(`document.querySelector("#workStrips").textContent.includes("此层尚空")`);
await evalJs(`document.querySelector('[data-work-file$="/笔记.md"]').click(); true`);
await waitFor(`document.querySelector("#fileViewerStage h1")?.textContent === "笔记"`);
check(
  "文件只在内容区打开，目录仍可用",
  await evalJs(
    `(() => { const v=document.querySelector("#fileViewer"), p=document.querySelector("#workContent"), tree=document.querySelector(".work-explorer"), r=v.getBoundingClientRect(), q=p.getBoundingClientRect(); return v.parentElement===p && v.getAttribute("aria-modal")==="false" && Math.abs(r.width-q.width)<2 && r.left>=tree.getBoundingClientRect().right && tree.clientWidth>0 && document.querySelector("#stageBrowser").classList.contains("hidden"); })()`
  )
);
await evalJs(`document.querySelector('[data-work-raw="true"]').click(); true`);
await waitFor(`document.querySelector("#fileViewerStage pre")?.textContent.includes("# 笔记")`);
await evalJs(`document.querySelector('[data-work-raw="false"]').click(); true`);
await waitFor(`document.querySelector("#fileViewerStage h1")?.textContent === "笔记"`);
await evalJs(`document.querySelector('[data-work-file$="/一页.txt"]').click(); true`);
await waitFor(`document.querySelector("#fileViewerStage pre")?.textContent.includes("只有一页字")`);
check(
  "单击浏览只留一张临时页签",
  await evalJs(`document.querySelectorAll("#workTabs .work-tab").length === 1 && !!document.querySelector("#workTabs .work-tab-preview")`)
);
await evalJs(`document.querySelector('[data-work-file$="/笔记.md"]').click(); true`);
await waitFor(`document.querySelector("#fileViewerStage h1")?.textContent === "笔记"`);
// 真实鼠标双击，确保单击不会重建目录行而吞掉 dblclick。
const point = await evalJs(
  `(() => { const r = document.querySelector('[data-work-file$="/笔记.md"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
);
for (const clickCount of [1, 2]) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount });
}
check("双击固定临时页签", await evalJs(`!document.querySelector("#workTabs .work-tab-preview")`));
await evalJs(`document.querySelector('[data-work-file$="/一页.txt"]').click(); true`);
await waitFor(`document.querySelector("#fileViewerStage pre")?.textContent.includes("只有一页字")`);
check("文件页签同时保留", await evalJs(`document.querySelectorAll("#workTabs [data-work-tab]").length===2`));
await evalJs(`document.querySelector('#workTabs [data-work-tab="0"]').click(); true`);
await waitFor(`document.querySelector("#fileViewerStage h1")?.textContent === "笔记"`);
await evalJs(`document.querySelector("#stageWorkBtn").click(); true`);
await waitFor(`document.querySelector("#stageWork").classList.contains("hidden")`);
await evalJs(`document.querySelector("#stageWorkBtn").click(); true`);
await waitFor(`document.querySelector("#fileViewerStage h1")?.textContent === "笔记"`);
check(
  "从浏览器回来保留文件页签和目录展开状态",
  await evalJs(
    `document.querySelectorAll("#workTabs [data-work-tab]").length===2 && !!document.querySelector('[data-work-file$="/深.md"]')`
  )
);
await evalJs(`document.querySelector('[data-work-mode="list"]').click(); true`);
check(
  "目录栏可折叠，文件仍在",
  await evalJs(
    `document.querySelector(".work-explorer").clientWidth===0 && !document.querySelector("[data-work-mode][aria-pressed=true]") && !!document.querySelector("#fileViewerStage h1")`
  )
);
await evalJs(`document.querySelector('[data-work-mode="list"]').click(); true`);
await evalJs(`document.querySelector('.work-rail [data-work-terminal]').click(); true`);
check(
  "终端在内容区下方，目录常驻",
  await evalJs(
    `document.querySelector("#workTerminal").clientHeight>0 && document.querySelector(".work-explorer").clientWidth>0 && document.querySelector("#workContent").getBoundingClientRect().bottom<=document.querySelector("#workTerminal").getBoundingClientRect().top+1`
  )
);
check(
  "初始输入跟在输出后，不贴终端底部",
  await evalJs(
    `document.querySelector("#workCommand").getBoundingClientRect().top - document.querySelector("#workTerminalBody").getBoundingClientRect().top < 25`
  )
);
await evalJs(
  `(() => {const f=document.querySelector("#workCommand"); f.querySelector("input").value="echo yan-terminal-probe"; f.requestSubmit(); return true;})()`
);
await waitFor(
  `document.querySelector("#workTerminalOutput").textContent.includes("yan-terminal-probe") && !document.querySelector("#workCommand input").readOnly`,
  20000
);
check("终端能执行并接收命令输出", await evalJs(`document.querySelector("#workTerminalOutput").textContent.includes("退出码：0")`));
await evalJs(`document.querySelector("[data-work-terminal-wide]").click(); true`);
check(
  "终端展开不隐藏资源树",
  await evalJs(`document.querySelector("#workContent").clientHeight===0 && document.querySelector(".work-explorer").clientWidth>0`)
);
await evalJs(`document.querySelector("[data-work-terminal-wide]").click(); document.querySelector("[data-work-clear]").click(); true`);
check(
  "清屏不清除工作区文件",
  await evalJs(`!document.querySelector("#workTerminalOutput").textContent && !!document.querySelector("#fileViewerStage h1")`)
);
await evalJs(`document.querySelector('#workTerminal [data-work-terminal]').click(); true`);
await evalJs(
  `document.querySelector('[data-work-mode="search"]').click(); const f=document.querySelector("#workFind"); f.querySelector("input").value="只有一页字"; f.requestSubmit(); true`
);
await waitFor(`!!document.querySelector('#workStrips [data-work-file$="/一页.txt"]')`, 20000);
check("搜索面不显示选夹按钮", await evalJs(`getComputedStyle(document.querySelector(".work-bar [data-work-pick]")).display === "none"`));
check(
  "全文搜索保留已打开的文件",
  await evalJs(`document.querySelectorAll("#workTabs [data-work-tab]").length===2 && !!document.querySelector("#fileViewerStage h1")`)
);
await evalJs(`document.querySelector('[data-work-mode="changes"]').click(); true`);
await waitFor(`document.querySelector("#workStrips").textContent.includes("还没改过文件")`);
await evalJs(`document.querySelector('[data-work-mode="list"]').click(); true`);
await waitFor(`!!document.querySelector('[data-work-file$="/深.md"]')`);
check(
  "切换视图不重置目录树与文件",
  await evalJs(
    `document.querySelectorAll("#workTabs [data-work-tab]").length===2 && !!document.querySelector('[data-work-file$="/深.md"]')`
  )
);
check(
  "浏览器工具在工作区隐藏",
  await evalJs(`["#stageMenuBtn","#stagePen"].every(id=>getComputedStyle(document.querySelector(id)).display==="none")`)
);
await evalJs(`document.querySelector("#stageWorkBtn").click(); true`);

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
              arguments: JSON.stringify({ path: "新建.md", content: "# 新建\n" }),
              status: "done",
              at: 1,
              title: "新建.md",
              root: ROOT,
              result: "已写入",
              change: { path: "新建.md", added: 3, removed: 0, created: true }
            },
            {
              id: "c2",
              name: "edit_file",
              arguments: JSON.stringify({ path: ".gitignore", old: "dist\n", new: "dist\nbuild\n" }),
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
check("对话已绑目录时跟随它，而不是卷宗", await evalJs(`document.querySelector("#workCrumbs .here")?.title === ${JSON.stringify(ROOT)}`));
await waitDir("空夹");
await openDir("空夹");
await evalJs(`document.querySelector('#stageWork [data-work-mode="changes"]').click(); true`);
await waitFor(`document.querySelectorAll("#workStrips .work-row").length === 3`, 8000).catch(() => {});
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
await evalJs(
  `[...document.querySelectorAll("#workStrips [data-work-file]")].find(el => el.dataset.workFile.endsWith("/新建.md")).click(); true`
);
await waitFor(
  `!document.querySelector("#fileViewer").classList.contains("hidden") && /本段改动/.test(document.querySelector("#fileViewerName").textContent)`
);
check(
  "改动里的相对路也能看本段改动，不是打开原件",
  await evalJs(
    `/本段改动/.test(document.querySelector("#fileViewerName").textContent) && !!document.querySelector("#fileViewerStage .split-diff") && document.querySelector("#fileViewerStage .work-diff-head").children.length===2 && document.querySelector("#fileViewer").classList.contains("in-stage")`
  )
);
await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
await waitFor(`document.querySelector("#fileViewer").classList.contains("hidden")`);
await evalJs(`document.querySelector('#stageWork [data-work-mode="list"]').click(); true`);
await waitFor(`!!document.querySelector('#workStrips [data-work-dir$="/空夹"]')`);
check(
  "切回目录保留空夹展开状态",
  await evalJs(`document.querySelector('#workStrips [data-work-dir$="/空夹"]')?.getAttribute("aria-expanded")==="true"`)
);

const officeOpen = async name => {
  await evalJs('document.querySelector(' + JSON.stringify('[data-work-file$="/' + name + '"]') + ').click(); true');
  await waitFor('!!document.querySelector("[data-work-edit]")');
  await evalJs('document.querySelector("[data-work-edit]").click(); true');
  await waitFor('!!document.querySelector("[data-office-field]")');
};
const officeSet = async (index, value) => {
  await evalJs('(() => {const el=document.querySelectorAll("[data-office-field]")[' + index + ']; el.value=' + JSON.stringify(value) + '; el.dispatchEvent(new Event("input",{bubbles:true})); return true;})()');
};
const officeSave = async () => {
  check("未保存有圆点", await evalJs('!!document.querySelector(".work-tab.on .work-dirty-dot")'));
  await evalJs('document.querySelector("[data-office-field]").dispatchEvent(new KeyboardEvent("keydown",{key:"s",ctrlKey:true,bubbles:true,cancelable:true})); true');
  await waitFor('!document.querySelector(".work-tab.on .work-dirty-dot")');
};
await officeOpen("编辑.docx");
await officeSet(0, "改后的文字 & < >");
await officeSave();
const word = readOffice("编辑.docx", readFileSync(ROOT + "/编辑.docx"))["word/document.xml"];
check("Word 原地修改并保留加粗属性", word.includes("改后的文字 &amp; &lt; &gt;") && word.includes("<w:b"));
await evalJs('document.querySelector("[data-work-edit]").click(); true');
await officeOpen("编辑.xlsx");
check("公式单元格不进入编辑列表", await evalJs('document.querySelectorAll("[data-office-field]").length===3'));
await officeSet(0, "独立新值");
await officeSet(2, "42");
await officeSave();
const book = readOffice("编辑.xlsx", readFileSync(ROOT + "/编辑.xlsx"));
check("Excel 独立字符串与数字保存，不改共享索引、公式", book["xl/worksheets/sheet1.xml"].includes("独立新值") &&
  book["xl/worksheets/sheet1.xml"].includes('<c r="B1" t="s"><v>0</v></c>') &&
  book["xl/worksheets/sheet1.xml"].includes("<f>1+1</f>") &&
  book["xl/worksheets/sheet1.xml"].includes("<v>42</v>") &&
  book["xl/sharedStrings.xml"].includes("共享原值"));
await officeSet(0, "共享原值");
await officeSave();
check("同一编辑态再次保存及回改有效", readOffice("编辑.xlsx", readFileSync(ROOT + "/编辑.xlsx"))["xl/worksheets/sheet1.xml"].includes('<c r="A1" t="s"><v>0</v></c>'));

check("全程没有页面异常", await evalJs(`window.__yanExceptions.length === 0`), await evalJs(`JSON.stringify(window.__yanExceptions)`));
close();
process.exit(0);
