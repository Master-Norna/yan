// 新添的几件工具：run_js 在隔离沙箱里算（超时能杀掉）、http_request 与 download_file 走桥接的地址门禁、update_plan 在行迹里画成清单
import { existsSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const workdir = `${TMP}/tools-more-work`.split("/").join(process.platform === "win32" ? "\\" : "/");
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, pendingWorkdir: ${JSON.stringify(workdir)}, workAutoDefault: true }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const lastAssistant = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`;
await evalJs(
  `document.querySelector("#welcomeInput").value = "NEWTOOLS 试试"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`${lastAssistant}?.dataset.status === "complete"`, 30000);
const steps = await evalJs(
  `(c => (c.messages.at(-1).steps || []).map(s => ({ name: s.name, status: s.status, result: s.result, title: s.title, output: s.output, plan: s.plan })))(JSON.parse(localStorage.getItem("yan-chat-v1")).conversations[0])`
);
const byName = name => steps.filter(s => s.name === name);
check(
  "run_js: logs and the returned value come back, shown as code + output in the trail",
  byName("run_js")[0]?.status === "done" &&
    /sum 6/.test(byName("run_js")[0].output) &&
    /→ \[\s*1,\s*4,\s*9\s*\]/.test(byName("run_js")[0].output),
  JSON.stringify(byName("run_js")[0])
);
check(
  "run_js: an endless loop is killed at the timeout and reported as an error",
  byName("run_js")[1]?.status === "error" && /超时/.test(byName("run_js")[1].output || ""),
  JSON.stringify(byName("run_js")[1])
);
check(
  "http_request to a service on this machine goes through: status, headers and JSON body come back",
  byName("http_request")[0]?.status === "done" &&
    /^200/.test(byName("http_request")[0].result || "") &&
    /claude-test/.test(byName("http_request")[0].output || ""),
  JSON.stringify(byName("http_request")[0])
);
check(
  "http_request to a LAN address is refused by the bridge",
  byName("http_request")[1]?.status === "error" && /内网/.test(byName("http_request")[1].result || ""),
  JSON.stringify(byName("http_request")[1])
);
check(
  "download_file saves a file from this machine into the workdir under the given path",
  byName("download_file")[0]?.status === "done" &&
    byName("download_file")[0].title === "下载/models.json" &&
    existsSync(`${TMP}/tools-more-work/下载/models.json`),
  JSON.stringify(byName("download_file")[0])
);
check(
  "download_file from a LAN address is refused by the bridge",
  byName("download_file")[1]?.status === "error" && /内网/.test(byName("download_file")[1].result || ""),
  JSON.stringify(byName("download_file")[1])
);
check(
  "update_plan keeps the list on the step and titles it with the item in progress",
  byName("update_plan")[0]?.status === "done" && byName("update_plan")[0].plan?.length === 4 && byName("update_plan")[0].title === "调接口",
  JSON.stringify(byName("update_plan")[0])
);
const ui = await evalJs(
  `(m => ({ plan: [...m.querySelectorAll(".plan-item")].map(li => li.dataset.plan).join(","), doing: m.querySelector('.plan-item[data-plan="doing"] .plan-text')?.textContent, code: !!m.querySelector(".tool-code"), labels: [...m.querySelectorAll(".tool-label")].map(n => n.textContent.trim()).join(","), frames: document.querySelectorAll(".compute-frame").length }))(${lastAssistant})`
);
check(
  "trail: plan card lists the four states, run_js shows its code, labels are 计算 / 调接口 / 下载 / 计划; compute iframes are cleaned up",
  ui.plan === "done,doing,pending,skipped" &&
    ui.doing === "调接口" &&
    ui.code &&
    /计算.*调接口.*下载.*计划/.test(ui.labels) &&
    ui.frames === 0,
  JSON.stringify(ui)
);
const reply = await evalJs(`${lastAssistant}.textContent`);
check(
  "the model gets the value, the timeout, both refusals and the plan count back",
  /NEWTOOLS\|/.test(reply) &&
    /返回值：\[/.test(reply) &&
    /超时/.test(reply) &&
    /HTTP 200/.test(reply) &&
    /内网/.test(reply) &&
    /已存为 下载\/models\.json/.test(reply) &&
    /计划已更新：1\/4/.test(reply),
  reply
);
close();
