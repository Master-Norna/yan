// 言 / 行合一：没绑目录的对话是言——桥接在线时工具落在卷宗目录（设置里改过的位置），脚本落在隐藏的草稿目录、指令不问；
// 中途绑上目录即为行，提示词随之而变，解开又回到言；卷宗页面即目录的视图，不列草稿
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK, TMP } from "./lib.mjs";
const ARCHIVE = `${TMP}/archive2`;
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, archiveDir: ${JSON.stringify(ARCHIVE.split("/").join(process.platform === "win32" ? "\\" : "/"))} }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const welcome = await evalJs(
  `JSON.stringify({ mode: document.querySelector("#welcomeMode").textContent, seal: document.querySelector("#welcome .seal").textContent, chip: document.querySelector("#workdirChip").className, chipText: document.querySelector("#workdirChip .chip-text").textContent, approve: document.querySelector("#approveChip").className, btn: document.querySelector("#modeSeal").dataset.mode + document.querySelector("#modeSeal .rail-icon").textContent })`
);
await shot("archive-welcome.png");
const w = JSON.parse(welcome);
check(
  "welcome without a directory is 言 with the chip reading 卷宗 and no approval chip",
  w.mode === "对谈" &&
    w.seal === "言" &&
    !w.chip.includes("hidden") &&
    w.chipText === "卷宗" &&
    w.approve.includes("hidden") &&
    w.btn === "chat言",
  welcome
);

// ---- 言里做文件：write_file 落到卷宗目录，系统提示是卷宗那段
await evalJs(
  `document.querySelector("#welcomeInput").value = "ARCHIVE 做个表"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`);
const text1 = await evalJs(`document.querySelector(".message.assistant .assistant-block > .markdown").textContent`);
check("model got the 卷宗 hint, not the 执事 one, with the file tools", /archive:yes\|work:no\|run:yes/.test(text1), text1);
check(
  "file landed in the configured archive directory",
  existsSync(`${ARCHIVE}/报表.csv`) && readFileSync(`${ARCHIVE}/报表.csv`, "utf8") === "a,b\n1,2\n"
);
const convId = await evalJs(`JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0].id`);
const scratch = `${ARCHIVE}/.草稿/${convId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12)}`;
check("scratch directory prepared for the conversation", existsSync(scratch), scratch);
check(
  "command in 言 ran without asking",
  await evalJs(
    `!document.querySelector('[data-approve]') && [...document.querySelectorAll(".tool-step")].every(s => s.dataset.status === "done")`
  )
);
// 成品卡：这一答在卷宗里新出的文件挂在答末
await waitFor(`!!document.querySelector(".message.assistant .deliver-bar")`, 5000);
await shot("archive-deliver.png");
check(
  "deliverable card lists the new file",
  (await evalJs(`document.querySelector(".message.assistant .deliver-bar .deliver-name")?.textContent`)) === "报表.csv"
);
check(
  "deliverable row shows type, size and the two actions with 下载 last",
  await evalJs(
    `(f => f.querySelector(".deliver-type").textContent === "CSV" && /B$/.test(f.querySelector("small").textContent) && [...f.querySelectorAll(".deliver-btn")].map(b => b.textContent).join(",") === "预览,下载")(document.querySelector(".message.assistant .deliver-file"))`
  )
);
// 「预览」：不必下载，就地预览
await evalJs(`document.querySelector('.message.assistant .deliver-bar [data-deliver-action="view"]').click(); true`);
await waitFor(`!!document.querySelector("#fileViewerStage .file-viewer-table td")`, 8000);
check(
  "preview opens the csv as a table without downloading",
  (await evalJs(
    `document.querySelector("#fileViewerName").textContent + "|" + [...document.querySelectorAll("#fileViewerStage .file-viewer-table th")].map(n => n.textContent).join(",")`
  )) === "报表.csv|a,b"
);
await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
check(
  "preview closed",
  await evalJs(
    `document.querySelector("#fileViewer").classList.contains("hidden") && !document.querySelector("#fileViewerStage").innerHTML`
  )
);
// 卷宗里的文档对模型可读：read_document 直接读磁盘上的报表
await evalJs(
  `document.querySelector("#chatInput").value = "DOC 读报表"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll(".message.assistant").length === 2 && [...document.querySelectorAll(".message.assistant")].at(-1).dataset.status === "complete"`
);
const docText = await evalJs(`[...document.querySelectorAll(".message.assistant .assistant-block > .markdown")].at(-1).textContent`);
check("read_document reads a file straight from the archive on disk", /DOC\|a,b 1,2/.test(docText), docText);
check(
  "the step is labelled 翻阅文档 with the file name",
  await evalJs(
    `[...document.querySelectorAll(".tool-step")].some(s => s.querySelector(".tool-label")?.textContent === "翻阅文档" && s.querySelector(".tool-title")?.textContent === "报表.csv")`
  )
);
// 存成 Markdown 入卷宗
await evalJs(`document.querySelector("#chatMeta [data-export-md]").click(); true`);
await sleep(800);
check(
  "conversation exported as markdown into the archive",
  existsSync(`${ARCHIVE}/ARCHIVE 做个表.md`) &&
    /## 问[\s\S]*ARCHIVE 做个表[\s\S]*## 答/.test(readFileSync(`${ARCHIVE}/ARCHIVE 做个表.md`, "utf8"))
);
check(
  "chat message keeps the plain tool stack (not the work timeline)",
  await evalJs(`!document.querySelector(".tool-stack.is-work") && !!document.querySelector(".tool-stack")`)
);
check(
  "chat meta offers to bind a directory",
  (await evalJs(`document.querySelector("#chatMeta .chat-meta-bind")?.textContent`)) === "绑定目录"
);
check("seal still says 言", (await evalJs(`document.querySelector("#modeSeal").dataset.mode`)) === "chat");
check("no approval toggle in 言", await evalJs(`document.querySelector("#workAuto").classList.contains("hidden")`));

// ---- 中途绑定：同一段对话，下一问起变为行
await evalJs(`document.querySelector("#chatMeta .chat-meta-bind").click(); true`);
check(
  "bind pop opens under the meta line",
  await evalJs(`!!document.querySelector("#chatMeta .chip-pop[data-kind=workdir] #workdirCommit")`)
);
await shot("archive-bind.png");
await evalJs(
  `(i => { i.value = ${JSON.stringify(WORK)}; })(document.querySelector("#chatMeta #workdirInput")); document.querySelector("#chatMeta #workdirCommit").click(); true`
);
await waitFor(`(document.querySelector("#chatMeta .chat-meta-path")?.textContent || "").includes("work")`);
check("pop closed after binding", await evalJs(`!document.querySelector(".chip-pop")`));
check(
  "seal flips to 行",
  (await evalJs(`document.querySelector("#modeSeal").dataset.mode + document.querySelector("#modeSeal .wide").textContent`)) === "work执事"
);
check("approval toggle appears once bound", await evalJs(`!document.querySelector("#workAuto").classList.contains("hidden")`));
check(
  "history now shows the conversation inside a 工 group",
  await evalJs(
    `!!document.querySelector('.history-repo-group [data-conversation]') && document.querySelector(".history-repo-name").textContent === "work"`
  )
);
await evalJs(
  `document.querySelector("#chatInput").value = "BIND 继续"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll(".message.assistant").length === 3 && document.querySelectorAll(".message.assistant")[2].dataset.status === "complete"`
);
const text2 = await evalJs(`document.querySelectorAll(".message.assistant")[2].querySelector(".assistant-block > .markdown").textContent`);
check("after binding the prompt is the 执事 one and history is intact", /work:yes\|archive:no\|n:6/.test(text2), text2);
check(
  "stored conversation carries the workdir",
  await evalJs(`JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0].workdir.toLowerCase().endsWith("work")`)
);

// ---- 解开：回到言
await evalJs(`document.querySelector("#chatMeta .chat-meta-path").click(); true`);
await waitFor(`!!document.querySelector("#chatMeta [data-unbind]")`);
await evalJs(`document.querySelector("#chatMeta [data-unbind]").click(); true`);
await waitFor(`!!document.querySelector("#chatMeta .chat-meta-bind")`);
check("unbound: seal back to 言", (await evalJs(`document.querySelector("#modeSeal").dataset.mode`)) === "chat");

// ---- 欢迎页的目录签：填了目录即为行，清空即回言；侧栏的印跟着变
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(200);
await evalJs(`document.querySelector("#workdirChip").click(); true`);
await sleep(100);
check("chip opens the directory pop", await evalJs(`!!document.querySelector("#welcomeChips .chip-pop[data-kind=workdir]")`));
await evalJs(
  `(i => { i.value = ${JSON.stringify(WORK)}; i.dispatchEvent(new Event("input")); })(document.querySelector("#welcomeChips #workdirInput")); true`
);
await sleep(150);
check(
  "typing a directory makes the welcome page 行 with the approval chip",
  (await evalJs(
    `document.querySelector("#welcomeMode").textContent + "|" + document.querySelector("#modeSeal").dataset.mode + "|" + document.querySelector("#approveChip").classList.contains("hidden")`
  )) === "执事|work|false"
);
check(
  "pop offers a way back to 言 once a directory is typed",
  await evalJs(`!!document.querySelector("#welcomeChips [data-unbind]:not(.hidden)")`)
);
await evalJs(`document.querySelector("#welcomeChips [data-unbind]").click(); true`);
await sleep(150);
check(
  "clearing it goes back to 言",
  (await evalJs(
    `document.querySelector("#welcomeMode").textContent + "|" + document.querySelector("#workdirChip .chip-text").textContent + "|" + document.querySelector("#modeSeal").dataset.mode + "|" + (JSON.parse(localStorage.getItem("yan-chat-v1")).settings.pendingWorkdir || "")`
  )) === "对谈|卷宗|chat|"
);
check("pop closed after going back", await evalJs(`!document.querySelector(".chip-pop")`));

// ---- 卷宗页面：目录的视图
await evalJs(`document.querySelector("#openLibrary").click(); true`);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-disk="报表.csv"]')`);
await shot("archive-library.png");
check(
  "library lists the file from disk",
  await evalJs(`document.querySelector('#libraryGrid [data-library-disk="报表.csv"] strong').textContent === "报表.csv"`)
);
check(
  "library lead names the configured directory",
  (await evalJs(`document.querySelector("#libraryLead").textContent`)).includes("archive2")
);
check(
  "scratch is hidden from the library but counted in the lead",
  await evalJs(
    `!document.querySelector('[data-library-disk^=".草稿"]') && /草稿 1 处/.test(document.querySelector("#libraryLead").textContent)`
  )
);
check("sidebar count reflects the disk", (await evalJs(`document.querySelector("#libraryCount").textContent`)) === "2");
await evalJs(`document.querySelector("#libraryCleanScratch").click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await waitFor(`!document.querySelector("#libraryCleanScratch")`);
check("clean removes the scratch directories", !existsSync(`${ARCHIVE}/.草稿`) || readdirSync(`${ARCHIVE}/.草稿`).length === 0);
// 卷宗卡片只留 预览 / 下载 / 删除；置于案上走输入框的「＋」→ 卷宗 选件
check(
  "library card offers preview / download / delete only",
  (await evalJs(
    `[...document.querySelectorAll('#libraryGrid [data-library-disk="报表.csv"] [data-library-action]')].map(b => b.textContent).join()`
  )) === "预览,下载,删除"
);
await evalJs(`document.querySelector("#newChat").click(); true`);
await waitFor(`!document.querySelector("#welcome").classList.contains("hidden")`);
await evalJs(`document.querySelector("#welcome .attach-trigger").click(); true`);
await waitFor(`!!document.querySelector('.chip-pop[data-kind=attach] [data-attach="archive"]')`);
await evalJs(`document.querySelector('.chip-pop[data-kind=attach] [data-attach="archive"]').click(); true`);
await waitFor(`!!document.querySelector('.chip-pop.attach-picker [data-pick="disk:报表.csv"]')`);
await evalJs(`document.querySelector('.chip-pop.attach-picker [data-pick="disk:报表.csv"]').click(); true`);
await waitFor(`!!document.querySelector("#welcomeAttachments .attachment-card[title^='报表.csv']")`);
check(
  "picking from the archive menu lands the file on the desk",
  await evalJs(`!document.querySelector(".chip-pop") && document.querySelector("#library").classList.contains("hidden")`)
);
await evalJs(`document.querySelector("#openLibrary").click(); true`);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-disk="报表.csv"]')`);
await evalJs(`document.querySelector('#libraryGrid [data-library-disk="报表.csv"] [data-library-action="remove"]').click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await waitFor(`!document.querySelector('#libraryGrid [data-library-disk="报表.csv"]')`);
check("remove deletes the file on disk", !existsSync(`${ARCHIVE}/报表.csv`));
// 设置里的卷宗目录：改到另一处后，卷宗页跟着换
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
check(
  "settings show the archive directory",
  (await evalJs(`document.querySelector("#settingArchive")?.value || ""`)).toLowerCase().includes("archive2")
);
await evalJs(
  `(i => { i.value = ${JSON.stringify(`${TMP}/archive3`.split("/").join(process.platform === "win32" ? "\\" : "/"))}; i.dispatchEvent(new Event("input")); })(document.querySelector("#settingArchive")); true`
);
await sleep(1200);
check(
  "changed directory is stored and created",
  (await evalJs(`(JSON.parse(localStorage.getItem("yan-chat-v1")).settings.archiveDir || "").toLowerCase()`)).includes("archive3") &&
    existsSync(`${TMP}/archive3`)
);
close();
