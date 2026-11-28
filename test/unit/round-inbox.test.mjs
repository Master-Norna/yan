import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("每趟轮次收件口的队列和中止器独立，初始状态一致", () => {
  const { createRoundInbox } = load(["createRoundInbox"]);
  const a = createRoundInbox(),
    b = createRoundInbox();
  a.queue.push({ report: "done" });
  a.controller.abort();
  assert.deepEqual(b.queue, []);
  assert.equal(b.controller.signal.aborted, false);
  assert.equal(b.round, null);
  assert.equal(b.reading, false);
  assert.equal(b.roundStart, 0);
  assert.equal(b.steerTimer, 0);
});
