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
  f.setChat({
    workdir: "/new",
    messages: [
      { role: "assistant", id: "old", steps: [step("/old", "historical.txt")] },
      { role: "assistant", id: "new", status: "streaming", steps: [step("/old", "same.txt", true), step("/new", "same.txt"), step("/new", "/old/same.txt"), step("", "unknown.txt"), step("", "/absolute.txt")] }
    ]
  });
  assert.deepEqual(f.workChangedFiles(), [
    { path: "/old/same.txt", created: true },
    { path: "/new/same.txt", created: false },
    { path: "unknown.txt", created: false },
    { path: "/absolute.txt", created: false }
  ]);
});
