// 整份回来的答复（没走流式的中转、网关）由桥接摆成只有一块的事件流（server/model/sse.js 的 wholeReplyEvents），页面照流读：
// 三轮带工具时思绪累加、轮内行内 <think> 拆开不送回模型、tool_calls 归位、finish_reason 缺失按 stop
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const { wholeReplyEvents } = createRequire(import.meta.url)("../../server/model/sse.js");
const bare = data => new Response(wholeReplyEvents(data), { headers: { "content-type": "text/event-stream" } });
const whole = (message, finish_reason = "stop", extra = {}) =>
  bare({ choices: [{ message, finish_reason }], usage: { total_tokens: 12, prompt_tokens: 7, completion_tokens: 5 }, ...extra });
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: args } });

function setup(replies = []) {
  const f = load([
    "readSse",
    "readWhole",
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
      toolDefinitions = () => [
        { type: 'function', function: { name: 'probe' } },
        { type: 'function', function: { name: 'read_file' } }
      ];
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
      return { outcomes: new Map(steps.map(step => [step.id, `${step.name} 已完成`])), images: [] };
    }
  );
  return { ...f, requests, runs };
}

async function turn(f) {
  const assistant = { id: "a", role: "assistant", content: "", status: "streaming" };
  const conversation = { id: "c", messages: [{ id: "u", role: "user", content: "办一件事" }, assistant] };
  await f.streamReply(conversation, assistant, { id: "p", tools: true });
  return assistant;
}
/** 历史里各条 assistant 的话与送回的思绪 */
const assistantTurns = request => request.filter(item => item.role === "assistant");

test("整份答复里的行内 <think>：正文与思绪分开落下", async () => {
  const f = setup([whole({ content: "<think>想一想</think>\n\n答复正文" })]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "答复正文");
  assert.equal(assistant.reasoning, "想一想");
  assert.equal(assistant.usage.total_tokens, 12);
});

test("整份答复里的行内 <think> 与工具调用：下一轮送回的不带 <think>", async () => {
  const f = setup([
    whole({ content: "<think>想第一轮</think>我查一下", tool_calls: [call("call_1", "probe", "{}")] }, "tool_calls"),
    whole({ content: "查完了" })
  ]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "我查一下\n\n查完了");
  assert.equal(assistant.reasoning, "想第一轮");
  const sent = assistantTurns(f.requests[1]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "我查一下");
  assert.doesNotMatch(JSON.stringify(f.requests[1]), /<think>/);
  assert.equal(sent[0].reasoning_content, "想第一轮");
});

test("三轮带工具：思绪逐轮累加，第 2、3 轮的思绪都随调用送回", async () => {
  const f = setup([
    whole({ reasoning_content: "想第一轮", tool_calls: [call("call_1", "probe", "{}")] }, "tool_calls"),
    whole({ reasoning_content: "想第二轮", tool_calls: [call("call_2", "probe", "{}")] }, "tool_calls"),
    whole({ reasoning_content: "想第三轮", tool_calls: [call("call_3", "probe", "{}")] }, "tool_calls"),
    whole({ content: "都办完了" })
  ]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "都办完了");
  assert.equal(assistant.reasoning, "想第一轮想第二轮想第三轮");
  // 第 4 趟请求里，前三条 assistant 各自带着自己那一轮的思绪（从前整份只剩最后一轮，第 3 轮是空的）
  assert.deepEqual(
    assistantTurns(f.requests[3]).map(item => item.reasoning_content),
    ["想第一轮", "想第二轮", "想第三轮"]
  );
  // 第 2 趟里只有第一轮
  assert.deepEqual(
    assistantTurns(f.requests[1]).map(item => item.reasoning_content),
    ["想第一轮"]
  );
  assert.equal(f.runs.length, 3);
});

test("finish_reason 缺失：按 stop 收尾，不报错、也不算中断", async () => {
  const f = setup([bare({ choices: [{ message: { content: "没有结束原因" } }] })]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "没有结束原因");
  assert.equal(assistant.error, undefined);
  assert.equal(f.requests.length, 1);
});

test("整份答复里的 tool_calls 归位：照次序编上 index，两件各成一步", async () => {
  const f = setup([
    whole(
      {
        content: "两件事一起做",
        tool_calls: [call("call_a", "probe", '{"x":1}'), call("call_b", "read_file", '{"path":"a.txt"}')]
      },
      "tool_calls"
    ),
    whole({ content: "都做完了" })
  ]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.deepEqual(
    f.runs.map(step => [step.id, step.name, step.arguments]),
    [
      ["call_a", "probe", '{"x":1}'],
      ["call_b", "read_file", '{"path":"a.txt"}']
    ]
  );
  const sent = assistantTurns(f.requests[1]);
  assert.deepEqual(
    sent[0].tool_calls.map(item => [item.id, item.function.name, item.function.arguments]),
    [
      ["call_a", "probe", '{"x":1}'],
      ["call_b", "read_file", '{"path":"a.txt"}']
    ]
  );
  assert.deepEqual(
    f.requests[1].filter(item => item.role === "tool").map(item => [item.tool_call_id, item.content]),
    [
      ["call_a", "probe 已完成"],
      ["call_b", "read_file 已完成"]
    ]
  );
});

test("整份答复里两件都带 index: 0：位置才算数，仍是两件，不并成一件", async () => {
  const f = setup([
    whole(
      {
        content: "两件事一起做",
        tool_calls: [
          { ...call("call_a", "probe", '{"x":1}'), index: 0 },
          { ...call("call_b", "probe", '{"x":2}'), index: 0 }
        ]
      },
      "tool_calls"
    ),
    whole({ content: "都做完了" })
  ]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  // 上游自带的 index 若盖掉位置，readSse 会把两件并成一格，参数拼成 {"x":1}{"x":2}，白跑一轮
  assert.deepEqual(
    f.runs.map(step => [step.id, step.name, step.arguments]),
    [
      ["call_a", "probe", '{"x":1}'],
      ["call_b", "probe", '{"x":2}']
    ]
  );
});

test("拟题、撮要（readWhole）同样走这一条路：行内 <think> 分开，用量照记", async () => {
  const f = setup();
  const response = whole({ content: "<think>想一下</think>项目训练" });
  const { reply, tokens } = await f.readWhole(response, "给这一问拟个题");
  assert.equal(reply.content, "项目训练");
  assert.equal(reply.reasoning, "想一下");
  assert.equal(tokens, 12);
});
