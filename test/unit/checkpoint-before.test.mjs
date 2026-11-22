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

test("工作目录不在：拒绝写入，但交回可照做的说明，不谎称拍摄失败", async () => {
  const f = setup(Promise.reject(Error("检查点未能记下：目录不在")));
  const conversation = { id: "c1", workdir: "E:/w" },
    assistant = { id: "a4" };
  await assert.rejects(() => f.checkpointBefore({ conversation, assistant }), /工作目录已不存在：重新发送这一问即可重建，或另起对话/);
  assert.equal(assistant.checkpoint, undefined);
});

test("只读指令不占检查点，写指令照旧先拍", async () => {
  globalThis.__yanRan = [];
  globalThis.__yanCheckpointShots = 0;
  const f = load([
    "runTool",
    `install: () => {
      defineTool({
        name: "run_command",
        writes: true,
        sideEffect: true,
        schema: { parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
        run: (step, args) => (globalThis.__yanRan.push(args.command), { ok: true, content: "" })
      });
      warmConversation = async () => {};
      keepHook = async () => null;
      reviewHook = async () => null;
      checkpointBefore = async () => { globalThis.__yanCheckpointShots += 1; };
    }`
  ]);
  f.install();
  const ctx = { conversation: { id: "c1", workdir: "E:/w" }, assistant: { id: "a1" }, signal: new AbortController().signal };
  await f.runTool({ name: "run_command", arguments: '{"command":"git status"}' }, ctx);
  assert.equal(globalThis.__yanCheckpointShots, 0, "只读指令不改目录，不必等快照");
  await f.runTool({ name: "run_command", arguments: '{"command":"mkdir out"}' }, ctx);
  assert.equal(globalThis.__yanCheckpointShots, 1, "写指令仍要先拍");
  assert.deepEqual(globalThis.__yanRan, ["git status", "mkdir out"]);
  delete globalThis.__yanCheckpointShots;
  delete globalThis.__yanRan;
});
