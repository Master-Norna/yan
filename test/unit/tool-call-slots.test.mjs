// 流里的工具调用既没有 index 也没有 id：同一个 tool_calls 数组里第二件起的都是新的一件（一件调用不会在同一个数组里续写自己）；
// 第二件与末一件同 id 的例外——id 说了是同一件，续在它上面。跨块的名字、参数续块仍旧续在末一件上——
// 名字分块到达（read_ + file）与每块重发名字都不能被拆成两件
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const frame = delta => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`;
const done = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
/** 一块里带上这几件调用（原样交给接口的写法，可以不带 index / id） */
const calls = (...toolCalls) => frame({ tool_calls: toolCalls });
const call = (name, args = "{}", extra = {}) => ({ function: { name, arguments: args }, ...extra });

function setup() {
  const f = load([
    "readSse",
    `setup: () => {
      document.documentElement.dataset.inkMotion = 'off';
      document.hidden = true;
      saveStoreSoon = saveStore = paintMessage = syncJumpBottom = scrollBottom = () => {};
    }`
  ]);
  f.setup();
  return f;
}
/** 把这几块按顺序流进来，交回开发的那条消息 */
async function read(f, wire) {
  const assistant = { id: "a", role: "assistant", content: "" };
  await f.readSse(new Response(wire + done, { headers: { "content-type": "text/event-stream" } }), assistant);
  return assistant;
}
const shape = assistant => assistant.toolCalls.map(({ name, arguments: args }) => `${name}(${args})`);

test("同一块里两件异名：拆成两件", async () => {
  const assistant = await read(setup(), calls(call("read_file", '{"path":"a"}'), call("write_file", '{"path":"b"}')));
  assert.deepEqual(shape(assistant), ['read_file({"path":"a"})', 'write_file({"path":"b"})']);
});

test("同一块里两件同名：也拆成两件", async () => {
  const assistant = await read(setup(), calls(call("probe", '{"x":1}'), call("probe", '{"x":2}'), call("probe", '{"x":3}')));
  assert.deepEqual(shape(assistant), ['probe({"x":1})', 'probe({"x":2})', 'probe({"x":3})']);
});

test("名字分块到达（read_ + file）：仍是一件", async () => {
  const assistant = await read(setup(), calls(call("read_", "")) + calls(call("file", '{"path":"a"}')));
  assert.deepEqual(shape(assistant), ['read_file({"path":"a"})']);
});

test("每块重发名字、参数续块：仍是一件，参数拼上", async () => {
  const f = setup();
  let assistant = await read(f, calls(call("probe", '{"a')) + calls(call("probe", '":1')) + calls(call("probe", ',"b":2}')));
  assert.deepEqual(shape(assistant), ['probe({"a":1,"b":2})']);
  // 每块带完整参数（有的接口这么发）：名字不重复拼
  assistant = await read(f, calls(call("probe", "{}")) + calls(call("probe", "{}")));
  assert.equal(assistant.toolCalls.length, 1);
  assert.equal(assistant.toolCalls[0].name, "probe");
});

test("只有参数的续块：续在原件上，不另起一件", async () => {
  const assistant = await read(
    setup(),
    calls(call("read_file", "")) + calls({ function: { arguments: '{"path"' } }) + calls({ function: { arguments: ':"a"}' } })
  );
  assert.deepEqual(shape(assistant), ['read_file({"path":"a"})']);
});

test("带 index 的照旧按 index 归位，同块里乱序也一样", async () => {
  const assistant = await read(
    setup(),
    calls(call("second", '{"x":2', { index: 1 }), call("first", '{"x":1', { index: 0 })) +
      calls({ index: 0, function: { arguments: ',"y":1}' } }, { index: 1, function: { arguments: ',"y":2}' } })
  );
  assert.deepEqual(shape(assistant), ['first({"x":1,"y":1})', 'second({"x":2,"y":2})']);
});

test("同一块里两件同 id、第二件不带 index：id 说了是同一件，仍是一件", async () => {
  const assistant = await read(setup(), calls(call("probe", '{"x"', { id: "c1" }), { id: "c1", function: { arguments: ":1}" } }));
  assert.deepEqual(shape(assistant), ['probe({"x":1})']);
  assert.equal(assistant.toolCalls.length, 1);
});

test("带 id 的：换了 id 就是新的一件，同块里两件异 id 也拆开", async () => {
  const assistant = await read(
    setup(),
    calls(call("read_file", '{"path":"a"}', { id: "call_1" })) +
      calls(call("write_file", '{"path":"b"}', { id: "call_2" })) +
      calls(call("patch", "", { id: "call_3" }), call("run", "{}", { id: "call_4" }))
  );
  assert.deepEqual(shape(assistant), ['read_file({"path":"a"})', 'write_file({"path":"b"})', "patch()", "run({})"]);
  assert.deepEqual(
    assistant.toolCalls.map(slot => slot.id),
    ["call_1", "call_2", "call_3", "call_4"]
  );
});
