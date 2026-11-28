import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

// 点停止与自然退出撞上：旧写法只看「点过停止」，一律报「已停止」；现在以桥接回执里的 stopped 为准。
function fixture(part) {
  return load([
    "work",
    "workRunCommand",
    `setup: () => {
      bootstrap.work = { platform: "win32", shell: "PowerShell 7" };
      work.root = "C:/one";
      work.open = false;
      bridge = async route => {
        if (route.endsWith("/run")) return { id: "bg1", key: "unique", running: true, stdout: "first\\n" };
        workTerminalStop();
        return ${JSON.stringify(part)};
      };
      toast = () => {};
      workTerminalPaint = () => {};
      workRefresh = async () => {};
      return true;
    }`
  ]);
}

test("点过停止但进程先自己退了：报退出码，不写成已停止", async () => {
  const f = fixture({ running: false, exitCode: 0 });
  f.setup();
  await f.workRunCommand("echo done");
  assert.match(f.work.terminalText, /退出码：0/);
  assert.doesNotMatch(f.work.terminalText, /已停止/);
});

test("桥接确认停下来了：报已停止", async () => {
  const f = fixture({ running: false, exitCode: 1, stopped: true });
  f.setup();
  await f.workRunCommand("echo stop");
  assert.match(f.work.terminalText, /已停止/);
});
