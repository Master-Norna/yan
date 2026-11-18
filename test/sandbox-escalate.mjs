// 问而后行里的沙箱：严的沙箱会拦下的指令不直接拒，转成请示并写明原因；用户批了这一条就出沙箱跑
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const probe = path.join(WORK, "..", "escalate-probe.txt");
rmSync(probe, { force: true });
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(WORK)}, autoTitle: false, commandPolicyDefault: "ask" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(
  `document.querySelector("#welcomeInput").value = "ESCALATE 写到上一级"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`!!document.querySelector("#approvalBar:not(.hidden) .approval-sandbox")`, 15000);
const why = await evalJs(`document.querySelector("#approvalBar .approval-sandbox").textContent`);
check("the approval bar says the sandbox would stop it and why", /沙箱会拦下：.*\.\. 上溯/.test(why) && /沙箱外/.test(why), why);
await shot("sandbox-escalate.png");
await evalJs(`document.querySelector('#approvalBar [data-approve="run"]').click(); true`);
await waitFor(`[...document.querySelectorAll(".message.assistant")].at(-1)?.dataset.status === "complete"`, 20000);
const done = await evalJs(
  `(a => ({ text: a.querySelector(".markdown")?.textContent.trim(), meta: a.querySelector('.tool-step[data-tool="run_command"] .tool-meta, .tool-step .tool-meta')?.textContent }))([...document.querySelectorAll(".message.assistant")].at(-1))`
);
check(
  "approved, it runs outside the sandbox and the step says so",
  existsSync(probe) && readFileSync(probe, "utf8").trim() === "ok" && /wrote/.test(done.text) && /出沙箱/.test(done.meta || ""),
  JSON.stringify(done)
);
rmSync(probe, { force: true });

if (process.platform === "darwin") {
  // 不碰 runner 的 Homebrew，也不联网。用一个安装时写到工作目录与缓存外的替身，验证真实 Seatbelt 下的请示和放行。
  const outside = mkdtempSync(path.join(os.homedir(), "yan-brew-approval-")),
    installed = path.join(outside, "installed"),
    fixture = path.join(WORK, "yan-test-brew");
  try {
    mkdirSync(fixture);
    writeFileSync(path.join(fixture, "target"), installed);
    writeFileSync(
      path.join(fixture, "brew"),
      '#!/bin/sh\n[ "$1 $2" = "install hello" ] || exit 2\ntarget=$(cat "${0%/*}/target") && printf ok > "$target"\n',
      {
        mode: 0o755
      }
    );
    const request = async label => {
      await evalJs(
        `document.querySelector("#chatInput").value = ${JSON.stringify(label)}; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
      );
      await waitFor(`!!document.querySelector("#approvalBar:not(.hidden) .approval-sandbox")`);
      return evalJs(`document.querySelector("#approvalBar .approval-sandbox").textContent`);
    };
    const choose = async (decision, n) => {
      await evalJs(`document.querySelector('#approvalBar [data-approve="${decision}"]').click(); true`);
      await waitFor(
        `document.querySelectorAll('.message.assistant').length === ${n} && [...document.querySelectorAll('.message.assistant')].at(-1).dataset.status === "complete"`
      );
    };
    const brewWhy = await request("ESCALATE-BREW 第一次");
    check("Homebrew asks explicitly to run outside the sandbox", /Homebrew.*安装目录和日志.*沙箱外执行这一条/.test(brewWhy), brewWhy);
    await choose("skip", 2);
    check("skipping the Homebrew approval does not run the installer", !existsSync(installed));
    await request("ESCALATE-BREW 再试一次");
    await choose("run", 3);
    const meta = await evalJs(
      `[...document.querySelectorAll('.message.assistant')].at(-1).querySelector('.tool-step .tool-meta')?.textContent`
    );
    check(
      "approving Homebrew lets the installer write outside the sandbox",
      existsSync(installed) && readFileSync(installed, "utf8") === "ok" && /出沙箱/.test(meta || "")
    );
    check(
      "approving Homebrew leaves the conversation on Ask first",
      (await evalJs(`document.querySelector("#workAuto").textContent`)) === "问而后行"
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}
close();
