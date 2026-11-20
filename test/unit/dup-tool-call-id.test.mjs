// 上游偶尔在同一轮的两件调用里给同一个 id（流里 index 分开、id 相同）。页面原来拿 call.id 当唯一键：
// 结果按 id 收进 Map，后一件盖掉前一件，模型拿着 A 的参数读到 B 的结果；历史里同 id 的 tool_calls 还有上游直接拒。
// 这里从一轮的调用怎么拟成步骤起手，走到历史里那两条消息，看的是同一份 id。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function fixture(callsOf) {
  const probe = { ids: [], rounds: 0 };
  const f = load([
    "runRounds",
    "newTally",
    "TOOLS",
    `setup: (probe, callsOf) => {
      TOOLS.clear();
      TOOLS.set("probe", { parallel: true });
      readReply = async (profile, history, signal, overrides, target) => {
        probe.rounds += 1;
        const calls = callsOf(probe.rounds);
        if (!calls) return void (target.content += "说完了");
        target.content += "看着这两件";
        target.toolCalls = calls;
      };
      runSteps = async steps => {
        probe.ids.push(...steps.map(step => step.id));
        return { outcomes: new Map(steps.map((step, index) => [step.id, "结果" + index])), images: [] };
      };
      deliverSupplements = async () => {};
      foldByModel = () => {};
      attachToolImages = () => {};
      refreshSteps = () => {};
      saveStore = () => {};
      spendTokens = () => {};
      renderQuota = () => {};
      prompt = key => key;
    }`
  ]);
  f.setup(probe, callsOf);
  return { f, probe };
}

async function run(f, target = { id: "a", role: "assistant", content: "" }) {
  const history = [],
    tally = { usage: {}, spent: 0, roundStart: 0, replyStart: 0 };
  await f.runRounds(target, history, {
    profile: {},
    conversation: { id: "c" },
    host: target,
    signal: new AbortController().signal,
    overrides: { tools: [{ function: { name: "probe" } }] },
    tally,
    roundLimit: 5
  });
  return { history, target };
}

const calls = () => [
  { id: "dup", name: "probe", arguments: '{"x":"A"}' },
  { id: "dup", name: "probe", arguments: '{"x":"B"}' }
];

test("同一轮两件调用同 id：各得其果，历史里也不撞", async () => {
  const { f, probe } = fixture(round => (round === 1 ? calls() : null)),
    { history } = await run(f);
  assert.equal(new Set(probe.ids).size, 2, "两件各是各的 id");
  const assistant = history.find(message => message.role === "assistant" && message.tool_calls),
    toolIds = history.filter(message => message.role === "tool").map(message => message.tool_call_id);
  assert.deepEqual(
    assistant.tool_calls.map(call => call.id),
    probe.ids,
    "发给模型的调用与交回的 tool 消息配的是同一份 id"
  );
  assert.deepEqual(toolIds, probe.ids);
  // 第一件拿到的仍是它自己的结果：参数 A 配结果 0，参数 B 配结果 1
  assert.deepEqual(
    assistant.tool_calls.map((call, index) => [
      JSON.parse(call.function.arguments).x,
      history.filter(m => m.role === "tool")[index].content
    ]),
    [
      ["A", "结果0"],
      ["B", "结果1"]
    ]
  );
});

test("同一答里后一轮又给了同一个 id：仍不与先前那一步撞", async () => {
  const { f, probe } = fixture(round => (round <= 2 ? calls() : null)),
    { target } = await run(f);
  assert.equal(probe.ids.length, 4);
  assert.equal(new Set(probe.ids).size, 4, "四件各是各的 id");
  assert.deepEqual(
    target.steps.map(step => step.id),
    probe.ids
  );
});

test("没给 id 的调用照旧自己拟一个，两件不撞", async () => {
  const { f, probe } = fixture(round =>
      round === 1
        ? [
            { name: "probe", arguments: "{}" },
            { name: "probe", arguments: "{}" }
          ]
        : null
    ),
    { history } = await run(f);
  assert.equal(new Set(probe.ids).size, 2);
  assert.match(probe.ids[0], /^call_/);
});
