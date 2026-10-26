// 意里的守（言的钩子）：立一项目标「上线」（以「部署」为前提）、一条守「测过」（凭据 test:node check.js，标成立时记下「过」）。守不上图、不计进度，
// 卡片里在簿录之后另起一节。此后哪一答动过手、测试转为不过，收尾前对照就拦一次——那一步右侧朱字写「测过 · 测试不过」，模型接着改，
// 收尾后再取一回，书眉不挂着「守」；动了手而测试照旧过的，照常收尾，不多费一轮。
// 写了 on 的守走钩子：对得上的指令动手前先跑它的测试（将要做的经 YAN_TARGET 交给它），不过即不做，对不上的照常跑
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { connect, check, sleep, PAGE, TMP } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const dir = `${TMP}/intent-hook`,
  workdir = dir.split("/").join(process.platform === "win32" ? "\\" : "/");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/a.txt`, "ok");
writeFileSync(`${dir}/check.js`, `process.exit(require("fs").readFileSync("a.txt", "utf8").trim() === "ok" ? 0 : 1);\n`);
writeFileSync(`${dir}/guard.js`, `process.exit(/prod/.test(process.env.YAN_TARGET || "") ? 1 : 0);\n`);
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "work", activeProfileId: "p1", pendingWorkdir: ${JSON.stringify(workdir)}, autoTitle: false, commandPolicyDefault: "auto" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const answers = `(__yanState().conversations[0]?.messages || []).filter(m => m.role === "assistant" && m.status === "complete")`;
const ask = async (text, n) => {
  const input = n ? "#chatInput" : "#welcomeInput",
    button = n ? "#chatSend" : "#welcome .send-trigger";
  await evalJs(
    `document.querySelector("${input}").value = ${JSON.stringify(text)}; document.querySelector("${input}").dispatchEvent(new Event("input")); document.querySelector("${button}").click(); true`
  );
  await waitFor(`${answers}.length === ${n + 1}`, 60000);
  return evalJs(`JSON.stringify((m => ({ content: m.content, steps: (m.steps || []).map(s => s.name) }))(${answers}[${n}]))`).then(
    JSON.parse
  );
};
try {
  const one = await ask("HOOK1 立一条：改完测试要过", 0),
    saved = JSON.parse(readFileSync(`${dir}/.yan/意.json`, "utf8"));
  check(
    "a keep with a test: anchor seals as 过 and records the ask",
    saved.nodes["测过"]?.keep === true &&
      saved.nodes["测过"]?.seal?.prints?.["test:node check.js"] === "过" &&
      /HOOK1/.test(saved.nodes["测过"]?.root?.ask || ""),
    JSON.stringify(saved.nodes["测过"]) + " " + one.content
  );
  await waitFor(`!!document.querySelector("#chatMeta .intent-glance")`);
  check(
    "the glance counts goals only, with no 守 while it holds",
    await evalJs(
      `(g => g.textContent.includes("0/2") || g.textContent.includes("0 / 2"))(document.querySelector("#chatMeta .intent-glance")) && !document.querySelector(".intent-glance-keep")`
    )
  );

  const two = await ask("HOOK2 改一下 a.txt", 1);
  const gate = await evalJs(`JSON.stringify(${answers}[1].steps.find(s => s.name === "intent_gate"))`).then(JSON.parse);
  check(
    "the stopped step says which keep broke and why, in 朱",
    gate?.result === "测过 · 测试不过" && gate?.keep === true,
    JSON.stringify(gate)
  );
  await waitFor(`!document.querySelector(".intent-glance-keep")`, 15000).catch(() => {});
  check(
    "after the fix the keep is rechecked, so the glance does not hang on 守",
    await evalJs(`!document.querySelector(".intent-glance-keep")`)
  );
  check(
    "breaking the test stops the answer before it ends, and the gate names 测过 as bounced",
    /HOOK2 fixed\|bounced/.test(two.content),
    two.content
  );
  check(
    "the gate is one step in the trail, and the model went on to fix it",
    two.steps.filter(s => s === "intent_gate").length === 1 && two.steps.filter(s => s === "write_file").length === 2,
    two.steps.join(",")
  );
  check("the file is fixed", readFileSync(`${dir}/a.txt`, "utf8") === "ok");

  const three = await ask("HOOK3 加个 b.txt", 2);
  check(
    "acting without breaking the test ends normally, no extra round",
    /HOOK3 done\|gated:no/.test(three.content) && !three.steps.includes("intent_gate"),
    JSON.stringify(three)
  );
  // 守的钩子：写了 on 的守，对得上的那一步动手前先跑它的测试（将要做的经 YAN_TARGET 交给它），不过即不做
  const four = await ask("HOOK4 远端只推测试机", 3);
  check(
    "a keep with on blocks the matching command before it runs, and lets the other one through",
    /HOOK4\|prod:blocked\|staging:ran/.test(four.content) && four.steps.filter(s => s === "run_command").length === 2,
    JSON.stringify(four)
  );
  check(
    "the blocked step says which keep stopped it",
    await evalJs(`${answers}[3].steps.find(s => s.name === "run_command").result === "守拦下 · 远端"`)
  );
  // 卡片：守不上图，簿录之后另起「守」一节
  await evalJs(`document.querySelector("#chatMeta .intent-glance").click(); true`);
  await waitFor(`!!document.querySelector(".intent-card .intent-keep-head")`, 20000);
  check(
    "each 守 row marks where it is checked, the heading only counts",
    await evalJs(
      `document.querySelector(".intent-keep-head small").textContent === "2 条" && document.querySelector('.intent-roll [data-intent-node="远端"] .intent-mk')?.dataset.mark === "hook" && document.querySelector('.intent-roll [data-intent-node="测过"] .intent-mk')?.dataset.mark === "check"`
    ),
    await evalJs(
      `[...document.querySelectorAll(".intent-keep-head small, .intent-roll .intent-mk")].map(e => e.textContent || e.dataset.mark).join(" | ")`
    )
  );
  check(
    "the card leaves 守 off the graph and lists it in its own section after the roll",
    await evalJs(
      `!document.querySelector('.intent-svg [data-intent-node="测过"]') && !!document.querySelector('.intent-svg [data-intent-node="上线"]') && document.querySelector(".intent-keep-head + .intent-roll [data-intent-node]")?.dataset.intentNode === "测过" && /进度\\s*0\\s*\\/\\s*2/.test(document.querySelector(".intent-card .page-facts").textContent)`
    )
  );
  // 没挂测试的钩子即禁令：对上就不做
  const five = await ask("HOOK5 不推 main", 4);
  check("a keep with on but no test blocks the matching step outright", /HOOK5\|main:blocked/.test(five.content), JSON.stringify(five));
  // 标了 ask 的是关口：对上即请用户批——这段对话是径行，照样问；请示条写守的原话，只有准许与跳过
  const input = "#chatInput";
  await evalJs(
    `document.querySelector("${input}").value = "HOOK6 发布前给我审"; document.querySelector("${input}").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
  );
  await waitFor(
    `!document.querySelector("#approvalBar").classList.contains("hidden") && document.querySelector("#approvalBar").textContent.includes("守请示")`,
    30000
  );
  check(
    "a keep marked ask stops for the user even in 径行, showing its claim and no 径行 button",
    await evalJs(
      `(b => b.textContent.includes("发布前给我审") && b.textContent.includes("publish-one") && !b.querySelector('[data-approve="auto"]'))(document.querySelector("#approvalBar"))`
    )
  );
  await evalJs(`document.querySelector('#approvalBar [data-approve="run"]').click(); true`);
  await waitFor(`document.querySelector("#approvalBar").textContent.includes("publish-two")`, 30000);
  await evalJs(`document.querySelector('#approvalBar [data-approve="skip"]').click(); true`);
  await waitFor(`${answers}.length === 6`, 60000);
  const six = await evalJs(`${answers}[5].content`);
  check("allowed runs once without asking again, skipped is not run", /HOOK6\|one:ran\|two:declined/.test(six), six);
} finally {
  close();
}
