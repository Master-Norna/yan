// 目录组（「工」）的组首「⋯」：改名只改侧栏显示的名字、真实目录仍在悬停里，删掉整组则连对话一并移除，而目录里的文件一个不碰
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
import { mkdirSync } from "node:fs";
const at = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const here = `${TMP}/work`,
  elsewhere = `${TMP}/别的仓`;
mkdirSync(here, { recursive: true });
mkdirSync(elsewhere, { recursive: true });
const conversation = (id, title, updatedAt, workdir = "", extra = {}) => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
  workdir,
  forks: [],
  threads: [],
  messages: [{ id: `${id}-u`, role: "user", content: title, timestamp: updatedAt }],
  ...extra
});
// 一个目录里三段（其中一段置顶），另一目录一段：置顶的本就不进目录组，删组时不该被带走
for (const c of [
  conversation("w-new", "组里最新", at(5), here),
  conversation("w-old", "组里旧的", at(20), here),
  conversation("pinned", "置顶的", at(1), here, { pinned: true }),
  conversation("away", "别处的", at(10), elsewhere)
])
  await fetch(PAGE + "api/chats/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ savedAt: Date.now(), conversation: c })
  });
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector("#history .history-repo-group")`, 10000);
const state = () =>
  evalJs(
    `(() => {
      const group = document.querySelector("#history .history-repo-group");
      return { name: group.querySelector(".history-repo-name")?.textContent, seal: group.querySelector(".repo-seal")?.textContent, buttons: group.querySelectorAll(".history-repo-head button").length, tip: group.querySelector(".history-repo").title };
    })()`
  );
const first = await state();
check(
  "目录组的组首有印、名字、＋与⋯，悬停仍是完整目录",
  first.name === "work" && first.seal === "工" && first.buttons === 2 && first.tip.startsWith(here),
  JSON.stringify(first)
);

// 组首右端的两枚按钮平时藏着、悬停才浮出：截一张时先按亮，好一眼看出位置
await evalJs(`document.querySelectorAll("#history .history-repo-head .repo-new").forEach(b => (b.style.opacity = "1")); true`);
await shot("folder-group-head.png");

// 「⋯」→ 改名：只改侧栏显示的字，真实路径不动
await evalJs(`document.querySelector("#history [data-repo-menu]").click(); true`);
await sleep(150);
check(
  "目录组首的⋯给出改名与删除",
  await evalJs(`[...document.querySelectorAll(".chip-pop [data-menu]")].map(b => b.textContent).join() === "改名,删除"`)
);
await evalJs(`document.querySelector('.chip-pop [data-menu="rename"]').click(); true`);
await sleep(150);
check(
  "改名就地变成输入框，里头是现在的名字",
  await evalJs(`document.querySelector("#history .history-repo-group .group-rename")?.value === "work"`)
);
await evalJs(
  `(i => { i.value = "言记"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true })(document.querySelector("#history .group-rename"))`
);
await sleep(200);
const renamed = await state();
check(
  "改名只改侧栏显示的名字，扫过仍见完整路径",
  renamed.name === "言记" &&
    renamed.tip.startsWith(here) &&
    (await evalJs(`__yanState().settings.workdirNames[${JSON.stringify(here)}] === "言记"`)),
  JSON.stringify(renamed)
);
await shot("folder-group-renamed.png");
await waitFor(`document.querySelector("#history .history-repo-group .history-repo-name")?.textContent === "言记"`, 5000);

// 刷新照旧（名字记在配置里，几个浏览器共用）
await send("Page.navigate", { url: PAGE });
await waitFor(`document.querySelector("#history .history-repo-group .history-repo-name")?.textContent === "言记"`, 10000);
check("组名随配置存下，刷新照旧", true);

// 「⋯」→ 删除：先问一句，说清对话连附件走、目录里的文件不动；置顶的与别处的不动
await evalJs(`document.querySelector("#history [data-repo-menu]").click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop [data-menu="delete"]').click(); true`);
await sleep(250);
const asked = await evalJs(
  `({ title: document.querySelector("#confirmTitle").textContent, body: document.querySelector("#confirmBody").textContent })`
);
check(
  "删除先问一句：几段对话连附件走、目录里的文件不动、置顶的不在其中",
  asked.title.includes("言记") && asked.body.includes("2 段对话") && asked.body.includes("目录里的文件不动") && asked.body.includes("置顶"),
  JSON.stringify(asked)
);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await sleep(500);
const after = await evalJs(
  `(s => ({ left: s.conversations.map(c => c.id).sort(), repos: [...document.querySelectorAll("#history .history-repo-group")].map(n => n.dataset.repo), loose: [...document.querySelectorAll("#history .history-item[data-conversation]")].map(n => n.dataset.conversation).sort() }))(__yanState())`
);
check(
  "删掉整组：组里的对话没了，置顶的与别处的都还在，那一组也散了",
  after.left.join() === "away,pinned" && after.repos.join() === elsewhere && after.loose.join() === "away,pinned",
  JSON.stringify(after)
);
await shot("folder-group-deleted.png");
close();
