import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../server/platform.js", import.meta.url), "utf8");
// 按给定的平台载入 platform.js，spawn 与 process.kill 换成记账的假货
function load(platform, { noGroup = false } = {}) {
  const calls = { spawn: [], kill: [] };
  const killer = {
    once(event, handler) {
      if (event === "error") this.onError = handler;
      if (event === "close") this.onClose = handler;
      return this;
    },
    unref() {
      this.detached = true;
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    setTimeout: () => 0,
    clearTimeout: () => {},
    process: {
      platform,
      env: {},
      kill: (...args) => {
        calls.kill.push(args);
        if (noGroup) throw Object.assign(Error("kill ESRCH"), { code: "ESRCH" });
      }
    },
    require(name) {
      if (name === "node:child_process") return { spawn: (...args) => (calls.spawn.push(args), killer), spawnSync() {} };
      return require(name);
    }
  });
  return { platform: module.exports, calls, killer };
}
const fakeChild = () => {
  const child = { pid: 1234, exitCode: null, signalCode: null, signals: [], kill: signal => child.signals.push(signal) };
  return child;
};

test("Windows 收进程树走异步的 taskkill，不攥着桥接；taskkill 不成退回直接杀", () => {
  const { platform, calls, killer } = load("win32");
  const child = fakeChild();
  platform.killTree(child);
  assert.equal(calls.spawn.length, 1);
  assert.equal(calls.spawn[0][0], "taskkill");
  assert.deepEqual(Array.from(calls.spawn[0][1]), ["/T", "/F", "/PID", "1234"]);
  assert.equal(killer.detached, true);
  assert.deepEqual(child.signals, []);
  killer.onError();
  assert.deepEqual(child.signals, ["SIGKILL"]);
  child.signals.length = 0;
  killer.onClose(1);
  assert.deepEqual(child.signals, ["SIGKILL"]);
});

test("macOS 按进程组收；组不在时退回只杀它本身", () => {
  const { platform, calls } = load("darwin");
  assert.deepEqual({ ...platform.OWN_GROUP }, { detached: true });
  const child = fakeChild();
  platform.killTree(child, "SIGTERM");
  assert.deepEqual(calls.kill, [[-1234, "SIGTERM"]]);
  assert.equal(calls.spawn.length, 0);
  assert.deepEqual(child.signals, []);
  const lone = fakeChild();
  load("darwin", { noGroup: true }).platform.killTree(lone);
  assert.deepEqual(lone.signals, ["SIGKILL"]);
});

test("已退出的不再去收", () => {
  const { platform, calls } = load("darwin");
  platform.killTree({ ...fakeChild(), exitCode: 0 });
  assert.equal(calls.kill.length, 0);
});

test("下载测速：Windows 与 macOS 都选对 curl 与空设备", () => {
  assert.deepEqual({ ...load("win32").platform.curlProbe() }, { command: "curl.exe", output: "NUL" });
  assert.deepEqual({ ...load("darwin").platform.curlProbe() }, { command: "/usr/bin/curl", output: "/dev/null" });
});
