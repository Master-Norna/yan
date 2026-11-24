import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { intentEvaluator, intentEstablished, intentTally } = load(["intentEvaluator", "intentEstablished", "intentTally"]);
const node = (needs = [], extra = {}) => ({ state: "done", rev: 1, needs, anchors: [], ...extra });

test("共享前提在一次图求值中只判断一次，下一次指纹快照不沿用", () => {
  let reads = 0;
  const leaf = node();
  Object.defineProperty(leaf, "seal", {
    get() {
      reads++;
      return { rev: 1, premises: {}, prints: { "file:x": "old" } };
    }
  });
  const nodes = { leaf };
  let previous = ["leaf"];
  for (let i = 0; i < 8; i++) {
    const pair = ["a" + i, "b" + i];
    for (const id of pair) nodes[id] = node(previous);
    previous = pair;
  }
  const intent = { nodes };
  assert.deepEqual(intentTally(intent, { "file:x": "old" }, new Set()), { live: 17, standing: 17 });
  assert.equal(reads, 1);
  assert.equal(intentEstablished(intent, "a7", { "file:x": "new" }), false);
  assert.equal(reads, 2);
});

test("手编的环不把依赖当前递归路径的失败缓存给另一个根", () => {
  const intent = { nodes: { a: node(["b", "c"], { any: true }), b: node(["a"]), c: node() } };
  const holds = intentEvaluator(intent);
  assert.equal(holds("a"), true);
  assert.equal(holds("b"), true);
});
