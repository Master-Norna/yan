import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("截断参数理顺后成为结束指令：不执行", async () => {
  const f = load(["runTool", "TOOLS", "sideEffectOf"]);
  const tool = f.TOOLS.get("check_command");
  let calls = 0;
  tool.run = async () => {
    calls++;
    return { ok: true, content: "", display: "" };
  };
  const step = { id: "x", name: "check_command", arguments: '{"id":"b1","stop":"true",' };
  const outcome = await f.runTool(step, {
    conversation: { id: "c", messages: [] },
    assistant: {},
    signal: new AbortController().signal
  });
  assert.equal(outcome.ok, false);
  assert.equal(step.effect, true);
  assert.equal(outcome.display, "参数不完整");
  assert.equal(calls, 0);
  assert.equal(f.sideEffectOf(f.TOOLS.get("set_timer"), {}), true);
});
