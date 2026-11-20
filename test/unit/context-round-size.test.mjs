import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const wire = (...parts) => new Response(parts.map(part => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n");
const toolCall = id => ({
  choices: [{ delta: { tool_calls: [{ id, function: { name: "probe", arguments: "{}" } }] }, finish_reason: "tool_calls" }]
});
const final = { choices: [{ delta: { content: "做完了" }, finish_reason: "stop" }] };
const usage = tokens => ({ usage: { prompt_tokens: tokens, completion_tokens: 5, total_tokens: tokens + 5 } });

test("每轮发送前刷新估算，只有同轮的提示用量能替换它", async () => {
  const f = load([
    "newTally",
    "requestSize",
    "runRounds",
    `install: request => {
      document.documentElement.dataset.inkMotion = "off";
      saveStoreSoon = refreshSteps = spendTokens = renderQuota = () => {};
      requestPatiently = request;
      runSteps = async steps => ({ outcomes: new Map(steps.map(step => [step.id, '字'.repeat(7000)])), images: [] });
    }`
  ]);
  const history = [{ role: "user", content: "查一下" }],
    profile = { id: "p", contextWindow: 100000 },
    conversation = { id: "c" },
    assistant = { id: "a", content: "" },
    replies = [wire(toolCall("one"), usage(18000)), wire(toolCall("two")), wire(final, usage(34000))],
    sizes = [],
    sent = [],
    overrides = { systemPrompt: "务必核对", tools: [{ function: { name: "probe" } }], head: 1, onSize: n => sizes.push(n) };
  f.install((_, history, _signal, options) => {
    sent.push(sizes.at(-1));
    assert.equal(sizes.at(-1), f.requestSize(history, options), "发出请求时界面已拿到这一轮的估算");
    return replies.shift();
  });
  const first = f.requestSize(history, overrides);
  await f.runRounds(assistant, history, {
    profile,
    conversation,
    host: assistant,
    signal: new AbortController().signal,
    overrides,
    tally: f.newTally(),
    roundLimit: 3
  });
  assert.equal(sent.length, 3);
  assert.ok(sent[1] >= 25000 && sent[2] >= 32000, "不报用量的工具轮，后面仍把新工具结果算进请求");
  assert.deepEqual(sizes, [first, 18000, sent[1], sent[2], 34000]);
  assert.equal(assistant.content.trim(), "做完了");
});

test("同轮因上下文溢出重发：上次失败流报的数不能当成重发的实测", async () => {
  const f = load([
    "readReply",
    `install: request => {
      document.documentElement.dataset.inkMotion = "off";
      saveStoreSoon = () => {};
      requestPatiently = request;
      keepInWindow = async (_profile, history, _signal, _overrides, options) => {
        if (!options.overflow) return false;
        history[0].content = '短';
        return true;
      };
    }`
  ]);
  const history = [{ role: "user", content: "字".repeat(4000) }],
    sizes = [],
    replies = [wire(usage(99999), { error: "maximum context length is 100000 tokens" }), wire(final)],
    overrides = { onSize: n => sizes.push(n) },
    assistant = { id: "a", content: "" };
  f.install(() => replies.shift());
  await f.readReply({ id: "p" }, history, new AbortController().signal, overrides, assistant);
  assert.deepEqual(sizes, [4004, 5]);
  assert.equal(assistant.usage, null);
});
