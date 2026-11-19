// 起真实桥接，环境作业的慢步骤由测试放行；不联网、不启动 uv 或 Python。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const cp = require("node:child_process");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

let pending;
function hold(kind) {
  assert.equal(pending, undefined, "不应同时启动两项环境作业");
  return new Promise((resolve, reject) => {
    pending = { kind, resolve, reject };
    process.send({ kind });
  });
}
process.on("message", ({ kind, fail }) => {
  assert.equal(pending?.kind, kind);
  const { resolve, reject } = pending;
  pending = undefined;
  if (fail) reject(Error("替身作业失败"));
  else resolve("official");
});

const mirror = require("../../server/mirror.js");
mirror.pickSource = () => hold("prepare");
const rm = fs.promises.rm;
fs.promises.rm = async (target, options) => {
  if (path.basename(target) === "环境") await hold("clear");
  return rm(target, options);
};
const { spawn, execFileSync } = cp;
cp.spawn = command => {
  assert.equal(path.basename(command), "uv.exe");
  assert.ok(fs.existsSync(command));
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  queueMicrotask(() => {
    child.stdout.end(`替身 uv: ${command}\n`);
    child.stderr.end();
    child.emit("close", 0);
  });
  return child;
};
cp.execFileSync = (command, args) => {
  assert.equal(path.basename(command), "python.exe");
  assert.deepEqual(args, ["--version"]);
  assert.ok(fs.existsSync(command));
  return "Python 3.12.0 (替身)\n";
};
require("../../server/env/index.js"); // 只让环境模块拿到替身
Object.assign(cp, { spawn, execFileSync });
globalThis.fetch = () => {
  throw Error("环境作业测试不访问网络");
};

const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once("listening", () => process.send({ kind: "listen", port: this.address().port }));
  return listen.apply(this, args);
};
require("../../server.js");
// 只让此隔离进程的环境路由走 Windows 准备分支；桥接其余模块已按宿主加载。
Object.defineProperty(process, "platform", { value: "win32" });
