import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./harness.mjs";

const profile = { id: "p", name: "测试模型", tools: true };
const reply = (delta, finish_reason = "stop") =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" }
  });
const question = (id, content) => ({ id, role: "user", content });
const answer = (id, content, steps = [], extra = {}) => ({ id, role: "assistant", status: "complete", content, steps, ...extra });
const timer = (id, number) => ({ id, name: "set_timer", status: "done", timer: { id: number, state: "waiting" } });
const due = (to, step, note) => ({ to, timer: { id: step.timer.id, step: step.id, note, due: Date.now(), late: 0 } });
const gate = () => Promise.withResolvers();
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = entry => (typeof entry.content === "string" ? entry.content : entry.content.map(part => part.text).join("\n"));
const workPrompt = readFileSync(new URL("../../prompts/work.js", import.meta.url), "utf8");
const assistantPrompt = readFileSync(new URL("../../prompts/assistant.js", import.meta.url), "utf8");

function fixture(conversation, props = {}) {
  const scheduled = [],
    requests = [];
  const f = load([
    "PROMPTS",
    "TOOLS",
    "requestJobs",
    "deliverTimer",
    "watchBackground",
    "mailReport",
    "stopGeneration",
    "resumeAnswer",
    "streamReply",
    `switchWithoutLayout: (conversation, index, step) => {
      const querySelector = document.querySelector;
      document.querySelector = () => null;
      try { switchBranch(conversation, index, step); }
      finally { document.querySelector = querySelector; }
    }`,
    `setup: ({ conversation, p, request, scheduled, run, claim, bridgeCall, onEnd }) => {
      document.documentElement.dataset.inkMotion = "off";
      document.hidden = true;
      saveStoreSoon = saveStore = markDirty = renderSendButtons = renderHistory = renderConversation =
        renderClepsydra = refreshSteps = tickTrailClock = toast = renderQuota = spendTokens = accountUsage = () => {};
      notifyAnswerEnd = onEnd;
      sidePanelOpen = () => false;
      mcpForTurn = refreshSkills = loadLedger = loadIntent = maybeAutoTitle = async () => {};
      maybeAutoCompact = () => {};
      ledgerNote = intentNote = systemPrompt = () => "";
      toolDefinitions = () => [{ type: "function", function: { name: "probe" } }];
      reserveTokens = () => () => {};
      replyDeliverables = async () => [];
      ensureWorkReady = async () => true;
      claimConversation = claim;
      syncLeases = async () => {};
      bridge = bridgeCall;
      store = { settings: { groups: [], presets: [] }, profiles: [p], conversations: [conversation], drafts: {}, memory: { items: [] } };
      requestPatiently = request;
      if (run) runSteps = run;
      const defer = setTimeout;
      setTimeout = (fn, ms, ...args) => ms === 0 ? scheduled.push(() => fn(...args)) : defer(fn, ms, ...args);
    }`
  ]);
  const window = { YAN_PROMPTS: {} };
  for (const source of [assistantPrompt, workPrompt]) new Function("window", source)(window);
  Object.assign(f.PROMPTS, window.YAN_PROMPTS);
  const p = { ...profile, ...props.profile };
  f.setup({
    conversation,
    p,
    scheduled,
    run: props.run,
    claim: props.claim ?? (async () => true),
    bridgeCall:
      props.bridge ??
      (async () => {
        throw Error("不该访问桥接");
      }),
    onEnd: props.onEnd ?? (() => {}),
    request: async (_profile, history, signal, overrides) => {
      requests.push(structuredClone(history));
      return props.request ? props.request(history, signal, overrides) : reply({ content: "检查完成。" });
    }
  });
  return { ...f, p, requests, scheduled };
}

test("工具还在跑时按止：已入队的定时和后台另起一答，已入队的帮手不另发", { timeout: 3000 }, async () => {
  const clock = timer("timer-step", "t1");
  const bg = { id: "bg-step", title: "生成文件", status: "done", bg: { id: "bg1", key: "k", state: "running" } };
  const helper = { id: "helper-step", title: "核对文件", status: "done" };
  const previous = answer("previous", "已经挂候。", [clock, bg, helper]);
  const assistant = answer("a", "", [], { status: "streaming" });
  const c = { id: "c", messages: [question("q1", "挂候"), previous, question("q2", "先处理别的"), assistant] };
  const arrivedAtTool = gate(),
    finishTool = gate(),
    finishBg = gate(),
    endWake = gate();
  let calls = 0;
  const backgroundRequests = [];
  const f = fixture(c, {
    bridge: (path, args, signal) => {
      backgroundRequests.push(path);
      assert.equal(path, "/api/work/watch");
      assert.deepEqual(args, { id: "bg1", key: "k" });
      assert.ok(!signal.aborted);
      return finishBg.promise;
    },
    run: async () => {
      arrivedAtTool.resolve();
      await finishTool.promise;
      return { outcomes: new Map(), images: [] };
    },
    request: () =>
      ++calls === 1
        ? reply(
            { content: "先跑工具。", tool_calls: [{ index: 0, id: "call_probe", function: { name: "probe", arguments: "{}" } }] },
            "tool_calls"
          )
        : reply({ content: "候的结果收到了。" }),
    onEnd: (_c, ended) => {
      if (ended !== assistant) endWake.resolve(ended);
    }
  });
  const working = f.streamReply(c, assistant, f.p);
  await Promise.race([arrivedAtTool.promise, working.then(() => assert.fail("旧答没有进入工具轮"))]);
  f.deliverTimer(due(c.id, clock, "到点收文件"));
  f.watchBackground(c, previous, bg);
  finishBg.resolve({ id: "bg1", exitCode: 0, stdout: "后台输出唯一串", stderr: "", durationMs: 10 });
  await tick();
  f.mailReport(c, { report: "帮手回报唯一串", step: helper, profile: f.p });
  assert.deepEqual(
    f.requestJobs.get(c.id).queue.map(item => item.step.id),
    [clock.id, bg.id, helper.id]
  );

  f.stopGeneration(c.id);
  finishTool.resolve();
  await working;
  assert.equal(assistant.status, "stopped");
  assert.equal(clock.timer.state, "done");
  assert.equal(bg.bg.state, "done");
  assert.match(bg.output, /后台输出唯一串/);
  assert.deepEqual(backgroundRequests, ["/api/work/watch"], "止不去撤候");
  assert.equal(f.requests.length, 1, "旧答没有再向模型开一轮");
  assert.ok(!assistant.steps.some(step => step.name === "relay_note"), "未递进旧答的回报步骤被撤下");
  assert.equal(f.scheduled.length, 1, "两个候共用一封醒信");
  f.scheduled.shift()();
  assert.equal((await endWake.promise).status, "complete");
  assert.equal(f.requests.length, 2);
  const user = c.messages.at(-2);
  assert.deepEqual(
    user.relay.map(relay => relay.kind),
    ["timer", "bg"]
  );
  assert.match(user.content, /到点收文件[\s\S]*后台输出唯一串/);
  assert.doesNotMatch(user.content, /帮手回报唯一串/);
  assert.equal(text(f.requests[1].at(-1)), user.content);
});

for (const compact of [false, true])
  test(`续写首轮${compact ? "先撮前文" : "不用撮前文"}：暂存回报恰好发一次，排在续写标记之后`, async () => {
    const source = timer("timer-step", "t1");
    source.timer.state = "done";
    const report = "暂存的到点回报唯一串";
    const old = "早先的讨论：" + "旧文 ".repeat(1000);
    const assistant = answer("a", "先前写过半句。", [], { status: "interrupted" });
    const c = {
      id: "c",
      messages: [question("q1", old), answer("previous", "已经挂候。", [source]), question("q2", "继续安排"), assistant],
      heldReports: [{ report, relay: { step: source.id, title: "取文件", kind: "timer", ok: true } }]
    };
    const f = fixture(c, {
      profile: { contextWindow: compact ? 2048 : 0 },
      request: (_history, _signal, overrides) => reply({ content: typeof overrides.head === "number" ? "接着写完。" : "这里是前文摘要。" })
    });
    await f.resumeAnswer(c, assistant, f.p);
    assert.equal(assistant.status, "complete");
    assert.equal(f.requests.length, compact ? 2 : 1);
    assert.equal(
      c.messages.some(message => message.role === "context"),
      compact
    );
    if (compact) {
      const synopsis = f.requests[0].map(text).join("\n");
      assert.match(synopsis, /早先的讨论/);
      assert.doesNotMatch(synopsis, new RegExp(report));
    }
    const history = f.requests.at(-1).map(text);
    assert.equal(history.filter(content => content.includes(report)).length, 1, "回报不被替换前文时吞掉，也不重复");
    assert.equal(history.at(-1), report);
    assert.ok(history.at(-2).endsWith(f.PROMPTS.assistant.resume));
    assert.ok(history.includes("先前写过半句。"));
    assert.equal(c.heldReports, undefined);
    assert.deepEqual(
      assistant.steps.filter(step => step.name === "relay_note").map(step => [step.report, step.status]),
      [[report, "done"]]
    );
  });

test("续写尚在取暂存候时按止：还回暂存处，不再寄一份叫醒", { timeout: 3000 }, async () => {
  const source = timer("timer-step", "t1");
  source.timer.state = "done";
  const item = { report: "先前暂存的回报", relay: { step: source.id, title: "取文件", kind: "timer", ok: true } };
  const assistant = answer("a", "先前写过半句。", [], { status: "interrupted" });
  const c = {
    id: "c",
    messages: [question("q1", "安排"), answer("previous", "已经挂候。", [source]), question("q2", "继续"), assistant],
    heldReports: [item]
  };
  const replaying = gate(),
    release = gate();
  const f = fixture(c);
  const def = f.TOOLS.get("relay_note");
  f.TOOLS.set("relay_note", {
    ...def,
    replay: async (...args) => {
      replaying.resolve();
      await release.promise;
      return def.replay(...args);
    }
  });
  const pending = f.resumeAnswer(c, assistant, f.p);
  await Promise.race([replaying.promise, pending.then(() => assert.fail("续写没有取出暂存回报"))]);
  f.stopGeneration(c.id);
  release.resolve();
  await pending;
  assert.equal(assistant.status, "stopped");
  assert.deepEqual(c.heldReports, [item]);
  assert.equal(f.requests.length, 0);
  assert.equal(f.scheduled.length, 0, "回到暂存处以后不再多寄一份");
  assert.ok(!assistant.steps?.some(step => step.name === "relay_note"));
});

test("回报候认领时切版：只投递仍在当前路径上的回报", { timeout: 3000 }, async () => {
  const shared = timer("shared-step", "t1"),
    old = timer("old-step", "t2");
  const oldAnswer = answer("old", "旧版本。", [old], { timestamp: "2026-01-01" });
  const newAnswer = answer("new", "新版。", [], { timestamp: "2026-01-02" });
  const c = {
    id: "c",
    messages: [question("q1", "挂一个公用候"), answer("shared", "已经挂候。", [shared]), question("q2", "做事"), oldAnswer],
    forks: [{ id: "new-fork", parentId: "q2", messages: [newAnswer] }]
  };
  const claiming = gate(),
    claim = gate(),
    endWake = gate();
  const f = fixture(c, {
    claim: () => {
      claiming.resolve();
      return claim.promise;
    },
    onEnd: (_c, ended) => endWake.resolve(ended)
  });
  f.deliverTimer(due(c.id, old, "旧版独有结果"));
  f.deliverTimer(due(c.id, shared, "共用结果"));
  assert.equal(f.scheduled.length, 1);
  f.scheduled.shift()();
  await claiming.promise;
  assert.equal(f.requests.length, 0);
  f.switchWithoutLayout(c, 3, 1);
  assert.equal(c.messages.at(-1), newAnswer);
  claim.resolve(true);
  assert.equal((await endWake.promise).status, "complete");
  assert.equal(f.requests.length, 1);
  const user = c.messages.at(-2);
  assert.deepEqual(
    user.relay.map(relay => relay.step),
    [shared.id]
  );
  assert.match(text(f.requests[0].at(-1)), /共用结果/);
  assert.doesNotMatch(user.content, /旧版独有结果/);
});
