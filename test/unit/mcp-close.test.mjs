import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../server/mcp/transports.js", import.meta.url), "utf8");

test("Windows MCP 关闭进程时不会同步等待 taskkill", () => {
  const calls = [];
  const killer = {
    on(event, handler) {
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
    process: { platform: "win32" },
    require(name) {
      if (name === "node:child_process") return { spawn: (...args) => (calls.push(args), killer) };
      return require(name);
    }
  });
  const transport = module.exports.createTransport({ command: "fake" });
  let ended = false;
  let fallback = false;
  transport.child = {
    pid: 1234,
    exitCode: null,
    stdin: { end: () => (ended = true) },
    kill: () => (fallback = true)
  };
  transport.close();
  assert.equal(ended, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "taskkill");
  assert.deepEqual(Array.from(calls[0][1]), ["/PID", "1234", "/T", "/F"]);
  assert.equal(killer.detached, true);
  assert.equal(fallback, false);
  killer.onError();
  assert.equal(fallback, true);
  fallback = false;
  killer.onClose(1);
  assert.equal(fallback, true);
});
