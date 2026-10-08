// 断网时帮手的回报：上一答断着，回报不另起一答（另起的也会断，续上那一答时就成了底下的残留），记在对话上、下一答开工时递上。
// 旧数据里已经留下的那截「回报 + 空答」，续写时收回来交给续上的这一答
import { connect, check, sleep, PAGE } from "./lib.mjs";

const { send, evalJs, waitFor, close } = await connect();
const T = "2026-01-01T00:00:00.000Z";
const helper = (id, title) => ({
  id,
  name: "delegate",
  arguments: JSON.stringify({ title, task: "做点事" }),
  status: "error",
  title,
  result: "1 步 · 3 秒 · 未完成",
  sub: { id: `sub-${id}`, helper: `sub-${id}`, task: "做点事", content: "", reasoning: "", steps: [], status: "error", usage: null, report: "", charged: true }
});
const conversations = [
  {
    id: "fold",
    title: "收回残留",
    createdAt: T,
    updatedAt: T,
    profileId: "p1",
    forks: [],
    threads: [],
    messages: [
      { id: "u1", role: "user", content: "RELAYHOLD 起手", timestamp: T },
      { id: "a1", role: "assistant", content: "做到一半。", timestamp: T, status: "interrupted", error: "网络中断", steps: [helper("d1", "甲"), helper("d2", "乙")] },
      {
        id: "u2",
        role: "user",
        content: "REPORT-KEPT 甲乙都未完成",
        timestamp: T,
        relay: [
          { step: "d1", title: "甲", ok: false },
          { step: "d2", title: "乙", ok: false }
        ]
      },
      { id: "a2", role: "assistant", content: "", timestamp: T, status: "stopped" }
    ]
  },
  {
    id: "held",
    title: "记下的回报",
    createdAt: "2026-01-01T00:00:01.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    profileId: "p1",
    forks: [],
    threads: [],
    heldReports: [
      { report: "REPORT-KEPT 丙未完成", relay: { step: "d3", title: "丙", ok: false } },
      { report: "REPORT-GONE 别的版本里的", relay: { step: "elsewhere", title: "丁", ok: false } }
    ],
    messages: [
      { id: "u3", role: "user", content: "RELAYHOLD 起手", timestamp: T },
      { id: "a3", role: "assistant", content: "做到一半。", timestamp: T, status: "interrupted", error: "网络中断", steps: [helper("d3", "丙")] }
    ]
  }
];
const seed = id =>
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", lastView: "chat", lastConversationId: "${id}", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", maxTokens: 8192, quota: "100k", usedTokens: 0 }], conversations: ${JSON.stringify(conversations)}, library: [], drafts: {} })); true`;
const chat = id => `__yanState().conversations.find(c => c.id === "${id}")`;

// 一：续写断着的那一答，底下只有回报另起、没写出东西的一答——收回来，回报在续写开工时递上
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(seed("fold"));
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-message="a1"] [data-action="resume"]')`);
await evalJs(`document.querySelector('[data-message="a1"] [data-action="resume"]').click(); true`);
await waitFor(`${chat("fold")}.messages[1].status === "complete"`, 20000);
const fold = JSON.parse(
  await evalJs(
    `(c => JSON.stringify({ shape: c.messages.map(m => m.id).join(","), content: c.messages[1].content, notes: c.messages[1].steps.filter(s => s.name === "relay_note").map(s => s.title + ":" + s.status), held: c.heldReports || null, relayLines: document.querySelectorAll("#messages .message.relay").length }))(${chat("fold")})`
  )
);
check("resuming folds the empty relay turn back; nothing is left below", fold.shape === "u1,a1" && fold.relayLines === 0, JSON.stringify(fold));
check("the folded reports reach the resumed answer, without empty questions", /kept:true\|dropped:false\|empty:false/.test(fold.content), fold.content);
check("each report lands as a delivered step in the trail", fold.notes.join("|") === "甲:done|乙:done" && !fold.held, JSON.stringify(fold));

// 二：记在对话上的回报，下一答（这里是新的一问）开工时递上；派它的那一步已不在眼前这条路上的不递
// 两段一并灌进去（桥接的存储记着上一段，再灌一回不作数）：从侧栏换到这一段
await evalJs(`document.querySelector('#history [data-conversation="held"] .history-open').click(); true`);
await waitFor(`!!document.querySelector('[data-message="a3"]')`);
await sleep(800);
await evalJs(`(input => {
  input.value = "RELAYHOLD 接着说";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return true;
})(document.querySelector("#chatInput"))`);
await waitFor(`(m => m.role === "assistant" && m.status === "complete")(${chat("held")}.messages.at(-1))`, 20000);
const held = JSON.parse(
  await evalJs(
    `(c => JSON.stringify({ content: c.messages.at(-1).content, notes: (c.messages.at(-1).steps || []).filter(s => s.name === "relay_note").map(s => s.title), held: c.heldReports || null }))(${chat("held")})`
  )
);
check("held reports go out with the next answer", /kept:true\|dropped:false/.test(held.content) && !held.held, JSON.stringify(held));
check("a report whose helper is off the current path is dropped", held.notes.join("|") === "丙", JSON.stringify(held));

// 三：真走一遍——派了帮手，这一答随即断了；回报到了不另起一答，断着的那一答自己续上，回报递进去
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(400);
await evalJs(`(input => {
  input.value = "RELAYWAKE";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return true;
})(document.querySelector("#welcomeInput"))`);
const wake = `__yanState().conversations.find(c => c.messages[0]?.content === "RELAYWAKE")`;
let sawBreak = false;
for (let i = 0; i < 300; i++) {
  const status = await evalJs(`${wake}?.messages[1]?.status || ""`);
  if (status === "interrupted") sawBreak = true;
  if (status === "complete") break;
  await sleep(50);
}
const woke = JSON.parse(
  await evalJs(
    `(c => JSON.stringify({ shape: c.messages.map(m => m.role + (m.relay ? ":relay" : "")).join(","), status: c.messages[1].status, content: c.messages[1].content, notes: (c.messages[1].steps || []).filter(s => s.name === "relay_note").map(s => s.status), held: c.heldReports || null }))(${wake})`
  )
);
check("the answer broke off while its helper was still out", sawBreak, JSON.stringify(woke));
check(
  "the report resumes the broken answer instead of opening a new one",
  woke.shape === "user,assistant" && woke.status === "complete" && /RELAYWAKE done｜reports:1｜resumed:true/.test(woke.content) && woke.notes.join() === "done" && !woke.held,
  JSON.stringify(woke)
);

await close();
