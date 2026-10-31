// 审查（设置 → 专司）：审而后行里规则标疑的那一步交另配的审查模型判——准了照做（宽沙箱会拦的指令也跑），驳了理由回给主模型、不请示；
// 没开审查照旧按规则回绝；审查连不上退回规则
import { existsSync, rmSync } from "node:fs";
import { connect, check, usageOf, sleep, PAGE, TMP } from "./lib.mjs";

const WORK = `${TMP}/review-duty`.split("/").join(process.platform === "win32" ? "\\" : "/");
rmSync(`${TMP}/review-duty`, { recursive: true, force: true });
const asks = async () => (await fetch("http://127.0.0.1:8798/review-asks")).json();
const { send, evalJs, waitFor, close } = await connect();
const duty = on => ({ on, api: "openai", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", model: "reviewer", modelList: [] });
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 6, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, sandbox: true, pendingWorkdir: ${JSON.stringify(WORK)}, commandPolicyDefault: "review", dutyReview: ${JSON.stringify(duty(true))} }, profiles: [{ id: "p1", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", quota: "", usedTokens: 0 }], conversations: [], memory: { enabled: true, items: [] }, drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(900);
await asks();

// 等本次新开的那篇对话答完：页面上残留的上一段消息会让按 DOM 等的条件提前成立，故看状态
const ask = async (text = "REVIEW-DUTY") => {
  const before = await evalJs(`__yanState().conversations.length`);
  await evalJs(
    `document.querySelector("#welcomeInput").value = "${text}"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
  );
  await waitFor(
    `__yanState().conversations.length > ${before} && (m => m?.role === "assistant" && m.status === "complete")(__yanState().conversations[0].messages.at(-1))`,
    30000
  );
  return evalJs(
    `(c => ({ steps: (c.messages.at(-1).steps || []).map(s => ({ name: s.name, status: s.status, result: s.result, reviewed: s.reviewed || null })), reply: c.messages.at(-1).content }))(__yanState().conversations[0])`
  );
};
const fresh = async () => {
  await evalJs(`document.querySelector("#newChat").click(); true`);
  await sleep(400);
};

// 一、开着审查
let state = await ask();
const win = process.platform === "win32";
if (win) {
  check(
    "宽沙箱会拦的指令：审查准了，照跑、行迹上标审准",
    state.steps[0]?.name === "run_command" &&
      state.steps[0].status === "done" &&
      state.steps[0].reviewed?.ok === true &&
      /审准/.test(state.steps[0].result || "") &&
      existsSync(`${TMP}/review-duty/duty-ok.txt`),
    JSON.stringify(state.steps[0])
  );
} else {
  // 宽沙箱规则尚无 sh 对应项（排除：HIDDEN 属硬拒非准跑、系统路径写入报权限、rm -rf 属高危删除、sudo 属于禁止提权），等 sh 沙箱规则 PR 一起补
  console.log("  [跳过] 审查专司「定义别名」一步：宽沙箱规则尚无 sh 对应项，等 sh 沙箱规则的 PR 一起补");
}
const fetchStep = state.steps[win ? 1 : 0];
check(
  "网址带长串参数的外发：审查驳了，没翻，理由回给主模型",
  fetchStep?.name === "fetch_page" &&
    fetchStep.reviewed?.ok === false &&
    fetchStep.result === "审查未准" &&
    /审查未准：用户没让把这串参数发出去/.test(state.reply),
  JSON.stringify({ step: fetchStep, reply: state.reply })
);
check("没弹请示条", await evalJs(`document.querySelector("#approvalBar").classList.contains("hidden")`));
const log = await asks();
check(
  "两步判：准的一问即了；疑的再问一回要理由",
  JSON.stringify(log) ===
    JSON.stringify(
      win
        ? [
            { quick: true, tool: "run_command" },
            { quick: true, tool: "fetch_page" },
            { quick: false, tool: "fetch_page" }
          ]
        : [
            { quick: true, tool: "fetch_page" },
            { quick: false, tool: "fetch_page" }
          ]
    ),
  JSON.stringify(log)
);

// 一之二、审查也不放行的（藏字）：不去问审查，照规则回绝
await fresh();
state = await ask("REVIEW-HARD");
check(
  "藏字的指令：不交审查，照规则回绝",
  state.steps[0]?.status === "error" &&
    !state.steps[0].reviewed &&
    /隐藏或动态拼接/.test(state.reply) &&
    !existsSync(`${TMP}/review-duty/hard.txt`),
  JSON.stringify({ step: state.steps[0], reply: state.reply.slice(0, 200) })
);
check("藏字的指令：审查员一问也没收到", (await asks()).length === 0);

// 二、关着审查：照旧按规则回绝，审查员一问也没收到
await evalJs(`__yanState().settings.dutyReview.on = false; true`);
await fresh();
if (win) {
  state = await ask();
  check(
    "没开审查：宽沙箱照旧回绝那条指令",
    state.steps[0]?.status === "error" && /沙箱拒绝/.test(JSON.stringify(state.reply)) && !state.steps[0].reviewed,
    JSON.stringify({ step: state.steps[0], reply: state.reply.slice(0, 200) })
  );
  check("没开审查：审查员一问也没收到", (await asks()).length === 0);
}

// 三、审查连不上：退回规则
await evalJs(`Object.assign(__yanState().settings.dutyReview, { on: true, baseUrl: "http://127.0.0.1:9/v1" }); true`);
await fresh();
if (win) {
  state = await ask();
  check(
    "审查连不上：退回规则，指令照旧回绝、外发照旧放行（不标审）",
    state.steps[0]?.status === "error" && /沙箱拒绝/.test(state.reply) && !state.steps[0].reviewed && !state.steps[1]?.reviewed,
    JSON.stringify({ steps: state.steps, reply: state.reply.slice(0, 200) })
  );
}
const used = await usageOf("review");
check("审查花的墨记进用量簿的「审查」", used > 0, String(used));
await close();
