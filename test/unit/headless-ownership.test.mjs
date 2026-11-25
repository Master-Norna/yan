import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../server/headless.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

// 不起浏览器、不连网络：把三个交接点（stderr、CDP 回复、子进程退出）交给用例推进。
function fixture() {
  const process = new EventEmitter(),
    children = [],
    sockets = [],
    timers = new Set(),
    exitTargets = [],
    module = { exports: {} };
  class Socket extends EventEmitter {
    readyState = 1;
    methods = [];
    constructor() {
      super();
      sockets.push(this);
      queueMicrotask(() => this.onopen());
    }
    addEventListener(type, handler) {
      this.on(type, handler);
    }
    send(text) {
      const { id, method } = JSON.parse(text);
      this.methods.push(method);
      if (method === "Browser.getVersion") this.versionId = id;
      // 页签请求到了就够了：让 render 收尾，不用模拟整页导航。
      if (method === "Target.createTarget") this.reply({ id, error: { message: "到达页签请求" } });
    }
    reply(message) {
      this.onmessage({ data: JSON.stringify(message) });
    }
    close() {
      this.readyState = 3;
      this.onclose();
      this.emit("close");
    }
  }
  const deps = {
    "node:fs": {
      existsSync: () => true,
      mkdirSync() {},
      readFileSync() {
        throw Error("没有上回留下的端口文件");
      }
    },
    "node:path": { join: (...pieces) => pieces.join("/") },
    "node:child_process": {
      spawn() {
        const child = Object.assign(new EventEmitter(), { pid: 100 + children.length, stderr: new EventEmitter() });
        children.push(child);
        return child;
      }
    },
    "./platform.js": {
      browserFiles: () => ({ msedge: ["stub-browser"], chrome: [] }),
      killTree() {},
      killTreeSync(child) {
        if (child) exitTargets.push(child.pid);
      }
    },
    "./headless-proxy.js": () => ({ url: "stub-proxy", close() {} })
  };
  runInNewContext(source, {
    module,
    require: name => deps[name],
    process,
    WebSocket: Socket,
    setTimeout(fn, delay) {
      const timer = { fn, delay };
      timers.add(timer);
      return timer;
    },
    clearTimeout: timer => timers.delete(timer)
  });
  const { configure, render } = module.exports;
  configure({ home: () => "stub-profile" });
  return {
    children,
    sockets,
    render: () => assert.rejects(render("https://example.invalid/"), /到达页签请求/),
    async endpoint(child) {
      child.stderr.emit("data", "DevTools listening on ws://stub/browser\n");
      await tick();
    },
    version(socket) {
      assert.ok(socket.versionId);
      socket.reply({ id: socket.versionId, result: { userAgent: "HeadlessChrome" } });
    },
    idle() {
      const timer = [...timers].find(timer => timer.delay === 180000);
      assert.ok(timer, "空闲时应预约关闭");
      timers.delete(timer);
      timer.fn();
    },
    // 只记录退出钩子交给收树函数的 PID，不发任何进程信号。
    exitTargets() {
      process.emit("exit");
      return exitTargets.splice(0);
    }
  };
}

for (const phase of ["调试口尚未出现", "UA 请求等回复"]) {
  test(`退出时收掉尚未交给页签的无头浏览器：${phase}`, async () => {
    const f = fixture();
    const rendered = f.render();
    await tick();
    const [child] = f.children;
    assert.ok(child);
    if (phase === "UA 请求等回复") {
      await f.endpoint(child);
      assert.deepEqual(f.sockets[0].methods, ["Browser.getVersion"]);
    }
    const killed = f.exitTargets();
    if (!f.sockets.length) await f.endpoint(child);
    f.version(f.sockets[0]);
    await rendered;
    assert.deepEqual(killed, [child.pid]);
  });
}

test("关旧开新时两棵树都归桥接；旧实例退完不影响新实例", async () => {
  const f = fixture();
  const first = f.render();
  await tick();
  const [old] = f.children;
  await f.endpoint(old);
  f.version(f.sockets[0]);
  await first;
  f.idle();
  assert.equal(f.sockets[0].methods.at(-1), "Browser.close");

  const second = f.render();
  await tick();
  const next = f.children[1];
  assert.ok(next, "旧实例未退出时已开始启动新实例");
  await f.endpoint(next);
  f.version(f.sockets[1]);
  await second;
  const duringHandoff = f.exitTargets();
  f.sockets[0].close();
  const afterDisconnect = f.exitTargets();
  old.emit("exit", 0);

  await f.render();
  assert.equal(f.children.length, 2, "旧连接关闭不应丢掉仍可用的新连接");
  assert.deepEqual(duringHandoff, [old.pid, next.pid]);
  assert.deepEqual(afterDisconnect, [old.pid, next.pid], "断开调试口不等于旧进程退出");
  assert.deepEqual(f.exitTargets(), [next.pid]);
});
