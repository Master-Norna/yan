// 对话对象会换：catchUpConversation 拿新对象替掉 store 里那一份，而帮手、后台指令的闭包还攥着旧的那一个。
// 回报若照着旧对象写，就写进了一个不在 store 里的对象——收件口、行迹、heldReports 全落空，静默丢掉。
// src/14-chat-engine/70-mail.js 的 mailReport 与 wakeWithReports 因此按 id 从 store 重取当前那份
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("回报按 id 落到 store 里当前那份对话上，不写进帮手攥着的旧对象", () => {
  const f = load(["mailReport", "store", `install: job => { requestJob = () => job; refreshSteps = () => {}; }`]);
  const current = { id: "A", messages: [{ id: "a1", role: "assistant", content: "", steps: [] }] };
  f.store.conversations = [current];
  // 帮手那边攥着的旧对象：同一个 id，另一份引用；行迹还是空的（被换掉之后这边没再写过）
  const stale = { id: "A", messages: [{ id: "a1", role: "assistant", content: "" }] };
  const job = { assistantId: "a1", queue: [] };
  f.install(job);
  f.mailReport(stale, { report: "查完了，用 B", step: { id: "s1", title: "查三家框架", status: "done" } });
  assert.equal(job.queue.length, 1, "回报进了这一答的收件口");
  const note = current.messages[0].steps.find(step => step.name === "relay_note");
  assert.ok(note, "行迹里那一步落在 store 当前那份上");
  assert.equal(note.title, "查三家框架");
  assert.equal(note.relay.step, "s1");
  assert.equal(job.queue[0].note, note);
  assert.equal(stale.messages[0].steps, undefined, "旧对象上一个字也没写");
});

test("这一段已被删掉（store 里找不到它）：回报不会把这段造回 store", () => {
  const f = load(["mailReport", "store", `install: job => { requestJob = () => job; refreshSteps = () => {}; }`]);
  f.store.conversations = [];
  const stale = { id: "gone", messages: [{ id: "a1", role: "assistant", content: "" }] };
  const job = { assistantId: "a1", queue: [] };
  f.install(job);
  f.mailReport(stale, { report: "查完了", step: { id: "s1", title: "查", status: "done" } });
  assert.equal(job.queue.length, 1);
  assert.deepEqual(f.store.conversations, [], "按 id 找不到就照旧那份寄，不往 store 里添一段");
});

test("回报另起一答：对象已被换掉时仍能开工，写进 store 当前那份", async () => {
  const f = load([
    "wakeWithReports",
    "store",
    `install: () => {
      claimConversation = async () => true;
      requestJob = () => null;
      profiles = () => [];
      activeProfile = () => ({ id: "p" });
      quotaBlocked = () => false;
      markDirty = () => {};
      saveStore = () => {};
    }`
  ]);
  f.install();
  // 上一答断在报错上：回报先记在这段对话上，等下一答开工时递上
  const current = { id: "A", messages: [{ id: "a1", role: "assistant", content: "", status: "error" }] };
  f.store.conversations = [current];
  const stale = { id: "A", messages: [{ id: "a1", role: "assistant", content: "", status: "error" }] };
  const item = { report: "到点", step: { id: "s1", title: "候「十分钟」到点" }, relay: { step: "s1", title: "十分钟", ok: true } };
  await f.wakeWithReports(stale, [item]);
  assert.ok(current.heldReports, "回报记在 store 当前那份上，没静默丢掉");
  assert.deepEqual(
    current.heldReports.map(held => held.report),
    ["到点"]
  );
  assert.equal(current.heldReports[0].relay.step, "s1");
  assert.equal(stale.heldReports, undefined, "旧对象上一点没写");
});

test("这一段已被删掉时，回报另起一答也不开工", async () => {
  const started = [];
  const f = load([
    "wakeWithReports",
    "store",
    `install: started => {
      claimConversation = async () => true;
      requestJob = () => null;
      profiles = () => [];
      activeProfile = () => ({ id: "p" });
      quotaBlocked = () => false;
      markDirty = () => {};
      saveStore = () => {};
      startTurn = (c, user) => started.push(user.content);
    }`
  ]);
  const stale = { id: "gone", messages: [] };
  f.install(started);
  f.store.conversations = [];
  await f.wakeWithReports(stale, [{ report: "到点", step: { id: "s1" }, relay: { step: "s1", title: "t", ok: true } }]);
  assert.deepEqual(started, [], "没有这一段，不开工");
  assert.equal(stale.heldReports, undefined);
});
