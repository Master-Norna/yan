import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const conversation = steps => ({
  id: "c1",
  title: "后台任务",
  messages: [{ id: "a1", role: "assistant", content: "", status: "complete", steps }],
  forks: [],
  threads: []
});

for (const kind of ["bg", "timer"])
  test(`别处新增与结束${kind}：跟读后立即更新候，不等切换对话`, async () => {
    const f = load([
      "store",
      "remoteBusy",
      "followConversations",
      "runningBackground",
      `install: (read, paint) => {
        bridge = read;
        renderClepsydra = () => paint(runningBackground().map(item => item.step.id));
        renderHistory = () => {};
      }`
    ]);
    let incoming;
    const painted = [];
    f.install(
      async () => incoming,
      rows => painted.push(rows)
    );
    f.store.conversations = [conversation([])];
    f.remoteBusy.add("c1");
    const step = { id: "s1", name: kind === "bg" ? "run_command" : "set_timer", status: "done" };
    step[kind] = { id: kind + "1", state: kind === "bg" ? "running" : "waiting", due: Date.now() + 60000 };
    incoming = { items: [{ id: "c1", savedAt: 1, conversation: conversation([step]) }] };
    await f.followConversations(["c1"], []);
    assert.deepEqual(
      f.runningBackground().map(item => item.step.id),
      ["s1"]
    );
    assert.deepEqual(painted.at(-1), ["s1"], "后台任务仍归另一页处理，本页也要显示入口");
    step[kind].state = "done";
    incoming = { items: [{ id: "c1", savedAt: 2, conversation: conversation([step]) }] };
    await f.followConversations(["c1"], []);
    assert.deepEqual(painted.at(-1), [], "别处结束后也立即撤下入口");
  });

test("直接读回对话新版本时，候随当前步骤更新", () => {
  const f = load([
    "store",
    "catchUpConversation",
    "runningBackground",
    `install: paint => {
      renderClepsydra = () => paint(runningBackground().map(item => item.step.id));
      renderHistory = () => {};
    }`
  ]);
  const painted = [];
  f.install(rows => painted.push(rows));
  f.store.conversations = [conversation([])];
  const step = { id: "s1", name: "run_command", status: "done", bg: { id: "bg1", state: "running" } };
  f.catchUpConversation({ id: "c1", savedAt: 1, conversation: conversation([step]) });
  assert.deepEqual(painted.at(-1), ["s1"]);
});

test("接回旧版另存的帮手步骤后，恢复候与后台监听", async () => {
  const f = load([
    "store",
    "warmInView",
    "bgWatches",
    "runningBackground",
    `install: (piece, paint) => {
      chatsDir = () => 'test-chats';
      bridge = async route => route === '/api/chats/trail/get' ? { pieces: { old: piece } } : new Promise(() => {});
      renderClepsydra = () => paint(runningBackground().map(item => item.step.id));
      holdAwake = () => {};
    }`
  ]);
  const c = conversation([{ id: "delegate", name: "delegate", status: "done", sub: { id: "helper", status: "stopped" } }]);
  c.messages[0].cold = { key: "old" };
  f.store.conversations = [c];
  const step = { id: "s1", name: "run_command", status: "done", bg: { id: "bg1", key: "k1", state: "running" } };
  const painted = [];
  f.install({ subs: { helper: { steps: [step] } } }, rows => painted.push(rows));
  f.warmInView(c);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(painted.at(-1), ["s1"], "入口随取回的步骤恢复");
  assert.equal(f.bgWatches.has("s1"), true, "结束后仍能收取回报");
});
