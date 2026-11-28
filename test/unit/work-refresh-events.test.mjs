import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("只读、跳过、失败不触发工作区刷新；成功改动合并为一次通知", () => {
  const f = load([
    "workRefreshAfterTools",
    `setup: () => {
      const calls = [];
      workQueueRefresh = c => calls.push(c.id);
      return calls;
    }`
  ]);
  const calls = f.setup(), c = { id: "a" };
  f.workRefreshAfterTools(c, [
    { name: "run_command", status: "done", readOnly: true },
    { name: "write_file", status: "error" },
    { name: "write_file", status: "skipped" }
  ]);
  assert.deepEqual(calls, []);
  f.workRefreshAfterTools(c, [
    { name: "write_file", status: "done" },
    { name: "edit_file", status: "done" }
  ]);
  assert.deepEqual(calls, ["a"]);
});

test("未打开、非当前对话不刷新；连续写入只取一次当前列表", async () => {
  const f = load([
    "work", "workQueueRefresh",
    `setup: () => {
      let count = 0;
      stageShown = () => true;
      currentConversation = () => ({ id: "a" });
      workRefresh = async () => { count++; };
      return () => count;
    }`
  ]);
  const count = f.setup();
  f.workQueueRefresh({ id: "a" });
  f.work.open = true;
  f.workQueueRefresh({ id: "b" });
  f.workQueueRefresh({ id: "a" });
  f.workQueueRefresh({ id: "a" });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(count(), 1);
});
