// 目录组（「工」）的组首「⋯」：改名只改侧栏显示的名字、真实目录仍在悬停里，删掉整组则连对话一并移除，而目录里的文件一个不碰
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
const at = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const here = `${TMP}/work`,
  elsewhere = `${TMP}/别的仓`;
mkdirSync(here, { recursive: true });
mkdirSync(elsewhere, { recursive: true });
writeFileSync(`${here}/笔记.md`, "删组不该动目录里的文件\n");
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
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
// 一个目录里四段：其中一段置顶、一段虽绑着这个目录却已归进「集」组；另一目录一段。
// 后两段在侧栏都不属于这一目录组，删组时不该被带走
const seed = {
  version: 5,
  settings: {
    name: "测",
    theme: "light",
    inkMotion: "off",
    presets: [],
    groups: [{ id: "g1", name: "诗书", createdAt: at(30), presetId: "", workdir: "" }]
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
      quota: "",
      usedTokens: 0
    }
  ],
  conversations: [
    conversation("w-new", "组里最新", at(5), here),
    conversation("w-old", "组里旧的", at(20), here),
    conversation("pinned", "置顶的", at(1), here, { pinned: true }),
    conversation("grouped", "归组的", at(2), here, { groupId: "g1" }),
    conversation("away", "别处的", at(10), elsewhere)
  ],
  library: [],
  drafts: {}
};
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(seed))}); true`);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector("#history .history-repo-group[data-repo]")`, 10000);
const state = () =>
  evalJs(
    `(() => {
      const group = document.querySelector("#history .history-repo-group[data-repo]");
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
  await evalJs(`document.querySelector("#history .history-repo-group[data-repo] .group-rename")?.value === "work"`)
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
await waitFor(`document.querySelector("#history .history-repo-group[data-repo] .history-repo-name")?.textContent === "言记"`, 5000);

// 刷新照旧（名字记在配置里，几个浏览器共用）
await send("Page.navigate", { url: PAGE });
await waitFor(`document.querySelector("#history .history-repo-group[data-repo] .history-repo-name")?.textContent === "言记"`, 10000);
check("组名随配置存下，刷新照旧", true);

// 「⋯」→ 删除：先问一句，说清对话连附件走、目录里的文件不动；置顶的与归进分组的都不动
await evalJs(`document.querySelector("#history [data-repo-menu]").click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop [data-menu="delete"]').click(); true`);
await sleep(250);
const asked = await evalJs(
  `({ title: document.querySelector("#confirmTitle").textContent, body: document.querySelector("#confirmBody").textContent })`
);
check(
  "删除先问一句：几段对话连附件走、目录里的文件不动、置顶或归组的不在其中",
  asked.title.includes("言记") &&
    asked.body.includes("2 段对话") &&
    asked.body.includes("目录里的文件不动") &&
    asked.body.includes("另有 2 段置顶或已归入分组的对话"),
  JSON.stringify(asked)
);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await sleep(500);
const after = await evalJs(
  `(s => ({ left: s.conversations.map(c => c.id).sort(), grouped: s.conversations.find(c => c.id === "grouped")?.groupId, groups: s.settings.groups.map(g => g.name), repos: [...document.querySelectorAll("#history .history-repo-group[data-repo]")].map(n => n.dataset.repo), loose: [...document.querySelectorAll("#history .history-item[data-conversation]")].map(n => n.dataset.conversation).sort() }))(__yanState())`
);
check(
  "删掉整组：组里的两段没了，置顶的、别处的、已归进「集」组的都还在，那一组也散了",
  after.left.join() === "away,grouped,pinned" &&
    after.grouped === "g1" &&
    after.groups.join() === "诗书" &&
    after.repos.join() === elsewhere &&
    after.loose.join() === "away,grouped,pinned",
  JSON.stringify(after)
);
check("删除只动对话，目录里的文件一个不碰", existsSync(`${here}/笔记.md`));
await shot("folder-group-deleted.png");
close();
