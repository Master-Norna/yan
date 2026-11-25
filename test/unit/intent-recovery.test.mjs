import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("一类凭据读取失败不丢掉另一类成功读数", async () => {
  const f = load([
    "anchorPrints",
    "ANCHOR_KINDS",
    `setup: () => {
      workScope = () => ({});
      bridge = async () => { throw Error("temporary"); };
    }`
  ]);
  f.setup();
  f.ANCHOR_KINDS.set("probe", { read: async () => ({ x: "ok" }), cadence: "answer" });
  const prints = await f.anchorPrints({}, ["file:a", "probe:x"], new AbortController().signal);
  assert.deepEqual(prints, { "probe:x": "ok" });
});

test("开工读取失败之后，副作用前仍重新读取图", async () => {
  const f = load([
    "loadIntent",
    "keepHook",
    "intents",
    `setup: request => {
      isWork = () => true;
      workScope = () => ({});
      bridge = request;
    }`
  ]);
  let reads = 0;
  f.setup(async () => {
    reads++;
    throw Error("temporary");
  });
  const conversation = { id: "c" };
  await f.loadIntent(conversation);
  assert.equal(f.intents.has("c"), false);
  const result = await f.keepHook({ name: "write_file" }, { path: "x" }, { conversation, signal: new AbortController().signal });
  assert.equal(reads, 2);
  assert.equal(result, null);
});
