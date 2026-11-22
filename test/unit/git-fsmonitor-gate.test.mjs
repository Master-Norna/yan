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


test("保留原有 GIT_CONFIG 环境项并在最后覆盖 fsmonitor", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-git-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const shell = createShell({ toolEnv: env => env });
  const env = {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_VALUE_0: "Yan Test",
    GIT_CONFIG_KEY_1: "core.fsmonitor",
    GIT_CONFIG_VALUE_1: "echo malicious"
  };
  const name = await shell.runShell("git config --get user.name", dir, 5000, null, { env });
  assert.equal(name.exitCode, 0, name.stderr);
  assert.equal(name.stdout.trim(), "Yan Test", "用户环境注入的其它 Git 配置必须保留");
  const monitor = await shell.runShell("git config --get core.fsmonitor", dir, 5000, null, { env });
  assert.equal(monitor.exitCode, 0, monitor.stderr);
  assert.equal(monitor.stdout.trim(), "false", "安全覆写必须排在原有配置之后");
});
