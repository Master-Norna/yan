// 帮手断了挂着等人续：不是谁叫停的就断了（接口拒了、页面刷新），不回报、不叫醒主模型；签上状态位换成续写那一笔，
// 点了从断处接着做（历史里有断前说的话与「接着做」），做完照常回报。主答的「续写」把这段对话里断着的帮手一并续上
import { connect, check, sleep, PAGE } from "./lib.mjs";

const { send, evalJs, waitFor, close, shot } = await connect();
const T = "2026-01-01T00:00:00.000Z";
const task = "BREAKSUB：做完回报。";
const helper = (id, status, subStatus) => ({
  id,
  name: "delegate",
  arguments: JSON.stringify({ title: "会断的活", task }),
  status,
  title: "会断的活",
  ...(status === "interrupted" ? { result: "连不上接口" } : {}),
  sub: { id: `sub-${id}`, helper: `sub-${id}`, task, content: "断前写的一段。", reasoning: "", steps: [], status: subStatus, usage: null }
});
const conversations = [
  {
    // 页面刷新时帮手还在做：开页即挂着
    id: "reload",
    title: "刷新时在做",
    createdAt: T,
    updatedAt: T,
    profileId: "p1",
    forks: [],
    threads: [],
    messages: [
      { id: "u1", role: "user", content: "HELPERBREAK 刷新那一段", timestamp: T },
      {
        id: "a1",
        role: "assistant",
        content: "派一名帮手。等回报。",
        timestamp: T,
        status: "complete",
        steps: [helper("r1", "running", "streaming")]
      }
    ]
  },
  {
    // 主答与帮手一起断着：点主答的「续写」，两边一并续上
    id: "both",
    title: "一起断着",
    createdAt: "2026-01-01T00:00:01.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    profileId: "p1",
    forks: [],
    threads: [],
    messages: [
      { id: "u2", role: "user", content: "HELPERBREAK 一起断", timestamp: T },
      {
        id: "a2",
        role: "assistant",
        content: "派一名帮手。",
        timestamp: T,
        status: "interrupted",
        error: "网络中断",
        steps: [helper("b1", "interrupted", "interrupted")]
      }
    ]
  }
];
const seed = `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", lastView: "chat", lastConversationId: "reload", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", maxTokens: 8192, quota: "100k", usedTokens: 0 }], conversations: ${JSON.stringify(conversations)}, library: [], drafts: {} })); true`;
const chat = id => `__yanState().conversations.find(c => c.id === "${id}")`;
// 收着的行迹开页时不画身子（见 src/07-paint.js 的 paintStack），像人一样先点开行迹再找里面的签
const openTrails = `!!document.querySelector("#messages details.tool-stack") && ([...document.querySelectorAll("#messages .assistant-block > details.tool-stack:not([open]) > summary")].forEach(s => s.click()), true)`;
const card = id => `document.querySelector('#messages .tool-step-delegate[data-step-id="${id}"]')`;

// 一：页面刷新时还在做的帮手，开页即挂着——签上一笔续写，不再是 ×
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(seed);
await send("Page.navigate", { url: PAGE });
await waitFor(openTrails);
await waitFor(`!!${card("r1")}`);
const reload = JSON.parse(
  await evalJs(
    `(c => JSON.stringify({ status: ${card("r1")}.dataset.status, goon: !!${card("r1")}.querySelector(".tool-state.goon"), meta: ${card("r1")}.querySelector(".tool-meta").textContent, step: c.messages[1].steps[0].status, sub: c.messages[1].steps[0].sub.status }))(${chat("reload")})`
  )
);
check(
  "a helper cut off by a page reload hangs with a resume mark, not an ×",
  reload.status === "interrupted" &&
    reload.goon &&
    reload.step === "interrupted" &&
    reload.sub === "interrupted" &&
    reload.meta.includes("中辍"),
  JSON.stringify(reload)
);
// 点那一笔：续上（不是开面板），做完照常回报、叫醒主模型另起一答
await evalJs(`${card("r1")}.querySelector(".tool-state.goon").click(); true`);
await waitFor(`${chat("reload")}.messages.length >= 4 && ${chat("reload")}.messages.at(-1).status === "complete"`, 20000);
const resumed = JSON.parse(
  await evalJs(
    `(c => JSON.stringify({ step: c.messages[1].steps[0].status, said: c.messages[1].steps[0].sub.content, last: c.messages.at(-1).content, panel: !document.querySelector("#helperModal") || document.querySelector("#helperModal").classList.contains("hidden") }))(${chat("reload")})`
  )
);
check("clicking the mark resumes the helper rather than opening its panel", resumed.panel, JSON.stringify(resumed));
check(
  "the resumed helper picks up where it broke off and reports back",
  resumed.step === "done" &&
    /断前写的一段/.test(resumed.said) &&
    /BREAKSUB done｜kept:true/.test(resumed.said) &&
    /HELPERBREAK got｜done/.test(resumed.last),
  JSON.stringify(resumed)
);

// 二：主答与帮手一起断着，点主答的「续写」：帮手一并续上，主答续完，帮手的回报照常到
await evalJs(`document.querySelector('#history [data-conversation="both"] .history-open').click(); true`);
await waitFor(`!!document.querySelector('[data-message="a2"] [data-action="resume"]')`);
await evalJs(`document.querySelector('[data-message="a2"] [data-action="resume"]').click(); true`);
await waitFor(
  `(c => c.messages[1].steps[0].status === "done" && c.messages.at(-1).status === "complete" && c.messages.some(m => m.role === "assistant" && /HELPERBREAK got｜done/.test(m.content)))(${chat("both")})`,
  20000
);
const both = JSON.parse(
  await evalJs(`(c => JSON.stringify({ main: c.messages[1].status, said: c.messages[1].steps[0].sub.content }))(${chat("both")})`)
);
check(
  "resuming the answer resumes its broken helpers too",
  both.main === "complete" && /BREAKSUB done｜kept:true/.test(both.said),
  JSON.stringify(both)
);

// 三：真走一遍——帮手半路被接口拒了：挂着，不回报、不叫醒主模型；点「续」接着做完
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(400);
await evalJs(`(input => {
  input.value = "HELPERBREAK";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return true;
})(document.querySelector("#welcomeInput"))`);
await waitFor(`!!document.querySelector('#messages .tool-step-delegate[data-status="interrupted"] .tool-state.goon')`, 20000);
await sleep(1500);
const live = JSON.parse(
  await evalJs(
    `(c => JSON.stringify({ answers: c.messages.filter(m => m.role === "assistant").length, relays: c.messages.filter(m => m.relay).length, digest: c.messages[1].steps.find(s => s.sub)?.result, steps: c.messages[1].steps.find(s => s.sub)?.sub.steps.length }))(__yanState().conversations.find(c => c.messages[0]?.content === "HELPERBREAK"))`
  )
);
check(
  "a helper that broke off neither reports nor wakes the main model",
  live.answers === 1 && live.relays === 0 && live.steps === 1,
  JSON.stringify(live)
);
await shot("helper-goon.png");
// 面板末尾照主答断了的样子落一句、一枚续写；看过合上
await evalJs(`document.querySelector('#messages .tool-step-delegate[data-status="interrupted"] .tool-step-head').click(); true`);
await waitFor(`!!document.querySelector("#helperPanelBody .sub-foot [data-helper-resume]")`);
await sleep(400);
await shot("helper-goon-panel.png");
check("the helper panel ends with a resume note and mark", true);
await evalJs(`document.querySelector("#helperClose").click(); true`);
await sleep(300);
// 行迹折着，签藏住了：工作条上挂着它，从那一笔续上
const bar = await evalJs(`document.querySelector("#helperBar .work-held")?.textContent || ""`);
check("with the trail folded, the work bar keeps the halted helper in sight", /帮手「会断的活」中辍于第 1 步/.test(bar), bar);
await evalJs(`document.querySelector("#helperBar [data-helper-resume]").click(); true`);
await waitFor(
  `[...document.querySelectorAll("#messages .message.assistant")].some(m => /HELPERBREAK got｜done/.test(m.textContent))`,
  20000
);
check("once resumed it finishes and the report wakes the main model", true);
const gone = await waitFor(
  `document.querySelector("#helperBar").classList.contains("hidden") || !document.querySelector("#helperBar .work-held")`,
  3000
).then(
  () => true,
  () => false
);
check(
  "once resumed the work bar lets it go",
  gone,
  gone ? "" : await evalJs(`document.querySelector("#helperBar").className + " | " + document.querySelector("#helperBar").textContent`)
);
close();
