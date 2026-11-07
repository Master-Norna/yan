// 「止」的两道收口：不可中止的工具（http_request、长指令）在按了「止」之后才回来时——
//  1) runSteps 里不再把步骤状态改回「完成」、不再记结果（见 00-registry.js 的 runOne）；
//  2) 这一批也不再往下装历史、把排着的补言递出（见 30-rounds.js 在 runSteps 返回后的那一道）。
// 两处都照实改前是红的：步骤被改成 done，「已止」的收束被盖掉；排着的补言被打勾递进一段
// 不再发送的历史，随后才在循环顶中止——补言就此丢在半路（settleSupplements 见队列已空，什么也没放回）。
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

test("runSteps：工具跑着时按了止，回来不再改状态、也不记结果", async () => {
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
  let release = () => {};
  const gate = new Promise(resolve => (release = resolve));
  let runs = 0;
  f.TOOLS.set("probe_slow", {
    name: "probe_slow",
    label: "慢探",
    run: async () => {
      runs += 1;
      await gate;
      return { ok: true, content: "工具已完成", display: "完成" };
    }
  });
  const controller = new AbortController();
  const step = { id: "s1", name: "probe_slow", arguments: "{}", status: "running" };
  const assistant = { id: "a1", steps: [step] };
  const conversation = { id: "c1", messages: [] };
  const pending = f.runSteps([step], conversation, assistant, controller.signal, new Map(), new Set(["probe_slow"]));
  // 闭包里的 setTimeout 是 unref 的桩：runOne 凑显示时长的那一小段等待要有人在底下撑住事件循环
  const keep = setTimeout(() => {}, 1000);
  await new Promise(resolve => setTimeout(resolve, 20));
  // 按「止」：haltJob 先中止，再把还在跑的步骤收成「已止」（见 10-send.js 的 haltJob）
  controller.abort();
  f.settleSteps(assistant, "已止");
  release();
  const { outcomes } = await pending;
  clearTimeout(keep);
  assert.equal(runs, 1, "工具照旧跑完");
  assert.equal(step.status, "error", "「已止」的收束还在，没有被改回完成");
  assert.equal(step.result, "已止");
  assert.equal(outcomes.size, 0, "结果不再交给这一轮");
});

test("streamReply：工具在止之后才回来，排着的补言放回案上，不算递出", async () => {
  const f = load([
    "streamReply",
    "requestJobs",
    "draftKey",
    "drafts: () => store.drafts",
    `setup: (conversation, request, run) => {
      document.documentElement.dataset.inkMotion = "off";
      document.hidden = true;
      saveStoreSoon = saveStore = renderSendButtons = renderHistory = setJobLabel =
        refreshSteps = markDirty = accountUsage = renderQuota = restoreDraft = tickTrailClock = () => {};
      keepInWindow = mcpForTurn = refreshSkills = maybeAutoCompact = maybeAutoTitle = async () => {};
      loadLedger = loadIntent = warmConversation = async () => {};
      reserveTokens = () => () => {};
      replyDeliverables = async () => [];
      restFor = async () => {};
      systemPrompt = () => "";
      ledgerNote = () => "";
      intentNote = () => "";
      toolDefinitions = () => [{ type: "function", function: { name: "probe" } }];
      store = { settings: {}, conversations: [conversation], drafts: {}, memory: { items: [] } };
      PROMPTS.assistant = { resume: "请从断处继续", supplement: "用户途中寄来一句话" };
      requestPatiently = request;
      runSteps = run;
    }`
  ]);
  const assistant = { id: "a", role: "assistant", content: "", status: "streaming" };
  const conversation = { id: "c", messages: [{ id: "u", role: "user", content: "查一下" }, assistant] };
  // 补言那一步：与 sendSupplement 造的同形（见 10-send.js）
  const note = { id: "n1", name: "user_note", arguments: "{}", status: "running", note: "查完再补一句", at: 0 };
  assistant.steps = [note];
  const replies = [toolReply()];
  const requests = [];
  const request = async (profile, history) => {
    requests.push(structuredClone(history));
    assert.ok(replies.length, "不应无限重试");
    return replies.shift();
  };
  // 模拟「工具跑着时按了止、工具随后照旧回来」：寄一句补言、中止，再把（不再记结果的）一批结果交回
  const run = async (steps, runConversation) => {
    const job = f.requestJobs.get(runConversation.id);
    job.queue.push({ user: { id: "u2", role: "user", content: "查完再补一句" }, step: note });
    job.controller.abort();
    return { outcomes: new Map(steps.map(step => [step.id, "工具结果"])), images: [] };
  };
  f.setup(conversation, request, run);
  const keep = setTimeout(() => {}, 2000);
  await f.streamReply(conversation, assistant, { id: "p", tools: true });
  clearTimeout(keep);
  assert.equal(assistant.status, "stopped");
  assert.equal(requests.length, 1, "止住之后不再开新轮");
  assert.ok(!(assistant.steps || []).some(step => step.id === "n1"), "补言那一步从行迹里撤下，等放回案上");
  assert.match(String((f.drafts() || {})[f.draftKey("c")]?.text || ""), /查完再补一句/, "补言回到案上，不再丢在半路");
});
