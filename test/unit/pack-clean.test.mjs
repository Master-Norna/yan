import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertCleanWorkingTree } from "../../pack/clean.mjs";

test("正式便携包只允许干净工作区", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-pack-clean-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  fs.writeFileSync(path.join(dir, "tracked.txt"), "a");
  git("add", "tracked.txt");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial");
  assert.doesNotThrow(() => assertCleanWorkingTree(dir));
  fs.writeFileSync(path.join(dir, "tracked.txt"), "changed");
  assert.throws(() => assertCleanWorkingTree(dir), /拒绝生成/);
  git("checkout", "--", "tracked.txt");
  fs.writeFileSync(path.join(dir, "untracked.txt"), "new");
  assert.throws(() => assertCleanWorkingTree(dir), /拒绝生成/);
});
