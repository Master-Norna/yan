import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function fixture() {
  return load([
    "work",
    "workRunCommand",
    "workTerminalCd",
    "workTerminalRecall",
    "workTerminalCancel",
    `setup: () => {
      bootstrap.work = { platform: "win32", shell: "PowerShell 7" };
      work.root = "C:/one";
      work.open = false;
      const calls = [];
      let release;
      bridge = async (route, body) => {
        calls.push({route, body});
        if (route.endsWith("terminal-dir")) return {workdir:"C:/one/sub"};
        if (route.endsWith("/run")) return {id:"bg1", key:"unique", running:true, stdout:"first\\n"};
        if (body.stop) return {running:false, exitCode:1};
        return new Promise(resolve => { release = resolve; });
      };
      return {calls, finish: () => release({running:false, exitCode:0, stdout:"second\\n"})};
    }`
  ]);
}

test("终端增量接收输出、cd 只改自己的落脚处", async () => {
  const f = fixture(),
    { calls, finish } = f.setup();
  await f.workRunCommand('cd "sub"');
  assert.equal(f.work.terminalDir, "C:/one/sub");
  assert.equal(f.work.root, "C:/one");
  const pending = f.workRunCommand("echo test");
  await Promise.resolve();
  assert.match(f.work.terminalText, /first/);
  assert.doesNotMatch(f.work.terminalText, /second/);
  assert.equal(calls[1].body.workdir, "C:/one/sub");
  assert.equal(calls[1].body.terminal, true);
  assert.equal(calls[2].body.key, "unique");
  finish();
  await pending;
  assert.match(f.work.terminalText, /second/);
  assert.match(f.work.terminalText, /退出码：0/);
  assert.equal(f.work.command, null);
});

test("命令历史恢复未提交草稿，复合命令不冒充持久 cd", async () => {
  const f = fixture();
  f.setup();
  await f.workRunCommand("cd sub");
  const input = { value: "draft", setSelectionRange() {} };
  f.workTerminalRecall(-1, input);
  assert.equal(input.value, "cd sub");
  f.workTerminalRecall(1, input);
  assert.equal(input.value, "draft");
  assert.equal(f.workTerminalCd('cd "a b"'), "a b");
  assert.equal(f.workTerminalCd("cd .."), "..");
  assert.equal(f.workTerminalCd("cd sub; echo test"), null);
  assert.equal(f.workTerminalCd("cd $HOME"), null);
});

test("换根时取消用户终端指令，旧回报不落到新工作区", async () => {
  const f = fixture(),
    { calls, finish } = f.setup();
  const pending = f.workRunCommand("echo test");
  await Promise.resolve();
  f.workTerminalCancel();
  f.work.terminalText = "";
  finish();
  await pending;
  assert.equal(f.work.terminalText, "");
  assert.equal(f.work.command, null);
  assert.equal(calls.at(-1).body.stop, true);
  assert.equal(calls.at(-1).body.key, "unique");
});
