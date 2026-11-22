import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectSpecResult } from "../helpers/spec-result.mjs";

test("成功退出但没有断言：当作失败", () => {
  const result = inspectSpecResult("ordinary.mjs", "执行完毕\n", 0, null);
  assert.equal(result.missing, true);
  assert.equal(result.failures, 1);
});
test("有 PASS 正常通过；有 FAIL 或异常退出均失败", () => {
  assert.equal(inspectSpecResult("ordinary.mjs", "PASS ok\n", 0, null).failures, 0);
  assert.equal(inspectSpecResult("ordinary.mjs", "FAIL bad\n", 0, null).failures, 1);
  assert.equal(inspectSpecResult("ordinary.mjs", "", null, "SIGTERM").failures, 1);
});
test("只作尺寸报告的 prompt-size 是有意的无断言例外", () => {
  assert.equal(inspectSpecResult("prompt-size.mjs", "tokens: 100\n", 0, null).failures, 0);
});
