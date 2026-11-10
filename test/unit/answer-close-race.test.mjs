// 作答收尾与「止」的三处竞态（issue #72 的 2、4、6）：
//  2) 正文写完、成品还在解析时删掉这段对话：收尾仍会在已删对话上起新答、拟题、压缩；
//  4) 补言 / 回报递送途中按「止」：队列先清空、步骤后打勾，话回不到案上；
//  6) 「止」落进工具完成后的显示延时里：已止的步骤被改回「完成」。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const sse = wire => new Response(wire, { headers: { "content-type": "text/event-stream" } });
const event = (delta = {}, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;
const toolReply = () =>
  sse(
    event(
      { content: "我先查一下。", tool_calls: [{ index: 0, id: "call_probe", function: { name: "probe", arguments: "{}" } }] },
      "tool_calls"
    ) + "data: [DONE]\n\n"
  );
const finalReply = () => sse(event({ content: "检查完成。" }, "stop") + "data: [DONE]\n\n");

test("streamReply：收尾途中对话被删，不再在它上面起新答、拟题、压缩", async () => {
  const counts = { starts: 0, titles: 0, compacts: 0 };
  const f = load([
    "streamReply",
    "requestJobs",
    `setup: (conversation, request, run, counts) => {
      document.documentElement.dataset.inkMotion = "off";
      document.hidden = true;
      saveStoreSoon = saveStore = renderSendButtons = renderHistory = setJobLabel =
        refreshSteps = markDirty = accountUsage = renderQuota = restoreDraft = tickTrailClock = () => {};
      keepInWindow = mcpForTurn = refreshSkills = loadLedger = loadIntent = warmConversation = async () => {};
      reserveTokens = () => () => {};
      replyDeliverables = async () => [];
      restFor = async () => {};
      systemPrompt = () => "";
      ledgerNote = () => "";
      intentNote = () => "";
      toolDefinitions = () => [{ type: "function", function: { name: "probe" } }];
      tuneMemory = () => {};
      notifyAnswerEnd = finalizeAssistant = renderChatMeta = renderOutline = updateContextGauge = () => {};
      startTurn = async () => { counts.starts += 1; };
      maybeAutoTitle = async () => { counts.titles += 1; };
      maybeAutoCompact = () => { counts.compacts += 1; };
      store = { settings: {}, conversations: [conversation], drafts: {}, memory: { items: [] } };
      PROMPTS.assistant = { resume: "请从断处继续", supplement: "用户途中寄来一句话" };
      requestPatiently = request;
      // 工具跑完、下一轮开口之前，这段对话被删掉了；收尾时队列里还排着一句补言
      runSteps = async (steps, conv) => {
        const job = requestJobs.get(conv.id);
        job.queue.push({ user: { id: "u2", role: "user", content: "补一句" }, step: conv.messages.at(-1).steps.find(step => step.id === "n1") });
        store.conversations = store.conversations.filter(item => item.id !== conv.id);
        return run(steps, conv);
      };
    }`
  ]);
  const assistant = { id: "a", role: "assistant", content: "", status: "streaming" };
  const conversation = { id: "c", messages: [{ id: "u", role: "user", content: "查一下" }, assistant] };
  // 作答途中到的补言：与 sendSupplement 造的同形（见 10-send.js）
  assistant.steps = [{ id: "n1", name: "user_note", arguments: "{}", status: "running", note: "补一句", at: 0 }];
  const replies = [toolReply(), finalReply()];
  const requests = [];
  const request = async (profile, history) => {
    requests.push(structuredClone(history));
    assert.ok(replies.length, "不应无限重试");
    return replies.shift();
  };
  f.setup(conversation, request, async steps => ({ outcomes: new Map(steps.map(step => [step.id, "工具结果"])), images: [] }), counts);
  const keep = setTimeout(() => {}, 3000);
  await f.streamReply(conversation, assistant, { id: "p", tools: true });
  clearTimeout(keep);
  assert.equal(assistant.status, "complete");
  assert.equal(requests.length, 2);
  assert.deepEqual(counts, { starts: 0, titles: 0, compacts: 0 }, "已删的对话上不该再起新答、拟题、压缩");
});

test("deliverSupplements：replay 途中按了止，这一条不算递上，还回收件口", async () => {
  const f = load([
    "deliverSupplements",
    "TOOLS",
    `setup: () => {
      saveStoreSoon = () => {};
      refreshSteps = () => {};
    }`
  ]);
  f.setup();
  let release = () => {};
  const gate = new Promise(resolve => (release = resolve));
  let replays = 0;
  f.TOOLS.set("user_note", {
    replay: async () => {
      replays += 1;
      await gate;
      return { role: "user", content: "补言" };
    }
  });
  const step = { id: "n1", name: "user_note", arguments: "{}", status: "running" };
  const job = { queue: [{ user: { id: "u2", role: "user", content: "补言" }, step }], controller: new AbortController() };
  const history = [];
  const pending = f.deliverSupplements(job, history, undefined, { content: "" });
  await new Promise(resolve => setTimeout(resolve, 20));
  // 按「止」：haltJob 中止这一答；递送随后才回来
  job.controller.abort();
  release();
  await pending;
  assert.equal(replays, 1, "replay 照常走完");
  assert.equal(step.status, "running", "没递上的那一步不能打勾");
  assert.equal(job.queue.length, 1, "补言还回收件口，收尾时放回案上");
  assert.equal(history.length, 0, "没递上就不进这一轮的历史");
});

test("deliverSupplements：止之后进来的补言不再递，留在收件口", async () => {
  const f = load([
    "deliverSupplements",
    "TOOLS",
    `setup: () => {
      saveStoreSoon = () => {};
      refreshSteps = () => {};
    }`
  ]);
  f.setup();
  f.TOOLS.set("user_note", { replay: async () => ({ role: "user", content: "补言" }) });
  const step = { id: "n1", name: "user_note", arguments: "{}", status: "running" };
  const job = { queue: [{ user: { id: "u2", role: "user", content: "补言" }, step }], controller: new AbortController() };
  job.controller.abort();
  const history = [];
  await f.deliverSupplements(job, history, undefined, { content: "" });
  assert.equal(step.status, "running");
  assert.equal(job.queue.length, 1);
  assert.equal(history.length, 0);
});

test("runSteps：工具已返回、凑显示时长的等待里按了止，步骤不改回完成", async () => {
  const f = load([
    "runSteps",
    "TOOLS",
    "settleSteps",
    `setup: () => {
      saveStore = refreshSteps = () => {};
      warmConversation = async () => {};
    }`
  ]);
  f.setup();
  f.TOOLS.set("probe_fast", { name: "probe_fast", label: "快探", run: async () => ({ ok: true, content: "工具已完成", display: "完成" }) });
  const controller = new AbortController();
  const step = { id: "s1", name: "probe_fast", arguments: "{}", status: "running" };
  const assistant = { id: "a1", steps: [step] };
  const pending = f.runSteps([step], { id: "c1", messages: [] }, assistant, controller.signal, new Map(), new Set(["probe_fast"]));
  // 闭包里的 setTimeout 是 unref 的桩：凑显示时长的那一段要有人在底下撑住事件循环
  const keep = setTimeout(() => {}, 1000);
  await new Promise(resolve => setTimeout(resolve, 20));
  // 工具已经回来了，正在凑 240ms 的显示时长：这时按「止」，haltJob 把步骤收成「已止」
  controller.abort();
  f.settleSteps(assistant, "已止");
  const { outcomes } = await pending;
  clearTimeout(keep);
  assert.equal(step.status, "error", "等待之后不能再写回完成");
  assert.equal(step.result, "已止");
  assert.equal(outcomes.size, 0, "结果不再交给这一轮");
});
