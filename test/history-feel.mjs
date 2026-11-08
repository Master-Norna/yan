// 侧栏的两处手感：目录组的「＋」新建过之后，翻页不再粘着那个目录；删了组里最新的一段，组仍停在原处，不随余下几段的时刻往下挪
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const at = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const conversation = (id, title, updatedAt, workdir = "") => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
  workdir,
  forks: [],
  threads: [],
  messages: [{ id: `${id}-u`, role: "user", content: title, timestamp: updatedAt }]
});
// 目录组里最新的一段（5 分钟前）比散着的那段（10 分钟前）新，组里另一段（20 分钟前）比它旧
for (const c of [
  conversation("w-new", "组里最新", at(5), WORK),
  conversation("w-old", "组里旧的", at(20), WORK),
  conversation("loose", "散着的", at(10))
])
  await fetch(PAGE + "api/chats/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ savedAt: Date.now(), conversation: c })
  });
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="loose"]')`, 10000);
const order = () =>
  evalJs(
    `[...document.querySelectorAll("#history .history-repo-group, #history > * > .history-item, #history .history-item:not(.history-repo-group .history-item)")].map(n => n.dataset.repo ? "组" : n.dataset.conversation).join(",")`
  );
check("the directory group sits above the older loose chat", (await order()) === "组,loose", await order());

// 目录的「＋」：欢迎页绑着这个目录；再点翻页，不再绑
await evalJs(`document.querySelector('#history [data-history-workdir]').click(); true`);
await sleep(200);
check("the group's ＋ opens a page bound to its directory", (await evalJs(`__yanState().settings.pendingWorkdir`)) === WORK);
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(200);
check(
  "a new page after that is no longer bound",
  (await evalJs(`(__yanState().settings.pendingWorkdir || "") + "|" + document.querySelector("#welcomeMode").textContent`)) === "|对谈"
);

// 删组里最新的一段：组仍在散着的那段之上
await evalJs(`document.querySelector('[data-conversation="w-new"] [data-history-action="menu"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop [data-menu="delete"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await waitFor(`!document.querySelector('[data-conversation="w-new"]')`, 5000);
check("deleting the group's newest chat leaves the group where it was", (await order()) === "组,loose", await order());
// 组删空了，记下的时刻一并忘掉
await evalJs(`document.querySelector('[data-conversation="w-old"] [data-history-action="menu"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop [data-menu="delete"]').click(); true`);
await sleep(150);
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await waitFor(`!document.querySelector('[data-conversation="w-old"]')`, 5000);
check(
  "an emptied group forgets its held time",
  await evalJs(`!Object.keys(__yanState().settings.groupAt || {}).length && !document.querySelector("#history .history-repo-group")`)
);
close();
