// 工具调用按 id 归位：多件并行时，参数的续块会交错送到——先在头几块里报了 id 与名字，
// 后面才各自补参数。此时「续块」的 id 指着的不是末一件，照末件判就会把同一件拆成两件
// （一件有名字、一件只有半段参数），行迹上多出一样、执行时两件都跑不对。
// 见 src/16-api.js 归位那一段：有 id 先在已拟的几件里找它；找不到才照位置另起或续末件。
// 改动前本文件两条「交错」用例是红的（同一件被拆开）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const sse = wire => new Response(wire, { headers: { "content-type": "text/event-stream" } });
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;
const done = "data: [DONE]\n\n";

function setup() {
  const f = load([
    "readSse",
    `setup: () => {
      document.documentElement.dataset.inkMotion = "off";
      document.hidden = true;
      refreshSteps = () => {};
    }`
  ]);
  f.setup();
  return f;
}
const wireOf = events => sse(events.join("") + done);

test("带 id 的续块交错送到：按 id 归位，同一件不被拆成两件", async () => {
  const f = setup();
  const target = { content: "", toolCalls: null };
  await f.readSse(
    wireOf([
      chunk({ tool_calls: [{ id: "call_a", function: { name: "probe_a", arguments: "" } }] }),
      chunk({ tool_calls: [{ id: "call_b", function: { name: "probe_b", arguments: "" } }] }),
      // a 的续块：末一件是 b，但它 id 指着 a
      chunk({ tool_calls: [{ id: "call_a", function: { arguments: '{"x":' } }] }),
      chunk({ tool_calls: [{ id: "call_b", function: { arguments: '{"y":' } }] }),
      chunk({ tool_calls: [{ id: "call_a", function: { arguments: "1}" } }] }),
      chunk({ tool_calls: [{ id: "call_b", function: { arguments: "2}" } }] }),
      chunk({}, "tool_calls")
    ]),
    target
  );
  assert.deepEqual(
    target.toolCalls.map(call => [call.id, call.name, call.arguments]),
    [
      ["call_a", "probe_a", '{"x":1}'],
      ["call_b", "probe_b", '{"y":2}']
    ]
  );
});

test("交错也照 index 归位（带 index 的照旧）", async () => {
  const f = setup();
  const target = { content: "", toolCalls: null };
  await f.readSse(
    wireOf([
      chunk({ tool_calls: [{ index: 0, id: "call_a", function: { name: "probe_a", arguments: "{}" } }] }),
      chunk({ tool_calls: [{ index: 1, id: "call_b", function: { name: "probe_b", arguments: "{}" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "" } }] })
    ]),
    target
  );
  assert.deepEqual(
    target.toolCalls.map(call => [call.id, call.name, call.arguments]),
    [
      ["call_a", "probe_a", "{}"],
      ["call_b", "probe_b", "{}"]
    ]
  );
});

test("没有 id 的照旧：单独数组的续块续末件", async () => {
  const f = setup();
  const target = { content: "", toolCalls: null };
  await f.readSse(
    wireOf([
      chunk({ tool_calls: [{ function: { name: "probe", arguments: '{"a"' } }] }),
      chunk({ tool_calls: [{ function: { arguments: ":1}" } }] })
    ]),
    target
  );
  assert.deepEqual(
    target.toolCalls.map(call => [call.name, call.arguments]),
    [["probe", '{"a":1}']]
  );
});

test("没有 id 的照旧：同一块里两件各占一槽", async () => {
  const f = setup();
  const target = { content: "", toolCalls: null };
  await f.readSse(
    wireOf([
      chunk({
        tool_calls: [{ function: { name: "probe_c", arguments: "{}" } }, { function: { name: "probe_d", arguments: "{}" } }]
      }),
      chunk({}, "tool_calls")
    ]),
    target
  );
  assert.deepEqual(
    target.toolCalls.map(call => [call.name, call.arguments]),
    [
      ["probe_c", "{}"],
      ["probe_d", "{}"]
    ]
  );
});
