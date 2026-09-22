// 三档权限：审而后行不弹请求，常规工作放行、明确高风险拒绝
import { existsSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";

const WORK = `${TMP}/permission-inspection`.split("/").join(process.platform === "win32" ? "\\" : "/");
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, sandbox: false, pendingWorkdir: ${JSON.stringify(WORK)}, commandPolicyDefault: "review" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], memory: { enabled: true, items: [] }, drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(900);

check(
  "welcome exposes automatic review as the default third-mode policy",
  (await evalJs(`document.querySelector("#approveChip .chip-text").textContent`)) === "审而后行"
);
await evalJs(
  `document.querySelector("#welcomeInput").value = "POLICY-REVIEW"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`document.querySelector('.message.assistant')?.dataset.status === "complete"`, 30000);
const state = await evalJs(
  `(c => ({ policy: c.commandPolicy, steps: c.messages.at(-1).steps.map(s => ({ name: s.name, status: s.status, result: s.result, output: s.output })) }))(__yanState().conversations[0])`
);
check(
  "automatic review persisted on the conversation and never opened an approval request",
  state.policy === "review" && (await evalJs(`document.querySelector("#approvalBar").classList.contains("hidden")`))
);
check(
  "ordinary state-changing work was allowed automatically",
  state.steps[0]?.name === "run_command" && state.steps[0].status === "done" && existsSync(`${TMP}/permission-inspection/review-ok.txt`),
  JSON.stringify(state.steps[0])
);
check(
  "clear host risk was denied without asking",
  state.steps[1]?.name === "run_command" && state.steps[1].status === "error" && /审查拒绝/.test(state.steps[1].result || ""),
  JSON.stringify(state.steps[1])
);

const labels = [];
for (let i = 0; i < 3; i++) {
  labels.push(await evalJs(`document.querySelector("#workAuto").textContent`));
  await evalJs(`document.querySelector("#workAuto").click(); true`);
}
check("conversation policy cycles through review, auto and ask", labels.join("|") === "审而后行|径行|问而后行", labels.join("|"));
await evalJs(`document.querySelector("#openSettings")?.click() || document.querySelector('[data-open-settings]')?.click(); true`);
await sleep(250);
await evalJs(`document.querySelector('.tab-btn[data-tab="tools"]')?.click(); true`);
await sleep(150);
check(
  "settings offers all three permission modes",
  (await evalJs(`[...document.querySelectorAll('[data-setting="commandPolicyDefault"]')].map(b => b.textContent).join("|")`)) ===
    "问而后行|审而后行|径行"
);

close();
