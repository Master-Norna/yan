// issue #72 的两条页面与租约修复：
//  1) 别处松手、这段对话接手过来时，要补挂后台指令的 watch（原先只在开页时挂一次）；
// 10) 刷新恢复旁注线程时，步骤也要收束，不能永远转圈。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("followConversations：租约变更接手的对话补挂后台 watch", async () => {
  const f = load([
    "followConversations",
    "rewatchBackground",
    "bgWatches",
    `setup: conversation => {
      store = { conversations: [conversation] };
      remoteBusy.clear();
      requestJobs.clear();
      renderHistory = renderConversation = renderClepsydra = holdAwake = () => {};
      activeProfile = () => ({ id: "p" });
      // /api/work/watch 一直挂着：模拟后台指令还在跑、等着回话
      bridge = async url => (String(url).includes("/api/work/watch") ? new Promise(() => {}) : { items: [] });
    }`
  ]);
  const step = { id: "s1", name: "run_command", arguments: "{}", status: "done", bg: { id: "bg1", key: "k", state: "running" } };
  const conversation = { id: "c1", messages: [{ id: "a1", role: "assistant", content: "", steps: [step] }] };
  f.setup(conversation);
  await f.followConversations([], []);
  assert.equal(f.bgWatches.has("s1"), true, "接手过来的对话里在跑的后台指令要重新等上");
});

test("recoverConversation：刷新恢复旁注时步骤一并收束", () => {
  const f = load(["recoverConversation"]);
  const step = { id: "s1", name: "probe", arguments: "{}", status: "running" };
  const conversation = {
    id: "c1",
    messages: [],
    threads: [{ id: "t1", messages: [{ id: "m1", role: "assistant", content: "半句", status: "streaming", steps: [step] }] }]
  };
  assert.equal(f.recoverConversation(conversation), true);
  assert.equal(conversation.threads[0].messages[0].status, "stopped");
  assert.equal(step.status, "error");
  assert.equal(step.result, "页面刷新");
});
