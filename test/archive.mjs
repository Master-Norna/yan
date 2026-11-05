// 言 / 行合一：没绑目录的对话是言——工具落在卷宗目录（存储根里的 卷宗/），脚本落在隐藏的草稿目录、非只读指令先问；
// 中途绑上目录即为行，提示词随之而变，解开又回到言；卷宗页面即目录的视图，不列草稿
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK, ARCHIVE, HOME } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const welcome = await evalJs(
  `JSON.stringify({ mode: document.querySelector("#welcomeMode").textContent, seal: document.querySelector("#welcome .seal").textContent, chip: document.querySelector("#workdirChip").className, chipText: document.querySelector("#workdirChip .chip-text").textContent, approve: document.querySelector("#approveChip").className, btn: document.querySelector("#modeSeal").dataset.mode + document.querySelector("#modeSeal .rail-icon").textContent })`
);
await shot("archive-welcome.png");
const w = JSON.parse(welcome);
check(
  "welcome without a directory is 言 with the chip reading 卷宗 and the command-policy chip available",
  w.mode === "对谈" &&
    w.seal === "言" &&
    !w.chip.includes("hidden") &&
    w.chipText === "卷宗" &&
    !w.approve.includes("hidden") &&
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
const convId = await evalJs(`__yanState().conversations[0].id`);
const scratch = `${ARCHIVE}/.草稿/${convId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12)}`;
check("scratch directory prepared for the conversation", existsSync(scratch), scratch);
check(
  "the file tool in 言 does not show a shell-command approval",
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
    `(f => f.querySelector(".fi").dataset.figure === "table" && /B$/.test(f.querySelector("small").textContent) && [...f.querySelectorAll(".deliver-btn")].map(b => b.textContent).join(",") === "预览,下载")(document.querySelector(".message.assistant .deliver-file"))`
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
// 成品是答复里链到的那件；正文里那个链接点了同样是预览，不是下载
await evalJs(`document.querySelector('.message.assistant .assistant-block > .markdown a[data-file="报表.csv"]').click(); true`);
await waitFor(
  `!document.querySelector("#fileViewer").classList.contains("hidden") && !!document.querySelector("#fileViewerStage .file-viewer-table td")`,
  8000
);
check(
  "the reply's own link to the file opens the same preview",
  (await evalJs(`document.querySelector("#fileViewerName").textContent`)) === "报表.csv"
);
await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
// 成品多了只摊前四件，末行「余 n 件」点开全摊、再点收起；开着的换一段对话再回来照旧开着
const deliverRows = () =>
  evalJs(
    `[...document.querySelectorAll(".message.assistant .deliver-file")].filter(f => f.offsetParent).length + "|" + (document.querySelector(".message.assistant .deliver-more")?.textContent ?? "")`
  );
const reopenDeliver = async () => {
  await evalJs(`document.querySelector("#newChat").click(); true`);
  await waitFor(`!document.querySelector("#welcome").classList.contains("hidden")`);
  await evalJs(`document.querySelector('#history [data-conversation="${convId}"] .history-open').click(); true`);
  await waitFor(`!!document.querySelector(".message.assistant .deliver-bar")`);
};
await evalJs(
  `(m => { m._kept = m.deliverables; m.deliverables = [...m.deliverables, ...[1, 2, 3, 4, 5, 6].map(i => ({ path: i + ".txt", name: i + ".txt", size: i }))]; })(__yanState().conversations[0].messages[1]); true`
);
await reopenDeliver();
await shot("archive-deliver-fold.png");
check("seven deliverables show four and fold the rest", (await deliverRows()) === "4|余 3 件▾");
await evalJs(`document.querySelector(".message.assistant .deliver-more").click(); true`);
check("the fold line opens all of them and turns into 收起", (await deliverRows()) === "7|收起▾");
await reopenDeliver();
check("an opened fold stays open after leaving and coming back", (await deliverRows()) === "7|收起▾");
await evalJs(`document.querySelector(".message.assistant .deliver-more").click(); true`);
check("收起 folds back to four", (await deliverRows()) === "4|余 3 件▾");
await evalJs(`(m => { m.deliverables = m._kept; delete m._kept; })(__yanState().conversations[0].messages[1]); true`);
await reopenDeliver();
// 纸先沉下去、底淡掉，淡完才藏起、清台面
await sleep(260);
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
// 技能：放进存储根/技能的一份，下一问就列在 read_document 的说明里，凭技能名翻得到 SKILL.md（去了头，注明目录）
mkdirSync(`${HOME}/技能/写信`, { recursive: true });
writeFileSync(`${HOME}/技能/写信/SKILL.md`, "---\nname: 写信\ndescription: 照格式写信\n---\n\n先写称谓，再写正文。");
await evalJs(
  `document.querySelector("#chatInput").value = "SKILLTEST 写封信"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll(".message.assistant").length === 3 && [...document.querySelectorAll(".message.assistant")].at(-1).dataset.status === "complete"`
);
const skillText = await evalJs(`[...document.querySelectorAll(".message.assistant .assistant-block > .markdown")].at(-1).textContent`);
check(
  "a skill in the storage root is listed in the system prompt, not in read_document's description",
  /SKILL\|listed:yes/.test(skillText),
  skillText
);
check(
  "reading a skill by name returns SKILL.md without its front matter, headed by the skill folder",
  /技能目录：.*写信 先写称谓，再写正文。/.test(skillText) && !/description:/.test(skillText),
  skillText
);
check(
  "the step reads Skill · 写信 in the trail, not 翻阅文档 · 写信/SKILL.md",
  await evalJs(
    `[...document.querySelectorAll(".tool-step")].some(s => s.querySelector(".tool-label")?.textContent === "Skill" && s.querySelector(".tool-title")?.textContent === "写信")`
  )
);
// 人点名：「＋」→「技能」挑「写信」，那份说明作一件附件置于案上、随问附上
await evalJs(`[...document.querySelectorAll(".attach-trigger")].find(b => b.offsetParent).click(); true`);
await waitFor(`!!document.querySelector('[data-menu="skill"]')`);
await evalJs(`document.querySelector('[data-menu="skill"]').click(); true`);
await waitFor(`[...document.querySelectorAll(".attach-picker [data-pick] span")].some(s => s.textContent === "写信")`);
await evalJs(
  `[...document.querySelectorAll(".attach-picker [data-pick]")].find(b => b.querySelector("span").textContent === "写信").click(); true`
);
await waitFor(
  `[...document.querySelectorAll(".attachment-list")].some(l => l.offsetParent && !!l.querySelector(".skill-fi") && l.textContent.includes("写信"))`,
  8000
);
await evalJs(
  `document.querySelector("#chatInput").value = "SKILLCMD 给房东"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll(".message.assistant").length === 4 && [...document.querySelectorAll(".message.assistant")].at(-1).dataset.status === "complete"`
);
const cmdText = await evalJs(`[...document.querySelectorAll(".message.assistant .assistant-block > .markdown")].at(-1).textContent`);
check("a skill picked from + goes with the question as its instructions", /CMD\|body:yes\|slash:no/.test(cmdText), cmdText);
check(
  "the question shows the skill as an attachment, with its pouch and name",
  await evalJs(
    `(m => !!m.querySelector(".skill-fi") && m.textContent.includes("写信"))([...document.querySelectorAll(".message.user")].at(-1))`
  )
);
// 存成 Markdown 入卷宗
await evalJs(
  `document.querySelector('.history-item.active [data-history-action="menu"]').click(); document.querySelector('.chip-pop [data-menu="export"]').click(); true`
);
await sleep(800);
check(
  "conversation exported as markdown into the archive",
  existsSync(`${ARCHIVE}/ARCHIVE 做个表.md`) &&
    /## 问[\s\S]*ARCHIVE 做个表[\s\S]*## 答/.test(readFileSync(`${ARCHIVE}/ARCHIVE 做个表.md`, "utf8"))
);
check(
  "chat message with tools draws the same timeline as 行 (what it said before the last step folds away with the steps)",
  await evalJs(`!!document.querySelector(".tool-stack.is-work")`)
);
await evalJs(`document.querySelector('.history-item.active [data-history-action="menu"]').click(); true`);
check(
  "the chat's ⋯ menu offers to bind a directory; the meta line no longer repeats it",
  (await evalJs(`document.querySelector('.chip-pop [data-menu="bind"]')?.textContent`)) === "绑定目录" &&
    (await evalJs(`!document.querySelector("#chatMeta [data-workdir-bind], #chatMeta [data-export-md]")`))
);
check("seal still says 言", (await evalJs(`document.querySelector("#modeSeal").dataset.mode`)) === "chat");
check(
  "the three-mode command-policy toggle is also available in 言",
  await evalJs(
    `!document.querySelector("#workAuto").classList.contains("hidden") && document.querySelector("#workAuto").textContent === "问而后行"`
  )
);

// ---- 中途绑定：同一段对话，下一问起变为行
await evalJs(`document.querySelector('.chip-pop [data-menu="bind"]').click(); true`);
check("bind pop opens from the menu", await evalJs(`!!document.querySelector(".chip-pop[data-kind=workdir] #workdirCommit")`));
await shot("archive-bind.png");
await evalJs(
  `(i => { i.value = ${JSON.stringify(WORK)}; })(document.querySelector("#workdirInput")); document.querySelector("#workdirCommit").click(); true`
);
await waitFor(`(__yanState().conversations[0].workdir || "").toLowerCase().endsWith("work")`);
check("pop closed after binding", await evalJs(`!document.querySelector(".chip-pop")`));
check(
  "seal flips to 行",
  (await evalJs(`document.querySelector("#modeSeal").dataset.mode + document.querySelector("#modeSeal .wide").textContent`)) === "work执事"
);
check(
  "command-policy toggle remains available once bound",
  await evalJs(`!document.querySelector("#workAuto").classList.contains("hidden")`)
);
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
  `document.querySelectorAll(".message.assistant").length === 5 && document.querySelectorAll(".message.assistant")[4].dataset.status === "complete"`
);
const text2 = await evalJs(`document.querySelectorAll(".message.assistant")[4].querySelector(".assistant-block > .markdown").textContent`);
check("after binding the prompt is the 执事 one and history is intact", /work:yes\|archive:no\|n:10/.test(text2), text2);
check("stored conversation carries the workdir", await evalJs(`__yanState().conversations[0].workdir.toLowerCase().endsWith("work")`));

// ---- 作答中不许换目录：写了一半的落在旧目录，中途换了余下的就写进新目录
await evalJs(
  `document.querySelector("#chatInput").value = "SLOWTHINK 换目录"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(`document.querySelectorAll(".message.assistant")[5]?.dataset.status === "streaming"`);
await evalJs(`document.querySelector('.history-item.active [data-history-action="menu"]').click(); true`);
check(
  "while replying the ⋯ menu greys out changing the directory",
  await evalJs(`(b => !!b?.disabled && b.textContent.includes("作答中"))(document.querySelector('.chip-pop [data-menu="bind"]'))`),
  await evalJs(`document.querySelector('.chip-pop [data-menu="bind"]')?.outerHTML`)
);
await evalJs(`document.body.click(); true`);
await waitFor(`document.querySelectorAll(".message.assistant")[5]?.dataset.status === "complete"`, 20000);
await evalJs(`document.querySelector('.history-item.active [data-history-action="menu"]').click(); true`);
check(
  "once the reply is done the directory can be changed again",
  await evalJs(`!document.querySelector('.chip-pop [data-menu="bind"]')?.disabled`)
);
await evalJs(`document.body.click(); true`);
await sleep(200);

// ---- 解开：回到言
await evalJs(
  `document.querySelector('.history-item.active [data-history-action="menu"]').click(); document.querySelector('.chip-pop [data-menu="bind"]').click(); true`
);
await waitFor(`!!document.querySelector(".chip-pop [data-unbind]")`);
await evalJs(`document.querySelector(".chip-pop [data-unbind]").click(); true`);
await waitFor(`!__yanState().conversations[0].workdir`);
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
    `document.querySelector("#welcomeMode").textContent + "|" + document.querySelector("#workdirChip .chip-text").textContent + "|" + document.querySelector("#modeSeal").dataset.mode + "|" + (__yanState().settings.pendingWorkdir || "")`
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
  "library lead names the archive inside the storage root",
  (await evalJs(`document.querySelector("#libraryLead").textContent`)).includes(".yan")
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
// 卷宗的一条留 预览 / 下载 / 改名 / 删除；置于案上走输入框的「＋」→ 卷宗 选件
check(
  "library row offers preview / download / rename / delete",
  (await evalJs(
    `[...document.querySelectorAll('#libraryGrid [data-library-disk="报表.csv"] [data-library-action]')].map(b => b.textContent).join()`
  )) === "预览,下载,改名,删除"
);
await evalJs(`document.querySelector("#newChat").click(); true`);
await waitFor(`!document.querySelector("#welcome").classList.contains("hidden")`);
await evalJs(`document.querySelector("#welcome .attach-trigger").click(); true`);
await waitFor(`!!document.querySelector('.chip-pop[data-kind=attach] [data-menu="archive"]')`);
await evalJs(`document.querySelector('.chip-pop[data-kind=attach] [data-menu="archive"]').click(); true`);
await waitFor(`!!document.querySelector('.chip-pop.attach-picker [data-pick="报表.csv"]')`);
await evalJs(`document.querySelector('.chip-pop.attach-picker [data-pick="报表.csv"]').click(); true`);
await waitFor(`!!document.querySelector("#welcomeAttachments .attachment-card[data-name='报表.csv']")`);
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
// 设置里的存储位置：卷宗就在它下面
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
check(
  "settings show the storage location",
  (await evalJs(`document.querySelector("#settingStore")?.value || ""`)).toLowerCase().includes(".tmp")
);
// 页内起手的拖动（卷宗里的图、案上的附件）不当作外来文件：不掀落件幕布；拖完之后外来的照常
await evalJs(`document.querySelector("#closeSettings")?.click(); true`);
await sleep(200);
const drag = await evalJs(
  `(() => { const dt = new DataTransfer(); dt.items.add(new File(["x"], "again.txt", { type: "text/plain" })); const fire = (type, target = window) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); const veil = () => !document.querySelector("#dropVeil").classList.contains("hidden"); fire("dragstart", document.body); fire("dragenter"); fire("dragover"); const inside = veil(); fire("dragend", document.body); fire("dragenter"); const outside = veil(); fire("dragleave"); return { inside, outside }; })()`
);
check(
  "drags that start inside the page do not raise the drop veil; external ones still do",
  !drag.inside && drag.outside,
  JSON.stringify(drag)
);

// ---- 卷宗多级：逐层看，夹与件同格；查找与按类筛选跨层平铺；拖入落进当前层；卡片拖到夹上即挪进去
mkdirSync(`${ARCHIVE}/课程/深度学习`, { recursive: true });
mkdirSync(`${ARCHIVE}/课程/空夹`, { recursive: true });
writeFileSync(`${ARCHIVE}/课程/讲义.txt`, "讲义");
writeFileSync(`${ARCHIVE}/课程/深度学习/笔记.md`, "# 笔记");
writeFileSync(`${ARCHIVE}/一声.mp3`, "not really audio");
// 一答的成品条记着卷宗里的路径：件挪进夹后，条子跟着走
writeFileSync(`${ARCHIVE}/成品.txt`, "成品");
await fetch(PAGE + "api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: "deliver-follow",
      title: "成品随行",
      createdAt: "2026-09-28",
      updatedAt: new Date().toISOString(),
      forks: [],
      threads: [],
      messages: [
        { id: "u", role: "user", content: "写个成品", timestamp: "2026-09-28" },
        {
          id: "a",
          role: "assistant",
          content: "写好了。",
          status: "complete",
          timestamp: "2026-09-28",
          deliverables: [{ path: "成品.txt", name: "成品.txt", size: 6 }]
        }
      ]
    }
  })
});
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector("#openLibrary")`);
await sleep(600);
await evalJs(`document.querySelector("#library").classList.contains("hidden") && document.querySelector("#openLibrary").click(); true`);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-dir="课程"]')`);
check(
  "the root lists the folder and its own files only",
  await evalJs(
    `!!document.querySelector('#libraryGrid [data-library-disk="一声.mp3"]') && !document.querySelector('#libraryGrid [data-library-disk="课程/讲义.txt"]') && document.querySelector("#libraryCrumbs").textContent === "卷宗" && !document.querySelector("#libraryGrid .strip-back")`
  )
);
check(
  "a folder row counts what is inside, deeper layers included",
  (await evalJs(`document.querySelector('#libraryGrid [data-library-dir="课程"] .strip-note').textContent`)) === "2 件 · 2 夹"
);
await evalJs(`document.querySelector('#libraryGrid [data-library-dir="课程"]').click(); true`);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-disk="课程/讲义.txt"]')`);
await shot("archive-folders.png");
check(
  "inside a folder: its subfolders first, then its files, with a path to climb back",
  (await evalJs(
    `[...document.querySelectorAll("#libraryGrid .strip strong")].map(n => n.textContent).join() + "|" + document.querySelector("#libraryCrumbs").textContent`
  )) === "空夹,深度学习,讲义.txt|卷宗›课程"
);
await evalJs(
  `(() => { const dt = new DataTransfer(); dt.items.add(new File(["新"], "新.txt", { type: "text/plain" })); window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt })); })(); true`
);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-disk="课程/新.txt"]')`, 8000);
check("files dropped in land in the folder being viewed", existsSync(`${ARCHIVE}/课程/新.txt`));
// 拖进一个文件夹：照原样建夹、文件落进各层，点开头的跳过；同名的夹另取名，不并进旧的。
// 真的文件夹拖放合成不出来，这里照浏览器的目录条目接口（webkitGetAsEntry / createReader / readEntries 分批）造一个
const dropFolder = `(() => {
  const file = (name, text) => ({ name, isFile: true, isDirectory: false, file: ok => ok(new File([text], name)) });
  const dir = (name, children) => ({ name, isFile: false, isDirectory: true, createReader: () => { let given = false; return { readEntries: ok => setTimeout(() => ok(given ? [] : ((given = true), children))) }; } });
  const tree = dir("场景示例", [file("说明.md", "# 说明"), file(".DS_Store", "x"), dir("图", [file("a.txt", "A")]), dir(".git", [file("HEAD", "ref")])]);
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [], items: [{ kind: "file", webkitGetAsEntry: () => tree }] } });
  window.dispatchEvent(event);
  return true;
})()`;
await evalJs(dropFolder);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-dir="课程/场景示例"]')`, 8000).catch(() => {});
check(
  "a dropped folder comes in with its structure, skipping dot entries",
  existsSync(`${ARCHIVE}/课程/场景示例/说明.md`) &&
    readFileSync(`${ARCHIVE}/课程/场景示例/图/a.txt`, "utf8") === "A" &&
    !existsSync(`${ARCHIVE}/课程/场景示例/.DS_Store`) &&
    !existsSync(`${ARCHIVE}/课程/场景示例/.git`) &&
    !existsSync(`${ARCHIVE}/课程/场景示例/git`)
);
// Markdown 里的相对图片照这份文件所在的那一层去卷宗里取（先写好，下一回拖入时卷宗刷新就列出来）
mkdirSync(`${ARCHIVE}/课程/场景示例/images`, { recursive: true });
writeFileSync(
  `${ARCHIVE}/课程/场景示例/images/点 1.png`,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==", "base64")
);
writeFileSync(`${ARCHIVE}/课程/场景示例/读我.md`, "# 读我\n\n![](images/点%201.png)\n\n![](./images/../images/点%201.png)\n");
writeFileSync(`${ARCHIVE}/课程/场景示例/images/点#2.png`, readFileSync(`${ARCHIVE}/课程/场景示例/images/点 1.png`));
writeFileSync(`${ARCHIVE}/课程/场景示例/读我.md`, "\n![](images/点%232.png)\n", { flag: "a" });
// 挪过的文档：文里还写着旧夹，图其实在 images 里
writeFileSync(`${ARCHIVE}/课程/场景示例/挪过.md`, "![](旧夹/点%201.png)\n\n![没有这幅](旧夹/无此图.png)\n\n[读我](旧夹/读我.md)\n");
await evalJs(dropFolder);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-dir="课程/场景示例 (2)"]')`, 8000).catch(() => {});
check("dropping it again makes a second folder instead of merging", existsSync(`${ARCHIVE}/课程/场景示例 (2)/图/a.txt`));
await evalJs(`document.querySelector('#libraryGrid [data-library-dir="课程/场景示例"]').click(); true`);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-disk="课程/场景示例/读我.md"] [data-library-action="view"]')`, 8000);
await evalJs(
  `document.querySelector('#libraryGrid [data-library-disk="课程/场景示例/读我.md"] [data-library-action="view"]').click(); true`
);
await waitFor(`document.querySelectorAll("#fileViewerStage .markdown img").length === 3`, 8000).catch(() => {});
await waitFor(`[...document.querySelectorAll("#fileViewerStage .markdown img")].every(img => img.complete)`, 8000).catch(() => {});
check(
  "relative images in an archived Markdown file load from beside it",
  await evalJs(
    `(imgs => imgs.length === 3 && imgs.every(img => img.naturalWidth === 1 && img.src.includes("/api/archive/file")))([...document.querySelectorAll("#fileViewerStage .markdown img")])`
  ),
  await evalJs(`[...document.querySelectorAll("#fileViewerStage .markdown img")].map(img => img.src + " " + img.naturalWidth).join(" | ")`)
);
await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
await evalJs(
  `document.querySelector('#libraryGrid [data-library-disk="课程/场景示例/挪过.md"] [data-library-action="view"]').click(); true`
);
await waitFor(`document.querySelector("#fileViewerStage .markdown img")?.naturalWidth === 1`, 8000).catch(() => {});
check(
  "an image whose relative path went stale after a move is found by name near the document",
  await evalJs(`document.querySelector("#fileViewerStage .markdown img")?.naturalWidth === 1`),
  await evalJs(`document.querySelector("#fileViewerStage .markdown img")?.src || "no image"`)
);
await waitFor(`document.querySelectorAll("#fileViewerStage .markdown img").length === 1`, 8000).catch(() => {});
check(
  "an image nothing can be found for leaves its caption, not a broken picture",
  await evalJs(
    `document.querySelectorAll("#fileViewerStage .markdown img").length === 1 && document.querySelector("#fileViewerStage .markdown").textContent.includes("没有这幅")`
  )
);
await evalJs(`document.querySelector('#fileViewerStage a[data-file="读我.md"]').click(); true`);
await waitFor(
  `document.querySelector("#fileViewerStage .markdown img")?.naturalWidth === 1 && document.querySelectorAll("#fileViewerStage .markdown img").length === 3`,
  8000
).catch(() => {});
check(
  "a link whose relative path went stale opens the file found by name",
  await evalJs(
    `document.querySelector("#fileViewerName").textContent === "读我.md" && document.querySelectorAll("#fileViewerStage .markdown img").length === 3`
  ),
  await evalJs(`document.querySelector("#fileViewerName").textContent`)
);
await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
await evalJs(`document.querySelector("#libraryGrid .strip-back").click(); true`);
await waitFor(`document.querySelector("#libraryCrumbs").textContent === "卷宗›课程"`, 8000);
const dragCard = (path, dir) =>
  evalJs(
    `(() => { const dt = new DataTransfer(), fire = (type, node) => node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })),
      card = document.querySelector(${JSON.stringify(`#libraryGrid [data-library-item="${path}"]`)}), target = document.querySelector(${JSON.stringify(`#library [data-library-dir="${dir}"]`)});
      fire("dragstart", card); fire("dragover", target); const lit = target.classList.contains("drop-over"); fire("drop", target); fire("dragend", card); return lit; })()`
  );
check("dragging a card over a folder lights it up", await dragCard("课程/讲义.txt", "课程/空夹"));
await waitFor(`!document.querySelector('#libraryGrid [data-library-disk="课程/讲义.txt"]')`, 8000);
check(
  "dropping it moves the file into that folder",
  existsSync(`${ARCHIVE}/课程/空夹/讲义.txt`) && !existsSync(`${ARCHIVE}/课程/讲义.txt`)
);
await evalJs(`document.querySelector('#libraryGrid [data-library-dir="课程/空夹"]').click(); true`);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-disk="课程/空夹/讲义.txt"]')`);
await dragCard("课程/空夹/讲义.txt", "");
await waitFor(`!document.querySelector('#libraryGrid [data-library-disk="课程/空夹/讲义.txt"]')`, 8000);
check("dragging onto a level in the path moves it back up", existsSync(`${ARCHIVE}/讲义.txt`));
await evalJs(
  `(() => { const s = document.querySelector("#librarySearch"); s.value = "笔记"; s.dispatchEvent(new Event("input")); })(); true`
);
check(
  "searching lists matches from every level, each noting its folder",
  await evalJs(
    `(() => { const card = document.querySelector('#libraryGrid [data-library-disk="课程/深度学习/笔记.md"]'); return !!card && card.querySelector("small").textContent.endsWith("课程/深度学习") && document.querySelector("#libraryCrumbs").classList.contains("hidden") && !document.querySelector("#libraryGrid [data-library-dir]"); })()`
  )
);
await evalJs(
  `(() => { const s = document.querySelector("#librarySearch"); s.value = ""; s.dispatchEvent(new Event("input")); document.querySelector('[data-library-kind="audio"]').click(); })(); true`
);
check(
  "the 音 filter picks out audio, drawn as audio",
  (await evalJs(
    `[...document.querySelectorAll("#libraryGrid .strip")].map(c => c.querySelector("strong").textContent + c.querySelector(".fi").dataset.figure).join()`
  )) === "一声.mp3audio"
);
await evalJs(`document.querySelector('[data-library-kind="all"]').click(); true`);
await evalJs(`document.querySelector('#libraryCrumbs [data-library-dir=""]').click(); true`);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-disk="成品.txt"]')`);
await dragCard("成品.txt", "课程");
await waitFor(`!document.querySelector('#libraryGrid [data-library-disk="成品.txt"]')`, 8000);
check(
  "a deliverable moved into a folder keeps its place on the reply",
  existsSync(`${ARCHIVE}/课程/成品.txt`) &&
    (await evalJs(
      `(f => f.path + "|" + f.name)(__yanState().conversations.find(c => c.id === "deliver-follow").messages[1].deliverables[0])`
    )) === "课程/成品.txt|成品.txt"
);
// 输入框「＋」→ 卷宗 选件也逐层看：根上只列夹与根上的件，点夹即进、顶上一行回上一层；查找跨层平铺
await evalJs(`document.querySelector("#newChat").click(); true`);
await waitFor(`!document.querySelector("#welcome").classList.contains("hidden")`);
await evalJs(`document.querySelector("#welcome .attach-trigger").click(); true`);
await waitFor(`!!document.querySelector('.chip-pop[data-kind=attach] [data-menu="archive"]')`);
await evalJs(`document.querySelector('.chip-pop[data-kind=attach] [data-menu="archive"]').click(); true`);
await waitFor(`!!document.querySelector('.chip-pop.attach-picker [data-dir="课程"]')`);
const pickerRows = () =>
  evalJs(
    `[...document.querySelectorAll(".chip-pop.attach-picker .chip-pop-list button")].map(b => b.dataset.dir !== undefined ? (b.classList.contains("picker-up") ? "‹" : "夹:") + b.dataset.dir : b.dataset.pick).join()`
  );
check(
  "the archive picker shows one level: folders, then that level's files",
  (await pickerRows()) === "夹:课程,一声.mp3,讲义.txt,ARCHIVE 做个表.md"
);
await evalJs(`document.querySelector('.chip-pop.attach-picker [data-dir="课程"]').click(); true`);
await waitFor(`!!document.querySelector('.chip-pop.attach-picker .picker-up')`);
check(
  "clicking a folder in the picker enters it, with a way back up",
  (await pickerRows()) === "‹,夹:课程/场景示例,夹:课程/场景示例 (2),夹:课程/空夹,夹:课程/深度学习,课程/新.txt,课程/成品.txt" &&
    (await evalJs(`!!document.querySelector(".chip-pop.attach-picker")`))
);
await evalJs(
  `(() => { const i = document.querySelector(".chip-pop.attach-picker input"); i.value = "笔记"; i.dispatchEvent(new Event("input")); })(); true`
);
check(
  "searching in the picker lists matches from every level",
  (await pickerRows()) === "课程/深度学习/笔记.md" &&
    (await evalJs(
      `document.querySelector('.chip-pop.attach-picker [data-pick="课程/深度学习/笔记.md"] small').textContent.startsWith("课程/深度学习 · ")`
    ))
);
await evalJs(`document.querySelector('.chip-pop.attach-picker [data-pick="课程/深度学习/笔记.md"]').click(); true`);
await waitFor(`!!document.querySelector("#welcomeAttachments .attachment-card[data-name='笔记.md']")`);
check("a file picked from inside a folder lands on the desk", await evalJs(`!document.querySelector(".chip-pop")`));
await evalJs(`document.querySelector("#openLibrary").click(); true`);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-dir="课程"]')`);

// ---- 簿录上的管理：新建夹即就地起名，件就地改名，夹拖进夹，簿头 ‹ 回上一层，删夹连同里头
const typeName = name =>
  evalJs(
    `(i => { i.value = ${JSON.stringify(name)}; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true })(document.activeElement)`
  );
await evalJs(`document.querySelector("#libraryNewDir").click(); true`);
await waitFor(`document.activeElement?.classList.contains("strip-rename")`, 8000);
check(
  "新建夹 makes a folder on disk and opens its name for editing",
  existsSync(`${ARCHIVE}/新建夹`) && (await evalJs(`document.activeElement.value === "新建夹"`))
);
await typeName("讲座");
await waitFor(`!!document.querySelector('#libraryGrid [data-library-dir="讲座"]')`, 8000);
check("naming it renames the folder on disk", existsSync(`${ARCHIVE}/讲座`) && !existsSync(`${ARCHIVE}/新建夹`));
await evalJs(`document.querySelector('#libraryGrid [data-library-disk="讲义.txt"] [data-library-action="rename"]').click(); true`);
await waitFor(`document.activeElement?.classList.contains("strip-rename")`);
check(
  "renaming a file selects the name before its extension",
  (await evalJs(`(i => i.value.slice(i.selectionStart, i.selectionEnd))(document.activeElement)`)) === "讲义"
);
await typeName("讲义一.txt");
await waitFor(`!!document.querySelector('#libraryGrid [data-library-disk="讲义一.txt"]')`, 8000);
check("the file is renamed on disk", existsSync(`${ARCHIVE}/讲义一.txt`) && !existsSync(`${ARCHIVE}/讲义.txt`));
check("a folder can be dragged too", await dragCard("讲座", "课程"));
await waitFor(`!document.querySelector('#libraryGrid [data-library-dir="讲座"]')`, 8000);
check("and dropping it moves the folder in", existsSync(`${ARCHIVE}/课程/讲座`));
await evalJs(`document.querySelector('#libraryGrid [data-library-dir="课程"]').click(); true`);
await waitFor(`!!document.querySelector('#libraryGrid [data-library-dir="课程/讲座"]')`);
await shot("archive-strips.png");
await evalJs(`document.querySelector("#libraryGrid .strip-back").click(); true`);
check(
  "the ‹ at the head of the list climbs back up",
  await evalJs(`!document.querySelector("#libraryGrid .strip-back") && !!document.querySelector('#libraryGrid [data-library-dir="课程"]')`)
);
await evalJs(`document.querySelector('#libraryGrid [data-library-dir="课程"] [data-library-action="remove"]').click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`);
check("deleting a folder says what goes with it", /连同其中/.test(await evalJs(`document.querySelector("#confirmModal").textContent`)));
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await waitFor(`!document.querySelector('#libraryGrid [data-library-dir="课程"]')`, 8000);
check("the folder and everything in it is gone from disk", !existsSync(`${ARCHIVE}/课程`));
close();
