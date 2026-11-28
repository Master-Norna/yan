import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("工作区改动以原步骤落脚处归并，不拿现目录猜旧路径", () => {
  const f = load(["workChangedFiles", "changeStats", "setChat: chat => { currentConversation = () => chat; }"]);
  const step = (root, file, created = false) => ({
    status: "done",
    root,
    change: { path: file, created }
  });
  const chat = {
    workdir: "/new",
    messages: [
      { role: "assistant", id: "old", steps: [step("/old", "historical.txt")] },
      {
        role: "assistant",
        id: "new",
        status: "streaming",
        steps: [
          step("/old", "same.txt", true),
          step("/new", "same.txt"),
          step("/new", "/old/same.txt"),
          step("", "unknown.txt"),
          step("", "/absolute.txt")
        ]
      }
    ]
  };
  f.setChat(chat);
  assert.deepEqual(f.workChangedFiles(), [
    { path: "/old/same.txt", created: true },
    { path: "/new/same.txt", created: false },
    { path: "unknown.txt", created: false },
    { path: "/absolute.txt", created: false }
  ]);
  const rows = f.workChangedFiles();
  const stats = f.changeStats(chat.messages[1]);
  assert.deepEqual(rows.map(row => row.path), stats.files.map(file => file.path));
});

test("开始新答立即清掉旧答改动及 diff 页签，普通文件页签保留", async () => {
  const f = load([
    "work",
    "workRefresh",
    "workSyncChangeReply",
    "workChangeRows",
    `setup: () => {
      const chat = { messages: [{ id: "old", role: "assistant", status: "complete", steps: [
        { status: "done", change: { path: "/old.txt", added: 1, removed: 0 } }
      ] }] };
      currentConversation = () => chat;
      workPaint = () => {};
      workCloseViewer = () => {};
      bridge = async () => ({ kind: "file" });
      work.mode = "changes";
      return chat;
    }`
  ]);
  const chat = f.setup();
  await f.workRefresh();
  assert.deepEqual(f.workChangeRows().map(row => row.path), ["/old.txt"]);
  f.work.tabs = [
    { path: "/keep.txt", diff: false },
    { path: "/old.txt", diff: true }
  ];
  f.work.active = 1;
  chat.messages.push({ id: "new", role: "assistant", status: "streaming", steps: [] });
  assert.equal(f.workSyncChangeReply(), true);
  assert.deepEqual(f.workChangeRows(), []);
  assert.deepEqual(f.work.tabs.map(tab => tab.path), ["/keep.txt"]);
  assert.equal(f.work.active, -1);
  chat.messages[1].steps.push({ status: "done", change: { path: "/new.txt", added: 1, removed: 0 } });
  await f.workRefresh();
  assert.deepEqual(f.workChangeRows().map(row => row.path), ["/new.txt"]);
  chat.messages[1].status = "complete";
  assert.equal(f.workSyncChangeReply(), false);
});
