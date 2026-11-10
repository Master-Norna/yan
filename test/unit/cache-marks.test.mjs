// 经 OpenAI 兼容中转用 Claude 时的缓存标记：系统提示、上一次请求的末尾、最后一条各一处，页面标的这一问首段原样留着，原消息不动；别家模型的标记去掉
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { claudeModel, markOpenAiCache, stripCacheMarks } = createRequire(import.meta.url)("../../server/model/anthropic.js");
const EPHEMERAL = { type: "ephemeral" };

test("only Claude models get cache marks", () => {
  assert.ok(claudeModel("claude-opus-5.5"));
  assert.ok(claudeModel("anthropic/Claude-Sonnet-5.5"));
  assert.ok(!claudeModel("gpt-6-luna"));
  assert.ok(!claudeModel("qwen3.8-27b"));
});

test("marks the system prompt, the previous request's tail and the last message, leaves the rest", () => {
  const call = id => ({
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name: "read", arguments: "{}" } }]
  });
  const messages = [
    { role: "system", content: "系统" },
    {
      role: "user",
      content: [
        { type: "text", text: "读 a", cache_control: EPHEMERAL },
        { type: "text", text: "［目录记忆］" }
      ]
    },
    call("c1"),
    { role: "tool", tool_call_id: "c1", content: "a 的内容" },
    call("c2"),
    { role: "tool", tool_call_id: "c2", content: "b 的内容" }
  ];
  const marked = markOpenAiCache(messages);
  assert.deepEqual(marked[0].content, [{ type: "text", text: "系统", cache_control: EPHEMERAL }]);
  assert.equal(marked[1], messages[1], "这一问首段页面已标好，原样留着");
  assert.equal(marked[2], messages[2]);
  assert.deepEqual(marked[3].content, [{ type: "text", text: "a 的内容", cache_control: EPHEMERAL }], "上一次请求的末尾");
  assert.equal(marked[4], messages[4]);
  assert.deepEqual(marked[5].content, [{ type: "text", text: "b 的内容", cache_control: EPHEMERAL }]);
  assert.equal(messages[5].content, "b 的内容", "原消息不被改动");
  assert.equal(JSON.stringify(marked).split('"cache_control"').length - 1, 4, "四处，正是上限");
});

test("a multi-part tail gets the mark on its last part only", () => {
  const tail = {
    role: "user",
    content: [
      { type: "text", text: "看图" },
      { type: "image_url", image_url: { url: "data:," } }
    ]
  };
  const [marked] = markOpenAiCache([tail]);
  assert.equal(marked.content[0].cache_control, undefined);
  assert.deepEqual(marked.content[1].cache_control, EPHEMERAL);
  assert.equal(tail.content[1].cache_control, undefined);
});

test("other models get the page's marks stripped", () => {
  const ask = {
      role: "user",
      content: [
        { type: "text", text: "问", cache_control: EPHEMERAL },
        { type: "text", text: "［目录记忆］" }
      ]
    },
    plain = { role: "assistant", content: "答" };
  const [stripped, same] = stripCacheMarks([ask, plain]);
  assert.deepEqual(stripped.content, [
    { type: "text", text: "问" },
    { type: "text", text: "［目录记忆］" }
  ]);
  assert.equal(same, plain);
  assert.deepEqual(ask.content[0].cache_control, EPHEMERAL, "原消息不被改动");
});
