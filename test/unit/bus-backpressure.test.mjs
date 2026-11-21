// 事件流的 HTTP 写缓冲堵住时，代理 res 的写回必须把背压传给接口本身，
// 否则一页长期不读，多个流会把整段输出不断堆在桥接内存里。
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";

const createBus = createRequire(import.meta.url)("../../server/bus.js");

class SlowResponse extends Writable {
  constructor() {
    super({ highWaterMark: 128 });
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
