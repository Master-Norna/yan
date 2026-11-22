// 检查点没落下时（桥接出错或对话被删），拒绝接下来的文件写入，不要制造无法回退的假安全感
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
  await assert.rejects(() => f.checkpointBefore({ conversation, assistant }), /检查点未能建立/);
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

test("桥接拍摄失败：明确拒绝继续修改文件", async () => {
  const f = setup(Promise.reject(Error("disk full")));
  const conversation = { id: "c1", workdir: "E:/w" },
    assistant = { id: "a3" };
  await assert.rejects(() => f.checkpointBefore({ conversation, assistant }), /文件检查点未能建立：disk full/);
  assert.equal(assistant.checkpoint, undefined);
});
