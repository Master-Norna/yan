import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("新答只带初始消息字段，使用当前模型名", context => {
  const { newAssistant } = load(["newAssistant"]);
  context.mock.method(globalThis.crypto, "randomUUID", () => "answer-1");
  context.mock.method(Date.prototype, "toISOString", () => "2026-11-17T12:00:00.000Z");
  const profile = Object.freeze({ id: "profile-1", name: "当前模型", model: "upstream-model" });

  assert.deepEqual(newAssistant(profile), {
    id: "answer-1",
    role: "assistant",
    content: "",
    timestamp: "2026-11-17T12:00:00.000Z",
    status: "streaming",
    modelName: "当前模型"
  });
});

test("每次新答重新取 ID 和时间，消息对象互不影响", context => {
  const { newAssistant } = load(["newAssistant"]);
  let ids = 0,
    times = 0;
  context.mock.method(globalThis.crypto, "randomUUID", () => `answer-${++ids}`);
  context.mock.method(Date.prototype, "toISOString", () => `2026-11-17T12:00:0${++times}.000Z`);
  const profile = { name: "原模型" };
  const first = newAssistant(profile);
  profile.name = "新模型";
  const second = newAssistant(profile);

  assert.notEqual(first, second);
  assert.equal(first.id, "answer-1");
  assert.equal(second.id, "answer-2");
  assert.equal(first.timestamp, "2026-11-17T12:00:01.000Z");
  assert.equal(second.timestamp, "2026-11-17T12:00:02.000Z");
  assert.equal(ids, 2);
  assert.equal(times, 2);
  assert.equal(first.modelName, "原模型");
  assert.equal(second.modelName, "新模型");
  first.content = "写好的第一答";
  first.status = "done";
  first.steps = [];
  assert.equal(second.content, "");
  assert.equal(second.status, "streaming");
  assert.equal(second.steps, undefined);
});
