// 事件流的 HTTP 写缓冲堵住时，代理 res 的写回必须把背压传给接口本身，
// 否则一页长期不读，多个流会把整段输出不断堆在桥接内存里。
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";

const createBus = createRequire(import.meta.url)("../../server/bus.js");

class SlowResponse extends Writable {
  constructor(highWaterMark = 128) {
    super({ highWaterMark });
    this.headersSent = false;
    this.statusCode = 200;
    this.chunks = [];
    this.maxBuffered = 0;
  }
  writeHead(status) {
    this.statusCode = status;
    this.headersSent = true;
    return this;
  }
  write(chunk, encoding, done) {
    const ok = super.write(chunk, encoding, done);
    this.maxBuffered = Math.max(this.maxBuffered, this.writableLength);
    return ok;
  }
  _write(chunk, _encoding, callback) {
    this.chunks.push(String(chunk));
    setTimeout(callback, 3);
  }
}

// 一直不读的页面连接：写缓冲始终满着，用来验证取消作业后等待与监听都被收掉
class StalledResponse extends Writable {
  constructor() {
    super({ highWaterMark: 1 });
    this.headersSent = false;
    this.statusCode = 200;
    this.pending = null;
  }
  writeHead(status) {
    this.statusCode = status;
    this.headersSent = true;
    return this;
  }
  _write(_chunk, _encoding, callback) {
    this.pending = callback;
  }
  _destroy(error, callback) {
    // 销毁时把未完成的写回调放掉，测试进程才能收尾
    const pending = this.pending;
    this.pending = null;
    if (pending) pending();
    callback(error);
  }
}

test("总线：SSE 写不动时向内层转交背压，全部事件仍按顺序抵达", async () => {
  const bus = createBus({
    dispatch: async (_req, res) => {
      for (let i = 0; i < 32; i++) {
        if (!res.write(String(i).padStart(3, "0") + ".".repeat(80))) await once(res, "drain");
      }
      res.end();
    }
  });
  const sse = new SlowResponse();
  const get = Object.assign(Readable.from([]), { url: "/api/bus?page=abcdefgh123456", headers: { "user-agent": "test" } });
  bus.routes["GET /api/bus"](get, sse);
  const body = { page: "abcdefgh123456", id: "one", path: "/api/mock", body: "{}" };
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { "user-agent": "test" };
  const ack = new SlowResponse();
  await bus.routes["POST /api/bus/send"](req, ack);
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(Error("事件流没有完成")), 3000);
    const poll = () => {
      if (sse.chunks.join("").includes('"t":"end"')) {
        clearTimeout(deadline);
        resolve();
      } else setTimeout(poll, 15);
    };
    poll();
  });
  const events = sse.chunks
    .join("")
    .split("\n\n")
    .filter(s => s.startsWith("data: "))
    .map(s => JSON.parse(s.slice(6)));
  assert.equal(events.filter(e => e.t === "data").length, 32);
  assert.equal(events.at(-1).t, "end");
  assert.ok(sse.maxBuffered < 2000, "慢 SSE 端不应随整份回复无上限积累");
  sse.destroy();
});

test("总线：只写响应头时 SSE 遇背压断开，不留下未处理的 Promise rejection", async () => {
  let job;
  const bus = createBus({
    dispatch: (_req, res) => {
      job = res;
      res.writeHead(201, { "X-Test": "header-only" });
    }
  });
  // 开流的注释已经占满高水位；随后 head 事件等待 drain 时主动断开。
  const sse = new SlowResponse(1);
  const get = Object.assign(Readable.from([]), { url: "/api/bus?page=headeronly123", headers: { "user-agent": "header-test" } });
  bus.routes["GET /api/bus"](get, sse);
  const body = { page: "headeronly123", id: "head", path: "/api/mock", body: "{}" };
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { "user-agent": "header-test" };
  await bus.routes["POST /api/bus/send"](req, new SlowResponse());
  assert.equal(job.headersSent, true);
  sse.destroy();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(job.destroyed, true, "页面断线应取消未完成的代理响应");
});

test("总线：显式 writeHead 的事件先于数据和结束事件", async () => {
  const bus = createBus({
    dispatch: (_req, res) => {
      res.writeHead(202, { "X-Test": "ordered" });
      res.write("data");
      res.end("tail");
    }
  });
  const sse = new SlowResponse(1);
  const get = Object.assign(Readable.from([]), { url: "/api/bus?page=orderedhead123", headers: { "user-agent": "order-test" } });
  bus.routes["GET /api/bus"](get, sse);
  const body = { page: "orderedhead123", id: "ordered", path: "/api/mock", body: "{}" };
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { "user-agent": "order-test" };
  await bus.routes["POST /api/bus/send"](req, new SlowResponse());
  const events = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(Error("等待 end 超时")), 3000);
    const check = () => {
      const result = sse.chunks
        .join("")
        .split("\n\n")
        .filter(part => part.startsWith("data: "))
        .map(part => JSON.parse(part.slice(6)));
      if (result.some(item => item.t === "end")) {
        clearTimeout(deadline);
        resolve(result);
      } else setTimeout(check, 10);
    };
    check();
  });
  assert.deepEqual(
    events.map(item => item.t),
    ["head", "data", "data", "end"]
  );
  assert.equal(events[0].status, 202);
  assert.deepEqual(
    events.slice(1, 3).map(item => item.text),
    ["data", "tail"]
  );
  sse.destroy();
});

test("总线：取消背压中的作业会收掉等待，不在页面上留监听", async t => {
  const jobs = [];
  const bus = createBus({
    dispatch: (_req, res) => {
      jobs.push(res);
      res.writeHead(200, { "X-Test": "stalled" });
    }
  });
  const page = "stalledpage123";
  const sse = new StalledResponse();
  // 断言失败时也要把卡住的这条流收掉，否则测试进程退不出去
  t.after(() => sse.destroy());
  const get = Object.assign(Readable.from([]), { url: `/api/bus?page=${page}`, headers: { "user-agent": "stalled-test" } });
  bus.routes["GET /api/bus"](get, sse);
  const post = async (path, body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.headers = { "user-agent": "stalled-test" };
    await bus.routes[path](req, new SlowResponse());
  };
  for (let i = 0; i < 5; i++) await post("POST /api/bus/send", { page, id: `stalled-${i}`, path: "/api/mock", body: "{}" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.length, 5);
  // 五个只写响应头的作业都在等同一条堵住的流
  assert.equal(sse.listenerCount("drain"), 5);
  assert.equal(sse.listenerCount("error"), 5);
  for (let i = 0; i < 5; i++) await post("POST /api/bus/cancel", { page, id: `stalled-${i}` });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(
    jobs.every(job => job.destroyed),
    "取消后代理响应都应销毁"
  );
  // 取消（或整页断开）时把这次的等待结掉：已销毁的作业不能继续挂在页面连接上
  assert.equal(sse.listenerCount("drain"), 0, "取消后不应再把 drain 监听留在页面连接上");
  assert.equal(sse.listenerCount("error"), 0, "取消后不应再把 error 监听留在页面连接上");
  assert.equal(sse.listenerCount("close"), 1, "只剩开页时注册的那条 close 监听");
  sse.destroy();
});

test("总线：同一请求标识不能覆盖仍在途的作业", async t => {
  const jobs = [];
  const bus = createBus({ dispatch: (_req, res) => jobs.push(res) });
  const page = "duplicate1234";
  const sse = new SlowResponse();
  t.after(() => sse.destroy());
  const get = Object.assign(Readable.from([]), { url: `/api/bus?page=${page}`, headers: { "user-agent": "duplicate" } });
  bus.routes["GET /api/bus"](get, sse);
  const send = async () => {
    const req = Readable.from([Buffer.from(JSON.stringify({ page, id: "one", path: "/api/mock", body: "{}" }))]);
    req.headers = { "user-agent": "duplicate" };
    const ack = new SlowResponse();
    await bus.routes["POST /api/bus/send"](req, ack);
    return ack.statusCode;
  };
  assert.equal(await send(), 202);
  assert.equal(await send(), 409);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].destroyed, false);
});

test("总线：先取消后登记的请求不得进入分发", async t => {
  let dispatched = 0;
  const bus = createBus({ dispatch: () => dispatched++ });
  const page = "earlycancel123";
  const sse = new SlowResponse();
  t.after(() => sse.destroy());
  bus.routes["GET /api/bus"](Object.assign(Readable.from([]), { url: `/api/bus?page=${page}`, headers: {} }), sse);
  const post = async (route, body) => {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: {} });
    const ack = new SlowResponse();
    await bus.routes[route](req, ack);
    return ack.statusCode;
  };
  await post("POST /api/bus/cancel", { page, id: "early" });
  assert.equal(await post("POST /api/bus/send", { page, id: "early", path: "/api/mock", body: "{}" }), 410);
  assert.equal(dispatched, 0);
});
