// 书眉的漏：挂着候时右上角有一只漏壶，点开分「在跑 / 约定」两节列各条（那句白话或编号、已跑多久或几时到），
// 几段对话的都在时对话名写在行下；点一行回到起它的那一步；都了结就不画
import { mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
mkdirSync(WORK, { recursive: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
check("nothing hung, no clepsydra", await evalJs(`document.querySelector("#clepsydra").classList.contains("hidden")`));

// 假模型挂一条先睡六秒的后台指令就收尾
await evalJs(
  `document.querySelector("#newChat").click(); setTimeout(() => { document.querySelector("#welcomeInput").value = "BGRELOAD"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); }, 300); true`
);
await waitFor(`!document.querySelector("#clepsydra").classList.contains("hidden")`, 10000).catch(() => {});
check("a hung command shows the clepsydra", await evalJs(`!document.querySelector("#clepsydra").classList.contains("hidden")`));
await evalJs(`document.querySelector("#clepsydra .clepsydra-btn").click(); true`);
await sleep(200);
const open = await evalJs(
  `({ secs: [...document.querySelectorAll("#clepsydra .clepsydra-sec")].map(s => s.textContent), rows: [...document.querySelectorAll("#clepsydra .clepsydra-row")].map(r => r.textContent), from: document.querySelectorAll("#clepsydra .clepsydra-from").length, title: document.querySelector("#clepsydra .clepsydra-row")?.title })`
);
check(
  "opened: one row with the id and how long under 在跑, no chat names for a single chat, the command on hover",
  open.secs.join("|") === "在跑 · 1" &&
    open.rows.length === 1 &&
    /^bg\d+不到 1 分钟›$/.test(open.rows[0]) &&
    open.from === 0 &&
    /sleep|Start-Sleep|timeout|ping/i.test(open.title || ""),
  JSON.stringify(open)
);
await evalJs(`document.querySelector("#clepsydra .clepsydra-row").click(); true`);
await waitFor(`document.querySelector('#messages .tool-step[data-tool="run_command"]')?.closest('.tool-stack')?.open`, 10000);
// 跨过详情自动收起的 700ms 窗口：主动回到后台步骤后，行迹应保持展开。
await sleep(900);
const revealState = await evalJs(
  `({ listHidden: document.querySelector("#clepsydra .clepsydra-list").classList.contains("hidden"), stackOpen: document.querySelector('#messages .tool-step[data-tool="run_command"]')?.closest(".tool-stack")?.open })`
);
check(
  "clicking a row closes the list and opens the trail at the step that hung it",
  revealState.listHidden && revealState.stackOpen,
  JSON.stringify(revealState)
);
await waitFor(`document.querySelector("#clepsydra").classList.contains("hidden")`, 20000).catch(() => {});
check("when it ends the clepsydra goes away", await evalJs(`document.querySelector("#clepsydra").classList.contains("hidden")`));

// 看样子：再记上几条挂了许久的（只记在步骤上、没人等，不会被收口），一段是当前这段；别段另有一条约到明早的
await evalJs(`(() => {
  const s = __yanState(), cur = s.conversations.find(c => c.messages[0]?.content === "BGRELOAD"), at = Date.now();
  const hang = (id, minutes, command, gist) => ({ id: "st_" + id, name: "run_command", arguments: "{}", status: "done", title: command, ...(gist ? { gist } : {}), background: true, bg: { id, key: "x-" + id, state: "running", started: at - minutes * 60000 } });
  cur.messages[1].steps.push(hang("bg7", 26, "modal run run_j200_modal_a.py::build --detach", "在 Modal 上构建 j200 镜像"), hang("bg8", 4, "python poll_volume.py --until results/journal.json"));
  const morning = new Date(); morning.setDate(morning.getDate() + 1); morning.setHours(9, 0, 0, 0);
  const timer = { id: "st_t9", name: "set_timer", arguments: "{}", status: "done", title: "看 PR 回复", gist: "看 PR 回复", timer: { id: "t9", due: morning.getTime(), every: 86400000, state: "waiting", created: at } };
  s.conversations.push({ ...structuredClone(cur), id: "c-other", title: "正大杯", messages: [{ ...structuredClone(cur.messages[0]), id: "m-o1" }, { ...structuredClone(cur.messages[1]), id: "m-o2", steps: [hang("bg1", 72, "Rscript sem_fit.R --boot 2000"), timer] }] });
  document.querySelector("#themeToggle").click(); document.querySelector("#themeToggle").click();
  return true;
})()`);
await sleep(300);
const many = await evalJs(
  `({ n: document.querySelector("#clepsydra .clepsydra-n").textContent, counted: document.querySelector("#clepsydra").classList.contains("counted") })`
);
check("several hung: the count shows", many.n === "4" && many.counted, JSON.stringify(many));
await evalJs(`document.querySelector("#clepsydra .clepsydra-btn").click(); true`);
await sleep(300);
const groups = await evalJs(
  `({ secs: [...document.querySelectorAll("#clepsydra .clepsydra-sec")].map(s => s.textContent), rows: [...document.querySelectorAll("#clepsydra .clepsydra-row")].map(r => r.textContent), here: [...document.querySelectorAll("#clepsydra .clepsydra-from")].map(f => f.classList.contains("here")) })`
);
check(
  "across chats: two sections, this chat's rows first and marked, the chat named under each row, timers say when they're due",
  groups.secs.join("|") === "在跑 · 3|约定 · 1" &&
    groups.rows.some(r => r.startsWith("在 Modal 上构建 j200 镜像26 分›")) &&
    groups.rows.includes("bg11 小时 12 分›正大杯") &&
    groups.rows.at(-1) === "看 PR 回复明 9:00 · 每 1 天›正大杯" &&
    groups.here.join() === "true,true,false,false",
  JSON.stringify(groups)
);
await shot("clepsydra-open.png");
await evalJs(`document.querySelector("#clepsydra .clepsydra-btn").click(); true`);
const box = await evalJs(
  `(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))(document.querySelector("#clepsydra .clepsydra-btn").getBoundingClientRect())`
);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
await sleep(700);
await shot("clepsydra-hover.png");
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 400 });
await evalJs(`document.querySelector("#themeToggle").click(); true`);
await sleep(400);
await evalJs(`document.querySelector("#clepsydra .clepsydra-btn").click(); true`);
await sleep(300);
await shot("clepsydra-dark.png");
// 点别段的一行：切过去
await evalJs(`[...document.querySelectorAll("#clepsydra .clepsydra-row")].find(r => r.textContent.startsWith("bg1"))?.click(); true`);
await sleep(500);
check(
  "a row in another conversation switches to it",
  await evalJs(`document.querySelector('#messages .tool-step[data-step-id="st_bg1"]') !== null`)
);
await close();
