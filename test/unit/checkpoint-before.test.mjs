// 检查点没落下时（拍摄途中对话被删，桥接回 discarded），别在消息上记一笔：日后「退回」会找不到册
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup(reply) {
  const f = load([
    "checkpointBefore",
    `install: reply => {
      bridge = async () => reply;
      markDirty = () => {};
    }`
  ]);
  f.install(reply);
  return f;
}

test("拍摄途中对话被删（discarded）：消息上不记检查点", async () => {
  const f = setup({ discarded: true, files: 3 });
  const conversation = { id: "c1", workdir: "E:/w" },
    assistant = { id: "a1" };
  await f.checkpointBefore({ conversation, assistant });
  assert.equal(assistant.checkpoint, undefined);
});

test("照常拍下：记下面目与件数", async () => {
  const f = setup({ files: 3 });
  const conversation = { id: "c1", workdir: "E:/w" },
    assistant = { id: "a1" };
  await f.checkpointBefore({ conversation, assistant });
  assert.equal(assistant.checkpoint.files, 3);
  assert.equal(assistant.checkpoint.root, "E:/w");
});
