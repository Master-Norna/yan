// 分组（「集」）：对话移入、组内置顶不跳出组、分组页改名与设预设和目录、组首「＋」起的新对话归组并用组的预设、解散只拆组不删对话
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
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
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, presets: [{ id: "ps", name: "读书人", prompt: "PRESETMARK", tools: null, mcp: null, profileId: "", policy: "" }] }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0 }], conversations: [${JSON.stringify(chat("a", "甲谈"))}, ${JSON.stringify(chat("b", "乙谈"))}], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);

// 对话「⋯」→ 移入分组 → 新建分组：对话进组，组名进入改名
await evalJs(`document.querySelector('[data-conversation="a"] [data-history-action="menu"]').click(); true`);
await sleep(150);
check(
  "menu offers 移入分组 for a loose chat",
  await evalJs(`document.querySelector('.chip-pop [data-menu="group"]')?.textContent === "移入分组"`)
);
await evalJs(`document.querySelector('.chip-pop [data-menu="group"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop [data-move="__new"]').click(); true`);
await sleep(150);
await evalJs(
  `(i => { i.value = "读书"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true })(document.querySelector("#history .group-rename"))`
);
await sleep(150);
const moved = await evalJs(
  `(s => ({ groups: s.settings.groups.map(g => g.name), a: !!s.conversations.find(c => c.id === "a").groupId, head: document.querySelector("#history .is-set .history-repo-name")?.textContent, seal: document.querySelector("#history .is-set .repo-seal")?.textContent, buttons: document.querySelectorAll("#history .is-set .history-repo-head button").length, label: document.querySelector("#history .history-label")?.textContent }))(__yanState())`
);
check(
  "conversation moves into the new group; its head has only the ＋, like a 工 group",
  moved.groups.join() === "读书" &&
    moved.a &&
    moved.head === "读书" &&
    moved.seal === "集" &&
    moved.buttons === 1 &&
    moved.label === "分组",
  JSON.stringify(moved)
);
await evalJs(`document.querySelector('[data-conversation="a"] [data-history-action="menu"]').click(); true`);
await sleep(150);
check(
  "menu reads 移至他组 once grouped",
  await evalJs(`document.querySelector('.chip-pop [data-menu="group"]')?.textContent === "移至他组"`)
);

// 组内置顶：留在组里，不进「置顶」段
await evalJs(`document.querySelector('.chip-pop [data-menu="pin"]').click(); true`);
await sleep(200);
const pinned = await evalJs(
  `({ labels: [...document.querySelectorAll("#history .history-label")].map(n => n.textContent), inGroup: !!document.querySelector('#history .is-set [data-conversation="a"]'), mark: !!document.querySelector('#history .is-set [data-conversation="a"] .history-state.pinned') })`
);
check(
  "a pinned chat stays inside its group with a pin mark",
  !pinned.labels.includes("置顶") && pinned.inGroup && pinned.mark,
  JSON.stringify(pinned)
);

// 分组页：侧栏入口 → 列表 → 一组的详情；设预设与默认目录
await evalJs(`document.querySelector("#openGroups").click(); true`);
await sleep(200);
check(
  "the 分组 entry opens a page listing the groups",
  await evalJs(
    `!document.querySelector("#groups").classList.contains("hidden") && document.querySelectorAll("#groups .group-row").length === 1 && document.querySelector("#openGroups").classList.contains("active")`
  )
);
await shot("groups-list.png");
const groupId = await evalJs(`__yanState().settings.groups[0].id`);
await evalJs(`document.querySelector('#groups [data-group-page="${groupId}"]').click(); true`);
await sleep(150);
await evalJs(
  `(s => { s.value = "ps"; s.dispatchEvent(new Event("change", { bubbles: true })); return true })(document.querySelector("#groupPreset"))`
);
await sleep(100);
await evalJs(
  `(i => { i.value = "诗书"; i.dispatchEvent(new Event("change", { bubbles: true })); return true })(document.querySelector("#groupName"))`
);
await sleep(150);
await shot("groups-detail.png");
check(
  "the group page sets the preset and renames the group everywhere",
  await evalJs(
    `(g => g.presetId === "ps" && g.name === "诗书" && document.querySelector("#history .is-set .history-repo-name").textContent === "诗书" && document.querySelector("#groupNewChat").textContent === "在此组新建")(__yanState().settings.groups[0])`
  )
);

// 在此组新建：输入框「＋」旁出分组签，模型按钮标出组的预设；发出后新对话归组、用组的预设
await evalJs(`document.querySelector("#groupNewChat").click(); true`);
await sleep(200);
check(
  "new chat in the group shows the group tag by the ＋ and the group's preset",
  await evalJs(
    `(t => !t.classList.contains("hidden") && t.textContent.includes("诗书") && document.querySelector("#welcome .model-extra").textContent.includes("读书人"))(document.querySelector("#welcomeGroup"))`
  )
);
await evalJs(
  `document.querySelector("#welcomeInput").value = "PLAIN 组内"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`__yanState().conversations.length === 3`, 5000);
check(
  "the chat joins the group with its preset, and the pending group is spent",
  await evalJs(
    `(c => c.groupId === ${JSON.stringify(groupId)} && c.presetId === "ps" && !__yanState().settings.pendingGroupId)(__yanState().conversations[0])`
  )
);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`, 10000);
check(
  "the chat page shows its group by the ＋",
  await evalJs(`(t => !t.classList.contains("hidden") && t.textContent.includes("诗书"))(document.querySelector("#chatGroup"))`)
);

// 翻页起的是散列的一段：不带分组
await evalJs(`document.querySelector('[data-group-new="${groupId}"]').click(); true`);
await sleep(100);
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(150);
check(
  "plain 翻页 drops the pending group",
  await evalJs(`document.querySelector("#welcomeGroup").classList.contains("hidden") && !__yanState().settings.pendingGroupId`)
);

// 解散：组没了，对话都还在，退回散列
await evalJs(`document.querySelector("#openGroups").click(); true`);
await sleep(150);
await evalJs(`document.querySelector('#groups [data-group-page="${groupId}"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector("#groupDissolve").click(); true`);
await sleep(200);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await sleep(200);
const after = await evalJs(
  `(s => ({ groups: s.settings.groups.length, count: s.conversations.length, grouped: s.conversations.filter(c => c.groupId).length, sets: document.querySelectorAll("#history .is-set").length, back: document.querySelectorAll("#groups .group-row").length }))(__yanState())`
);
check(
  "dissolving a group keeps its conversations",
  after.groups === 0 && after.count === 3 && after.grouped === 0 && after.sets === 0,
  JSON.stringify(after)
);
close();
