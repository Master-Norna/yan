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
