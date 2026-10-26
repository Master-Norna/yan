import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createBus = require("../../server/bus.js");

class Response extends EventEmitter {
  writableEnded = false;
  writeHead(status, headers) {
    this.statusCode = status;
    this.headers = headers;
    return this;
  }
  write() {
    return true;
  }
  end(body) {
    this.body = body;
    this.writableEnded = true;
    this.emit("close");
    return this;
  }
}

function request(url, body = null) {
  const req = body === null ? new Readable({ read() {} }) : Readable.from([Buffer.from(JSON.stringify(body))]);
  req.url = url;
  req.headers = { "user-agent": "bus-test" };
  return req;
}

test("迟到的 pagehide 清理只关闭它登记的事件流，不会误关重连的新流", async () => {
  const bus = createBus({ dispatch() {} }).routes;
  const page = "page-00000001";
  const old = new Response();
  const current = new Response();
  try {
    bus["GET /api/bus"](request(`/api/bus?page=${page}&stream=stream-old-0001`), old);
    assert.equal(old.writableEnded, false);

    bus["GET /api/bus"](request(`/api/bus?page=${page}&stream=stream-new-0002`), current);
    assert.equal(old.writableEnded, true);
    assert.equal(current.writableEnded, false);

    await bus["POST /api/bus/close"](request("/api/bus/close", { page, stream: "stream-old-0001" }), new Response());
    assert.equal(current.writableEnded, false);

    await bus["POST /api/bus/close"](request("/api/bus/close", { page, stream: "stream-new-0002" }), new Response());
    assert.equal(current.writableEnded, true);
  } finally {
    if (!current.writableEnded) current.end();
    if (!old.writableEnded) old.end();
  }
});
