import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("换根统一重置列表、改动与旧请求", () => {
  const { work, workSetRoot } = load(["work", "workSetRoot"]);
  work.root = "C:/old";
  work.mode = "changes";
  work.entries = [{ path: "old" }];
  work.dirs = [{ path: "dir" }];
  work.changeEntries.set("old", {});
  work.changeFiles = [{ path: "old" }];
  work.full = work.truncated = true;
  work.error = "old";
  const rev = work.rev;
  workSetRoot("C:/new/");
  assert.equal(work.root, "C:/new");
  assert.equal(work.mode, "list");
  assert.equal(work.rev, rev + 1);
  assert.deepEqual(work.entries, []);
  assert.deepEqual(work.dirs, []);
  assert.equal(work.changeEntries.size, 0);
  assert.deepEqual(work.changeFiles, []);
  assert.equal(work.full, false);
  assert.equal(work.truncated, false);
  assert.equal(work.error, "");
});
