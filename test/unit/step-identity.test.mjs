import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("重复的上游调用编号不会在各答、帮手之间重用本地步骤编号", () => {
  const { roundSteps } = load(["roundSteps"]);
  const calls = [{ id: "call_0", name: "run_command" }, { id: "call_0", name: "run_command" }];
  const target = { content: "", steps: [] };
  const first = roundSteps(calls, target);
  target.steps.push(...first);
  const next = roundSteps(calls, target);
  const helper = roundSteps(calls, { content: "" }, "helper");
  const ids = [...first, ...next, ...helper].map(step => step.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => /^[A-Za-z0-9_-]+$/.test(id)));
});
