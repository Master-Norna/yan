// 后台仍在执行时，候跟随别页更新；帮手停止后保存、刷新也不能把它移进冷行迹而丢掉。
import { mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
import { shellCommand } from "./helpers/shell-command.mjs";

mkdirSync(WORK, { recursive: true });
const post = async (route, body) => {
  const response = await fetch(PAGE.slice(0, -1) + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw Error(await response.text());
  return response.json();
};
const c = {
  id: "clepsydra-sync",
  title: "后台任务",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  workdir: WORK,
  messages: [
    { id: "u1", role: "user", content: "检查后台任务", timestamp: new Date().toISOString() },
    { id: "a1", role: "assistant", content: "任务尚未结束。", status: "complete", steps: [], timestamp: new Date().toISOString() }
  ]
};
const save = () => post("/api/chats/save", { root: "", savedAt: Date.now(), conversation: c });
let leased = [c.id],
  bg;
const lease = () => post("/api/chats/lease", { owner: "clepsydra-other-page", ids: leased });
await save();
await lease();
const beat = setInterval(() => void lease(), 2500);
const { send, evalJs, waitFor, close } = await connect();
const visible = `!document.querySelector('#clepsydra').classList.contains('hidden')`;
try {
  await send("Page.navigate", { url: PAGE + "preview.html" });
  await sleep(400);
  await evalJs(
    `localStorage.setItem('yan-chat-v1', JSON.stringify({ version: 5, settings: { name: '测', theme: 'light', inkMotion: 'off', autoTitle: false }, profiles: [], conversations: [], library: [], drafts: {} })); true`
  );
  await send("Page.navigate", { url: PAGE });
  await waitFor(
    `typeof document.querySelector('#openLibrary').onclick === 'function' && __yanState().conversations.some(c => c.id === '${c.id}')`,
    10000
  );
  check("no background task initially, no entry", !(await evalJs(visible)));
  const command = shellCommand("Start-Sleep -Seconds 90", "sleep 90");
  bg = await post("/api/work/run", { workdir: WORK, command, background: true });
  c.messages[1].steps = [
    {
      id: "delegate1",
      name: "delegate",
      arguments: "{}",
      title: "检查任务",
      status: "done",
      sub: {
        id: "helper1",
        task: "检查任务",
        content: "帮手已停止。",
        reasoning: "长行迹".repeat(6000),
        status: "stopped",
        steps: [
          {
            id: "bg-step",
            name: "run_command",
            arguments: "{}",
            title: command,
            gist: "后台任务回归检查",
            status: "done",
            bg: { id: bg.id, key: bg.key, state: "running", started: Date.now() }
          }
        ]
      }
    }
  ];
  await save();
  await waitFor(visible, 10000).catch(() => {});
  check("task started elsewhere appears without switching chats or refreshing", await evalJs(visible));

  leased = [];
  await lease();
  clearInterval(beat);
  await sleep(4000);
  await evalJs(`document.querySelector('[data-conversation="${c.id}"] .history-open').click(); true`);
  await evalJs(`document.querySelector('#themeToggle').click(); true`);
  await sleep(2000);
  const saved = (await post("/api/chats/load", { root: "", ids: [c.id] })).items[0].conversation.messages[1];
  check(
    "saving a stopped helper keeps its active background step in the conversation",
    !saved.cold && saved.steps[0].sub.steps?.[0].bg.state === "running"
  );
  await send("Page.navigate", { url: PAGE + "preview.html" });
  await sleep(400);
  await send("Page.navigate", { url: PAGE });
  await waitFor(visible, 10000).catch(() => {});
  const status = await post("/api/work/check", { id: bg.id, key: bg.key, wait: 0 });
  check("after reloading, the real task is still running and the entry remains visible", status.running && (await evalJs(visible)));
  await post("/api/work/check", { id: bg.id, key: bg.key, stop: true });
  await waitFor(`!(${visible})`, 10000).catch(() => {});
  check("entry disappears after the task actually ends", !(await evalJs(visible)));
} finally {
  clearInterval(beat);
  leased = [];
  await lease();
  if (bg) await post("/api/work/check", { id: bg.id, key: bg.key, stop: true }).catch(() => {});
  await close();
}
