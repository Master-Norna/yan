// 专司没成要弹一句（审查退回照规则）；同一职连着出同样的错只提一回，成过一次再出错才再提
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup() {
  return load([
    "dutyFailed",
    "dutyOk",
    `setup: () => {
      store.toasts = [];
      toast = message => store.toasts.push(message);
    }`,
    "toasts: () => store.toasts"
  ]);
}

test("dutyFailed：同样的错连着来只提一回，成过一次再出错再提", () => {
  const f = setup();
  f.setup();
  f.dutyFailed("review", Error("401 Unauthorized"));
  f.dutyFailed("review", Error("401 Unauthorized"));
  assert.equal(f.toasts().length, 1);
  assert.match(f.toasts()[0], /审查没成，这一步照规则办：401 Unauthorized/);
  f.dutyFailed("review", Error("审查模型没给出准或驳"));
  assert.equal(f.toasts().length, 2, "换了原因要再提");
  f.dutyOk("review");
  f.dutyFailed("review", Error("审查模型没给出准或驳"));
  assert.equal(f.toasts().length, 3, "成过一次之后再出错要再提");
});

test("dutyFailed：超时写成「超时」", () => {
  const f = setup();
  f.setup();
  f.dutyFailed("review", Object.assign(Error("signal timed out"), { name: "TimeoutError" }));
  assert.deepEqual(f.toasts(), ["审查没成，这一步照规则办：超时"]);
});
