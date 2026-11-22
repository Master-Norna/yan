import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const createShell = createRequire(import.meta.url)("../../server/work/shell.js");

test("仓库配置的 Git fsmonitor 不能在言的 Shell 内生效", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-git-fsmonitor-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "core.fsmonitor", "echo should-not-run"], { cwd: dir });
  const shell = createShell({ toolEnv: env => env });
  const result = await shell.runShell("git config --get core.fsmonitor", dir, 5000);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), "false", "Git 环境层覆盖不可信的仓库级 fsmonitor 配置");
});
