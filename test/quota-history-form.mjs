// 余墨已尽不锁对话（换模型即续）；执事模式下历史按目录分组
import { connect, check, sleep, PAGE, WORK, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
// 分组是「今天 / 过去七天 / 更早」，按当下算；夹具写死日期就是个定时炸弹，跨一次零点就散架
const ago = days => new Date(Date.now() - days * 86400000).toISOString();
const msg = (id, role, content, t) => ({ id, role, content, createdAt: t, status: "complete" });
const conv = (id, title, t, extra = {}) => ({
  id,
  title,
  createdAt: t,
  updatedAt: t,
  profileId: "p1",
  forks: [],
  threads: [],
  messages: [msg(id + "u", "user", "问 " + title, t), msg(id + "a", "assistant", "答 " + title, t)],
  ...extra
});
const seed = {
  version: 4,
  settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false },
  profiles: [
    {
      id: "p1",
      source: "custom",
      name: "干墨",
      model: "fake",
      baseUrl: "http://127.0.0.1:8798/v1",
      apiKey: "k",
      temperature: 0.7,
      maxTokens: 8192,
      quota: "100",
      usedTokens: 100000,
      systemPrompt: ""
    },
    {
      id: "p2",
      source: "custom",
      name: "湿墨",
      model: "fake",
      baseUrl: "http://127.0.0.1:8798/v1",
      apiKey: "k",
      temperature: 0.7,
      maxTokens: 8192,
      quota: "100k",
      usedTokens: 0,
      systemPrompt: ""
    }
  ],
  conversations: [
    conv("c1", "干墨对话", ago(0.1), { ended: true }),
    conv("w1", "言 甲", ago(2), { mode: "work", workdir: "E:\\项目\\言" }),
    conv("w2", "言 乙", ago(3), { mode: "work", workdir: "E:\\项目\\言" }),
    conv("w3", "别处 丙", ago(4), { mode: "work", workdir: "D:\\code\\别处" }),
    conv("c2", "闲谈", ago(10))
  ],
  library: [],
  drafts: {}
};
await evalJs(`localStorage.setItem("yan-chat-v1", JSON.stringify(${JSON.stringify(seed)})); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
// 余墨已尽：打开旧对话（旧数据里还带着 ended 锁）
await evalJs(
  `[...document.querySelectorAll("#history .history-item")].find(n => n.textContent.includes("干墨对话")).querySelector(".history-open").click(); true`
);
await sleep(400);
check(
  "stored ended flag is dropped on load",
  (await evalJs(`__yanState().conversations.every(c => !("ended" in c))`)) ||
    (await evalJs(`!("ended" in __yanState().conversations[0])`))
);
check(
  "dry notice with a switch button; input paused",
  await evalJs(
    `!!document.querySelector("#messages .ended-notice [data-pick-model]") && document.querySelector("#chatInput").disabled && document.querySelector("#chatInput").placeholder.includes("余墨已尽")`
  )
);
await evalJs(`document.querySelector("#messages [data-pick-model]").click(); true`);
await sleep(300);
check("button opens the model menu", await evalJs(`!document.querySelector("#modelMenu").classList.contains("hidden")`));
await evalJs(`document.querySelector('#modelMenu .model-option[data-profile="p2"]').click(); true`);
await sleep(400);
check(
  "switching model lifts the pause in place",
  await evalJs(
    `!document.querySelector("#messages .ended-notice") && !document.querySelector("#chatInput").disabled && document.querySelectorAll("#messages .message").length === 2`
  )
);
await evalJs(
  `document.querySelector("#chatInput").value = "PLAIN 续"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll('#messages .message.assistant').length === 2 && [...document.querySelectorAll('#messages .message.assistant')].at(-1)?.dataset.status === "complete"`
);
check(
  "the same conversation continues with the new model",
  await evalJs(`[...document.querySelectorAll('#messages .message.assistant .markdown')].at(-1).textContent.includes("正文回答")`)
);
await evalJs(`document.querySelector('#modelMenu')?.classList.contains("hidden") || document.body.click(); true`);
await evalJs(`document.querySelector(".model-trigger").click(); true`);
await sleep(200);
await evalJs(`document.querySelector('#modelMenu .model-option[data-profile="p1"]').click(); true`);
await sleep(300);
check(
  "switching back to the dry model pauses again",
  await evalJs(`!!document.querySelector("#messages .ended-notice") && document.querySelector("#chatInput").disabled`)
);
// 历史：一条时间线。绑了目录的对话归在「工」组里，组按组内最近的那条排，没绑的按自己的时间散在其间；言 / 行的态不影响排法
const outline = () =>
  evalJs(
    `[...document.querySelectorAll("#history .history-group")].map(g => g.querySelector(".history-label").textContent.trim() + ":" + [...g.children].slice(1).map(n => n.classList.contains("history-repo-group") ? "工" + n.querySelector(".history-repo-name").textContent + "(" + [...n.querySelectorAll(".history-open")].map(b => b.textContent).join(",") + ")" : n.querySelector(".history-open")?.textContent).join("|"))`
  );
const labels = await outline();
check(
  "one timeline: folder groups sit where their newest conversation falls, chats in between",
  JSON.stringify(labels) === JSON.stringify(["今天:干墨对话", "过去七天:工言(言 甲,言 乙)|工别处(别处 丙)", "更早:闲谈"]),
  JSON.stringify(labels)
);
check(
  "folder head carries the full path and the 工 seal",
  await evalJs(
    `document.querySelector("#history .history-repo").title.startsWith("E:\\\\项目\\\\言") && document.querySelector("#history .repo-seal").textContent === "工"`
  )
);
check(
  "work badge hidden inside folder groups",
  await evalJs(
    `getComputedStyle(document.querySelector("#history .history-repo-items .history-item.is-work .history-open"), "::before").display === "none"`
  )
);
// 收起 / 展开
await evalJs(`document.querySelector("#history .history-repo").click(); true`);
await sleep(200);
check(
  "clicking the head collapses the group",
  await evalJs(
    `(g => g.classList.contains("collapsed") && !g.querySelector(".history-open"))(document.querySelector("#history .history-repo-group"))`
  )
);
await waitFor(`__yanState().settings.collapsedRepos?.length === 1`, 5000);
check("collapse remembered", true);
await evalJs(`document.querySelector("#history .history-repo").click(); true`);
await sleep(200);
check(
  "clicking again expands",
  await evalJs(
    `(g => !g.classList.contains("collapsed") && g.querySelectorAll(".history-open").length === 2)(document.querySelector("#history .history-repo-group"))`
  )
);
// 打开组内的对话再收起：收起的组里仍露出当前这条
await evalJs(`document.querySelector('#history [data-conversation="w2"] .history-open').click(); true`);
await sleep(300);
await evalJs(`document.querySelector("#history .history-repo").click(); true`);
await sleep(200);
await shot("history.png");
check(
  "a collapsed group still shows the open conversation",
  (await evalJs(
    `[...document.querySelector("#history .history-repo-group.collapsed").querySelectorAll(".history-open")].map(b => b.textContent).join(",")`
  )) === "言 乙"
);
await evalJs(`document.querySelector("#history .history-repo").click(); true`);
await sleep(200);
// 组头右侧的「＋」在此目录另起一纸
await evalJs(`document.querySelectorAll("#history .repo-new")[1].click(); true`);
await sleep(400);
check(
  "＋ on a folder starts a new sheet in that folder",
  await evalJs(
    `!document.querySelector("#welcome").classList.contains("hidden") && __yanState().settings.pendingWorkdir === "D:\\\\code\\\\别处" && document.querySelector("#workdirChip")?.textContent.includes("别处")`
  )
);
await evalJs(`document.querySelector("#workdirChip").click(); true`);
await sleep(200);
await evalJs(`(i => { i.value = ""; i.dispatchEvent(new Event("input")); })(document.querySelector("#welcomeChips #workdirInput")); true`);
await sleep(300);
check(
  "the timeline does not change with the pending directory",
  JSON.stringify(await outline()) === JSON.stringify(labels),
  JSON.stringify(await outline())
);
// 历史条目只有一枚「⋯」，点开才见菜单：置顶 / 改名 / 绑定 / 删除；置顶后菜单文字随之变
check(
  "history rows show a single ⋯ trigger",
  await evalJs(
    `[...document.querySelectorAll("#history .history-item .history-tool")].every(b => b.dataset.historyAction === "menu" && b.textContent === "⋯")`
  )
);
await evalJs(`document.querySelector('#history [data-conversation="w2"] .history-more').click(); true`);
await sleep(150);
check(
  "⋯ opens a floating menu with the five actions",
  (await evalJs(`[...document.querySelectorAll(".chip-pop[data-kind=history] [data-menu]")].map(b => b.textContent).join()`)) ===
    "置顶,改名,更换目录,导出存入卷宗,删除"
);
await evalJs(`document.querySelector('.chip-pop[data-kind=history] [data-menu="pin"]').click(); true`);
await sleep(200);
check(
  "pin from the menu pins the row and closes the menu",
  await evalJs(
    `!document.querySelector(".chip-pop") && __yanState().conversations.find(c => c.id === "w2").pinned === true`
  )
);
await evalJs(`document.querySelector('#history [data-conversation="w2"] .history-more').click(); true`);
await sleep(150);
check(
  "pinned row offers 取消置顶",
  (await evalJs(`document.querySelector('.chip-pop[data-kind=history] [data-menu="pin"]').textContent`)) === "取消置顶"
);
await evalJs(`document.querySelector('.chip-pop[data-kind=history] [data-menu="pin"]').click(); true`);
await sleep(200);
await evalJs(`document.querySelector('#history [data-conversation="w2"] .history-more').click(); true`);
await sleep(150);
await evalJs(`document.querySelector('.chip-pop[data-kind=history] [data-menu="rename"]').click(); true`);
await sleep(200);
check(
  "rename from the menu opens the inline editor",
  await evalJs(`!!document.querySelector('#history [data-conversation="w2"] .history-rename')`)
);
await evalJs(
  `(i => { i.value = "改过的名"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })(document.querySelector('#history [data-conversation="w2"] .history-rename')); true`
);
await sleep(200);
check("renamed", (await evalJs(`document.querySelector('#history [data-conversation="w2"] .history-open').textContent`)) === "改过的名");
// 请示表单（对谈里也可用）：先换回有余墨的模型
await evalJs(`document.querySelector("#welcome .model-trigger").click(); true`);
await sleep(200);
await evalJs(`document.querySelector('#modelMenu .model-option[data-profile="p2"]').click(); true`);
await sleep(300);
await evalJs(
  `document.querySelector("#welcomeInput").value = "ASK 请问"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(
  `!document.querySelector("#approvalBar").classList.contains("hidden") && document.querySelectorAll("#approvalBar .ask-q").length === 2`
);
check(
  "form pops above the composer, one question per page",
  await evalJs(
    `document.querySelector("#approvalBar .approval-title").textContent === "第一问 · 共 2 问" && !document.querySelector('#approvalBar .ask-q[data-q="0"]').classList.contains("hidden") && document.querySelector('#approvalBar .ask-q[data-q="1"]').classList.contains("hidden") && document.querySelector('#approvalBar [data-form="submit"]').classList.contains("hidden") && document.querySelector('#approvalBar [data-form="prev"]').disabled && document.querySelector('#approvalBar [data-form="next"]').textContent === "›"`
  )
);
check(
  "trail card says the form is above",
  await evalJs(`document.querySelector('#messages .tool-step[data-status="pending"] .tool-label').textContent === "请示"`)
);
await evalJs(
  `document.querySelector('#approvalBar .ask-q[data-q="0"] .ask-opt[data-opt="1"]').click(); document.querySelector('#approvalBar .ask-q[data-q="0"] .ask-opt[data-opt="0"]').click(); true`
);
check(
  "single choice keeps one option",
  await evalJs(
    `[...document.querySelectorAll('#approvalBar .ask-q[data-q="0"] .ask-opt')].map(b => b.getAttribute("aria-checked")).join() === "true,false"`
  )
);
// 单选：选项与「自行填写」二选一——填了字就清掉选项，再点选项就清掉填的字
await evalJs(
  `(i => { i.value = "别的"; i.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector('#approvalBar .ask-q[data-q="0"] .ask-other')); true`
);
check(
  "typing a custom answer clears the picked option (single choice)",
  await evalJs(`[...document.querySelectorAll('#approvalBar .ask-q[data-q="0"] .ask-opt[aria-checked="true"]')].length === 0`)
);
await evalJs(`document.querySelector('#approvalBar .ask-q[data-q="0"] .ask-opt[data-opt="0"]').click(); true`);
check(
  "picking an option clears the custom answer (single choice)",
  await evalJs(
    `document.querySelector('#approvalBar .ask-q[data-q="0"] .ask-other').value === "" && document.querySelector('#approvalBar .ask-q[data-q="0"] .ask-opt[data-opt="0"]').getAttribute("aria-checked") === "true"`
  )
);
await evalJs(`document.querySelector('#approvalBar [data-form="next"]').click(); true`);
await sleep(100);
check(
  "next page shows the second question with submit",
  await evalJs(
    `document.querySelector("#approvalBar .approval-title").textContent === "第二问 · 共 2 问" && !document.querySelector('#approvalBar .ask-q[data-q="1"]').classList.contains("hidden") && document.querySelector('#approvalBar .ask-q[data-q="0"]').classList.contains("hidden") && !document.querySelector('#approvalBar [data-form="submit"]').classList.contains("hidden") && document.querySelector('#approvalBar [data-form="submit"]').textContent === "✓" && document.querySelector('#approvalBar [data-form="next"]').classList.contains("hidden") && !document.querySelector('#approvalBar [data-form="prev"]').disabled`
  )
);
await evalJs(`document.querySelector('#approvalBar [data-form="prev"]').click(); true`);
await sleep(100);
check(
  "going back keeps the first answer",
  await evalJs(
    `!document.querySelector('#approvalBar .ask-q[data-q="0"]').classList.contains("hidden") && document.querySelector('#approvalBar .ask-q[data-q="0"] .ask-opt[data-opt="0"]').getAttribute("aria-checked") === "true"`
  )
);
await evalJs(`document.querySelector('#approvalBar [data-form="next"]').click(); true`);
await sleep(100);
await evalJs(
  `document.querySelector('#approvalBar .ask-q[data-q="1"] .ask-opt[data-opt="0"]').click(); document.querySelector('#approvalBar .ask-q[data-q="1"] .ask-opt[data-opt="2"]').click(); document.querySelector('#approvalBar .ask-q[data-q="1"] .ask-other').value = "还有卷宗"; true`
);
check(
  "multi choice keeps both",
  await evalJs(
    `[...document.querySelectorAll('#approvalBar .ask-q[data-q="1"] .ask-opt')].map(b => b.getAttribute("aria-checked")).join() === "true,false,true"`
  )
);
// 补言：作答途中输入框里写了字，印由「止」变「寄」；Enter 寄出，落在行迹里一步「补言 · 待寄」；请示答复回去后随工具结果一并递给模型
check(
  "seal reads 止 while the reply runs and the box is empty",
  (await evalJs(`document.querySelector("#chatSend").dataset.glyph`)) === "止"
);
await evalJs(
  `(i => { i.value = "补一句：ASK 顺便看看卷宗"; i.dispatchEvent(new Event("input")); })(document.querySelector("#chatInput")); true`
);
check(
  "typing during a reply turns the seal into 寄 with a 插言 hint",
  await evalJs(`document.querySelector("#chatSend").dataset.glyph === "寄" && document.querySelector("#chatSend").title.startsWith("插言")`)
);
await evalJs(
  `document.querySelector("#chatInput").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); true`
);
await sleep(200);
check(
  "supplement lands in the trail as a pending 补言 step; box cleared; reply still running; form still up",
  await evalJs(
    `(s => !!s && s.dataset.status === "running" && s.querySelector(".tool-title").textContent === "补一句：ASK 顺便看看卷宗" && s.querySelector(".tool-meta").textContent === "待寄")(document.querySelector('#messages .tool-step-note')) && document.querySelector("#chatInput").value === "" && document.querySelector("#chatSend").dataset.glyph === "止" && !document.querySelector("#approvalBar").classList.contains("hidden")`
  )
);
// 请示挂着时第一轮思绪已收（正文起过笔）；答复回去、模型接着想，同一块思绪要重新标成在写并摊开；收尾再收
await waitFor(
  `(d => d?.dataset.state === "done" && !d.open)([...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".reasoning"))`,
  3000
);
check("thinking before the form is stamped done and settles closed while the form waits", true);
await evalJs(`document.querySelector('#approvalBar [data-form="submit"]').click(); true`);
await waitFor(
  `(d => d?.dataset.state === "live" && d.open)([...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".reasoning"))`,
  3000
);
check("thinking after the answer turns the block live again and opens it", true);
await waitFor(`[...document.querySelectorAll('#messages .message.assistant')].at(-1)?.dataset.status === "complete"`);
await waitFor(
  `(d => d?.dataset.state === "done" && !d.open)([...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelector(".reasoning"))`,
  3000
);
check("thinking block settles closed once the answer is written", true);
const askText = await evalJs(
  `[...[...document.querySelectorAll('#messages .message.assistant')].at(-1).querySelectorAll(".markdown")].map(n => n.textContent).join(" ")`
);
check(
  "answers reach the model; hint and tool present",
  askText.includes("ASK|hint:yes|tool:yes|") &&
    askText.includes("用哪种风格？ → 清简") &&
    askText.includes("要哪些部分？ → 首页、关于、还有卷宗"),
  askText
);
check(
  "supplement was handed to the model after the tool result, marked as said mid-reply; trail step now 已递",
  askText.includes("|note:［用户在你作答途中补充的话］补一句：ASK 顺便看看卷宗") &&
    (await evalJs(
      `(s => s.dataset.status === "done" && s.querySelector(".tool-meta").textContent === "已递")(document.querySelector('#messages .tool-step-note'))`
    )),
  askText
);
check(
  "supplement persists in the trail and in the digest for the next turn",
  await evalJs(
    `(c => c.messages.at(-1).steps.some(s => s.name === "user_note" && s.status === "done" && s.note === "补一句：ASK 顺便看看卷宗"))(__yanState().conversations[0])`
  )
);
check(
  "form bar gone; trail card shows the answers",
  await evalJs(
    `(document.querySelector("#approvalBar").classList.contains("hidden") || document.querySelector("#approvalBar").classList.contains("leaving")) && document.querySelector('#messages .tool-step[data-status="done"] .tool-note').textContent.includes("风格：清简")`
  )
);
close();
