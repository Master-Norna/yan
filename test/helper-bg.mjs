// 帮手 × 后台指令：帮手挂了后台指令就收工，不必醒着轮询——先把此刻的话作为进展交给主对话、睡下；
// 指令结束的消息寄给帮手自己（不是主对话），它醒来据输出接着做、再交差。主模型两回都是被回报叫醒的
import { mkdirSync } from "node:fs";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
mkdirSync(WORK, { recursive: true });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const text = "HELPERBG 派个帮手跑后台";
await evalJs(
  `document.querySelector("#welcomeInput").value = ${JSON.stringify(text)}; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
const conv = `__yanState().conversations.find(c => c.messages[0]?.content === ${JSON.stringify(text)})`,
  helper = `${conv}?.messages[1]?.steps?.find(s => s.name === "delegate")`;

// 睡着：帮手挂上指令、说完一句就交进展，签上写「等后台」，主模型被这份进展叫醒一回
await waitFor(`${helper}?.sub?.waiting === true`, 15000);
const asleep = await evalJs(
  `(s => ({ status: s.status, sub: s.sub.status, bg: s.sub.steps.find(x => x.name === "run_command")?.bg?.state, bar: document.querySelector("#helperBar")?.textContent || "" }))(${helper})`
);
check(
  "with only its background command left, the helper reports progress and sleeps — still counted as working",
  asleep.status === "running" && asleep.sub === "streaming" && asleep.bg === "running" && asleep.bar.includes("等后台"),
  JSON.stringify(asleep)
);
await waitFor(`${conv}?.messages.length >= 4 && ${conv}.messages[3].status === "complete"`, 15000);
check(
  "the progress woke the main model once, as a report it can tell apart",
  await evalJs(`${conv}.messages[3].content === "HELPERBG got|wait"`),
  await evalJs(`${conv}.messages[3].content`)
);

// 醒来：指令结束的消息寄给帮手，它看到输出、交差；主模型再被叫醒一回，两份都收到
await waitFor(
  `${conv}?.messages.at(-1)?.content.includes("wait,done") && ${conv}.messages.at(-1).status === "complete"`,
  25000
).catch(() => {});
const done = await evalJs(
  `(c => { const s = c.messages[1].steps.find(x => x.name === "delegate"); return { shape: c.messages.map(m => m.role + (m.relay ? ":relay" : "")).join(","), last: c.messages.at(-1).content, status: s.status, report: s.sub.report, waiting: !!s.sub.waiting, bg: s.sub.steps.find(x => x.name === "run_command")?.bg?.state, relay: s.sub.steps.filter(x => x.name === "relay_note").map(x => x.status + ":" + x.relay?.kind), mainRelays: c.messages.flatMap(m => m.steps || []).filter(x => x.name === "relay_note").length, bar: document.querySelector("#helperBar")?.classList.contains("hidden") }; })(${conv})`
);
check(
  "the command's end was mailed to the helper itself, landing in its own timeline",
  done.bg === "done" && done.relay.join() === "done:bg" && done.mainRelays === 0,
  JSON.stringify(done)
);
check(
  "the helper woke, saw the output and turned in its report",
  done.status === "done" && /HBG-SUB done\|saw:BG-OUT-42/.test(done.report) && !done.waiting,
  JSON.stringify(done)
);
check(
  "the main model was woken twice, by progress and then by the report",
  done.shape === "user,assistant,user:relay,assistant,user:relay,assistant" && done.last === "HELPERBG got|wait,done",
  done.shape + " " + done.last
);
check("nothing is left running once the helper is done", await evalJs(`!__yanState().conversations.some(c => c.messages.some(m => m.status === "streaming"))`));
close();
