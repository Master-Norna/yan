import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("文件目录合并为一次桥接，测试去重并限制并发", async () => {
  const f = load([
    "anchorPrints",
    `setup: request => {
      bridge = request;
      workScope = () => ({ workdir: "test" });
      commandPolicyOf = () => "auto";
    }`
  ]);
  let disk = 0,
    active = 0,
    peak = 0;
  const commands = [];
  f.setup(async (url, body) => {
    if (url === "/api/work/prints") {
      disk++;
      assert.deepEqual(body.paths, ["a"]);
      assert.deepEqual(body.dirs, ["."]);
      return { prints: { a: "hash" }, dirs: { ".": "tree" } };
    }
    assert.equal(url, "/api/work/run");
    commands.push(body.command);
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { exitCode: 0 };
  });
  const prints = await f.anchorPrints({}, ["file:a", "file:a", "dir:.", "test:a", "test:a", "test:b", "test:c", "test:d"]);
  assert.equal(disk, 1);
  assert.equal(peak, 2);
  assert.deepEqual(commands, ["a", "b", "c", "d"]);
  assert.deepEqual(prints, {
    "file:a": "hash",
    "dir:.": "tree",
    "test:a": "过",
    "test:b": "过",
    "test:c": "过",
    "test:d": "过"
  });
});
