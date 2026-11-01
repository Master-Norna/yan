import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const event = (delta = {}, finish_reason = null, extra = {}) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason }], ...extra })}\n\n`;
const sse = wire => new Response(wire, { headers: { "content-type": "text/event-stream" } });
const json = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

function setup(replies = []) {
  const f = load([
    "readSse",
    "streamReply",
    `setup: (request, run) => {
      document.documentElement.dataset.inkMotion = 'off';
      document.hidden = true;
      saveStoreSoon = saveStore = renderSendButtons = renderHistory =
        setJobLabel = refreshSteps = markDirty = accountUsage = renderQuota = () => {};
      keepInWindow = mcpForTurn = maybeAutoCompact = maybeAutoTitle = async () => {};
      reserveTokens = () => () => {};
      replyDeliverables = async () => [];
      restFor = async () => {};
      systemPrompt = () => '';
      toolDefinitions = () => [{ type: 'function', function: { name: 'probe' } }];
      requestPatiently = request;
      runSteps = run;
      PROMPTS.assistant = { resume: '请从断处继续' };
    }`
  ]);
  const requests = [],
    runs = [];
  f.setup(
    async (profile, history) => {
      requests.push(structuredClone(history));
      assert.ok(replies.length, "不应无限重试");
      return replies.shift();
    },
    async steps => {
      runs.push(...steps);
      for (const step of steps) step.status = "done";
      return { outcomes: new Map(steps.map(step => [step.id, "工具已完成"])), images: [] };
    }
  );
  return { ...f, requests, runs };
}

test("SSE：没有结束标志的 EOF 不能冒充完成，已收到的文字保留", async () => {
  const f = setup();
  for (const wire of ["", event({ content: "半句话" })]) {
    const target = { content: "已有进度。", toolCalls: null };
    await assert.rejects(f.readSse(sse(wire), target), /未发送结束标志/);
    assert.equal(target.content, "已有进度。" + (wire ? "半句话" : ""));
  }
});

test("SSE：兼容 DONE 或 finish_reason，末帧没有换行仍保留正文及用量", async () => {
  const f = setup();
  for (const terminal of ["data: [DONE]", event({}, "stop", { usage: { total_tokens: 77 } }).trimEnd()]) {
    const target = { content: "" };
    await f.readSse(sse(event({ content: "完整答复" }) + terminal), target);
    assert.equal(target.content, "完整答复");
    if (!terminal.includes("[DONE]")) assert.equal(target.usage.total_tokens, 77);
  }
});

test("SSE：长度截断即使带 DONE 也报错，显式错误仍保留", async () => {
  const f = setup();
  const target = { content: "" };
  await assert.rejects(f.readSse(sse(event({ content: "半截" }, "length") + "data: [DONE]\n\n"), target), /长度上限/);
  assert.equal(target.content, "半截");
  await assert.rejects(f.readSse(sse('data: {"error":{"message":"上游故障"}}\n\n'), { content: "" }), /上游故障/);
});

const toolReply = () =>
  sse(
    event(
      {
        content: "我先查一下。",
        tool_calls: [{ index: 0, id: "call_probe", function: { name: "probe", arguments: "{}" } }]
      },
      "tool_calls"
    ) + "data: [DONE]\n\n"
  );
const emptyReply = () => sse(event({}, "stop") + "data: [DONE]\n\n");
const finalReply = () => sse(event({ content: "检查完成。" }, "stop") + "data: [DONE]\n\n");
async function turn(f) {
  const assistant = { id: "a", role: "assistant", content: "", status: "streaming" };
  const conversation = { id: "c", messages: [{ id: "u", role: "user", content: "检查一下" }, assistant] };
  await f.streamReply(conversation, assistant, { id: "p", tools: true });
  return assistant;
}

test("工具后空回复会重试，后续正文正常收尾且已完成工具只执行一次", async () => {
  const f = setup([toolReply(), emptyReply(), finalReply()]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.match(assistant.content, /检查完成/);
  assert.equal(f.requests.length, 3);
  assert.equal(f.runs.length, 1);
  assert.deepEqual(f.requests[1], f.requests[2]);
});

test("工具后连续空回复只重试两次，保留进度并标记中断", async () => {
  const f = setup([toolReply(), emptyReply(), emptyReply(), emptyReply()]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "interrupted");
  assert.match(assistant.error, /本轮未返回/);
  assert.match(assistant.content, /我先查一下/);
  assert.equal(f.requests.length, 4);
  assert.equal(f.runs.length, 1);
});

test("缺结束标志的半截工具调用不能执行，重试完成后才执行", async () => {
  const cut = sse(event({ tool_calls: [{ index: 0, id: "cut", function: { name: "probe", arguments: '{"x":' } }] }));
  const f = setup([cut, toolReply(), finalReply()]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.deepEqual(
    f.runs.map(step => step.id),
    ["call_probe"]
  );
});

test("非流式长度截断同样自动续写，旧正文不会掩盖非流式空回复", async () => {
  const f = setup([
    json({ choices: [{ message: { content: "半句" }, finish_reason: "length" }] }),
    json({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
    finalReply()
  ]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "半句检查完成。");
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[1].at(-1).content, "请从断处继续");
});
