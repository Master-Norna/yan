// 分组（「集」）：对话移入、组改名、组首「＋」起的新对话归进这一组、解散只拆组不删对话
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
const t = new Date().toISOString();
const chat = (id, title) => ({
  id,
  title,
  createdAt: t,
  updatedAt: t,
  profileId: "p1",
  titled: true,
  messages: [],
  forks: [],
  threads: []
});
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0 }], conversations: [${JSON.stringify(chat("a", "甲谈"))}, ${JSON.stringify(chat("b", "乙谈"))}], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);

// 对话「⋯」→ 移入分组 → 新建分组：对话进组，组名进入改名
await evalJs(`document.querySelector('[data-conversation="a"] [data-history-action="menu"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop [data-menu="group"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop [data-move="__new"]').click(); true`);
await sleep(150);
check("new group opens its name for editing", await evalJs(`!!document.querySelector("#history .is-set .group-rename")`));
await evalJs(
  `(i => { i.value = "读书"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true })(document.querySelector("#history .group-rename"))`
);
await sleep(150);
const moved = await evalJs(
  `(s => ({ groups: s.settings.groups.map(g => g.name), a: !!s.conversations.find(c => c.id === "a").groupId, b: !!s.conversations.find(c => c.id === "b").groupId, head: document.querySelector("#history .is-set .history-repo-name")?.textContent, seal: document.querySelector("#history .is-set .repo-seal")?.textContent, inside: [...document.querySelectorAll("#history .is-set [data-conversation]")].map(n => n.dataset.conversation), label: document.querySelector("#history .history-label")?.textContent }))(__yanState())`
);
check(
  "conversation moves into the new group, which sits in its own section with the 集 seal",
  moved.groups.join() === "读书" &&
    moved.a &&
    !moved.b &&
    moved.head === "读书" &&
    moved.seal === "集" &&
    moved.inside.join() === "a" &&
    moved.label === "分组",
  JSON.stringify(moved)
);

// 组首「＋」：欢迎页出分组签；发出后新对话归进这一组，签随之撤去
const groupId = await evalJs(`__yanState().settings.groups[0].id`);
await evalJs(`document.querySelector('[data-group-new="${groupId}"]').click(); true`);
await sleep(200);
check(
  "group + shows the group chip on the welcome page",
  await evalJs(`(c => !c.classList.contains("hidden") && c.textContent.includes("读书"))(document.querySelector("#groupChip"))`)
);
await evalJs(
  `document.querySelector("#welcomeInput").value = "PLAIN 组内"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`__yanState().conversations.length === 3`, 5000);
check(
  "a chat started from the group joins it, and the pending group is spent",
  await evalJs(`__yanState().conversations[0].groupId === ${JSON.stringify(groupId)} && !__yanState().settings.pendingGroupId`)
);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`, 10000);

// 翻页起的是散列的一段：不带分组
await evalJs(`document.querySelector('[data-group-new="${groupId}"]').click(); true`);
await sleep(100);
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(150);
check(
  "plain 翻页 drops the pending group",
  await evalJs(`document.querySelector("#groupChip").classList.contains("hidden") && !__yanState().settings.pendingGroupId`)
);

// 解散：组没了，对话都还在，退回散列
await evalJs(`document.querySelector('[data-group-menu="${groupId}"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop [data-group-act="dissolve"]').click(); true`);
await sleep(200);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await sleep(200);
const after = await evalJs(
  `(s => ({ groups: s.settings.groups.length, count: s.conversations.length, grouped: s.conversations.filter(c => c.groupId).length, sets: document.querySelectorAll("#history .is-set").length }))(__yanState())`
);
check(
  "dissolving a group keeps its conversations",
  after.groups === 0 && after.count === 3 && after.grouped === 0 && after.sets === 0,
  JSON.stringify(after)
);
close();
