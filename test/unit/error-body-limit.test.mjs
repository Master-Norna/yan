// 非成功响应同样有上限：报错只用得上开头那几句话，整份读进来没有用处——网关或中转回一份没完的正文时，
// 整份收进内存一样能把桥接撑死。读满小预算（ERROR_BODY_LIMIT）就停下、掐掉正文；完整才拿去 JSON.parse，
// 截断的只回状态码与一小段预览。不采用正文的分支（MCP 会话过期 404、生图取图非成功）显式取消正文，别让连接挂着。
// 改动前这片红在：三条入口都先 response.text() / response.json() 整份读，再截前几百字；404 与取图分支干脆不读也不收。
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable, Writable } from "node:stream";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTransport } = require("../../server/mcp/transports.js");
const { ERROR_BODY_LIMIT } = require("../../server/web.js");
const createModel = require("../../server/model/index.js");

// 一份源源不断的正文：先给 head（通常是一小段像样的报错开头），之后每块都是同一段填充。
// 被拉走几块、有没有被取消都记下来——超过预算还继续读、或者读够不掐，这里都看得出来
function runaway(head, chunk = 4 * 1024) {
  const encoder = new TextEncoder();
  let pulled = 0,
    cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(encoder.encode(pulled++ === 0 ? head : "x".repeat(chunk)));
    },
    cancel() {
      cancelled = true;
    }
  });
  return {
    body,
    get pulled() {
      return pulled;
    },
    get cancelled() {
      return cancelled;
    }
  };
}

// 一只收下整条流（source.pipe(res)）的假响应，形状同别的模型接口用例
class Res extends Writable {
  constructor() {
    super();
    this.headersSent = false;
    this.status = 0;
    this.chunks = [];
  }
  setHeader() {}
  writeHead(status) {
    this.status = status;
    this.headersSent = true;
    return this;
  }
  _write(chunk, encoding, done) {
    this.chunks.push(Buffer.from(chunk));
    done();
  }
  get text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}
const close = ({ server }) => {
  server.closeAllConnections?.();
  return new Promise(resolve => server.close(resolve));
};

test("MCP 可流式 HTTP 回 500 且正文源源不断：只读开头，错误带状态码与预览，读够就掐", async t => {
  const wire = runaway('{"error":{"message":"boom"}}');
  t.mock.method(globalThis, "fetch", async () => new Response(wire.body, { status: 500, headers: { "content-type": "application/json" } }));
  const transport = createTransport({ url: "http://127.0.0.1:1/mcp" });
  await assert.rejects(
    () => transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }),
    error => {
      assert.equal(error.status, 500);
      assert.match(error.message, /^HTTP 500：/, "状态码照旧摆在最前");
      assert.match(error.message, /boom/, "预览要带上开头那段");
      assert.match(error.message, /只读了开头/, "要说明这份正文是截断的");
      return true;
    }
  );
  assert.ok(wire.pulled <= 5, `读了 ${wire.pulled} 块，说明没在预算处停下`);
  assert.ok(wire.cancelled, "读够就要把正文掐掉，不然连接一直挂着");
  assert.ok(ERROR_BODY_LIMIT < 64 * 1024, "预算要是「几 KB」，不能宽到能把大块整份收进来");
});

test("MCP 会话过期的 404：正文不采用，当场取消，不挂着连接", async t => {
  const wire = runaway('{"error":"expired"}');
  t.mock.method(globalThis, "fetch", async () => new Response(wire.body, { status: 404, headers: { "mcp-session-id": "s1" } }));
  const transport = createTransport({ url: "http://127.0.0.1:1/mcp" });
  const closed = [];
  transport.onclose = error => closed.push(error.message);
  await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} });
  assert.deepEqual(closed, ["会话已过期"]);
  assert.ok(wire.cancelled, "这份正文没人要，要显式取消");
});

test("列模型：接口回 500 且正文源源不断，只读开头就停下，错误仍读得懂", async t => {
  const wire = runaway('{"error":{"message":"boom"}}');
  t.mock.method(globalThis, "fetch", async () => new Response(wire.body, { status: 500, headers: { "content-type": "application/json" } }));
  const model = createModel({ home: () => "test/.tmp/error-body-limit" });
  const res = new Res();
  await model.routes["POST /api/test"](
    Readable.from([Buffer.from(JSON.stringify({ profile: { baseUrl: "http://relay.test/v1", model: "m", apiKey: "k" } }))]),
    res
  );
  assert.equal(res.status, 400, res.text);
  const message = JSON.parse(res.text).error;
  assert.match(message, /上游接口返回 500/);
  assert.match(message, /只读了开头/);
  assert.match(message, /boom/);
  assert.ok(wire.pulled <= 5, `读了 ${wire.pulled} 块，说明没在预算处停下`);
  assert.ok(wire.cancelled, "读够就要把正文掐掉");
});

test("列模型：完整的小段报错照旧解析出那句话，文案形状不变", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 500 }));
  const model = createModel({ home: () => "test/.tmp/error-body-limit" });
  const res = new Res();
  await model.routes["POST /api/test"](
    Readable.from([Buffer.from(JSON.stringify({ profile: { baseUrl: "http://relay.test/v1", model: "m", apiKey: "k" } }))]),
    res
  );
  assert.equal(res.status, 400, res.text);
  assert.equal(JSON.parse(res.text).error, "bad key");
});

test("订阅列模型：500 且正文源源不断，只读开头就停下", async t => {
  const home = mkdtempSync(path.join(tmpdir(), "yan-error-body-"));
  writeFileSync(
    path.join(home, "ChatGPT 登录.json"),
    JSON.stringify({ tokens: { access_token: "test-access", refresh_token: "test-refresh", expires_at: Date.now() + 3600e3 } })
  );
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const wire = runaway('{"error":{"code":"server_error","message":"boom"}}');
  t.mock.method(globalThis, "fetch", async () => new Response(wire.body, { status: 500, headers: { "content-type": "application/json" } }));
  const model = createModel({ home: () => home });
  const res = new Res();
  await model.routes["POST /api/models"](Readable.from([Buffer.from(JSON.stringify({ profile: { api: "chatgpt" } }))]), res);
  assert.equal(res.status, 400, res.text);
  const message = JSON.parse(res.text).error;
  assert.match(message, /列模型失败（500）/);
  assert.match(message, /boom/);
  assert.ok(wire.pulled <= 5, `读了 ${wire.pulled} 块，说明没在预算处停下`);
  assert.ok(wire.cancelled, "读够就要把正文掐掉");
});

test("生图取图回 500：不采用正文也当场取消，不把连接挂着", async () => {
  let written = 0,
    closed = false,
    timer;
  const image = await listen((req, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.on("error", () => {});
    // 不主动收尾：客户端不取消的话，这条连接会一直挂着（写的量停在背压处）
    timer = setInterval(() => {
      if (res.destroyed || res.writableEnded) return clearInterval(timer);
      if (res.write("x".repeat(16 * 1024))) written += 16 * 1024;
    }, 5);
    res.on("close", () => {
      closed = true;
      clearInterval(timer);
    });
  });
  const upstream = await listen((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${image.port}/cat.png` }] }));
    });
  });
  try {
    const model = createModel({ home: () => "test/.tmp/error-body-limit" });
    const res = new Res();
    const body = { profile: { baseUrl: `http://127.0.0.1:${upstream.port}/v1`, model: "img-x", apiKey: "k" }, prompt: "画一只猫" };
    await model.routes["POST /api/image"](Readable.from([Buffer.from(JSON.stringify(body))]), res);
    assert.equal(res.status, 400, res.text);
    assert.match(JSON.parse(res.text).error, /取图失败：500/);
    for (let i = 0; i < 100 && !closed; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(closed, "取图失败时要把正文取消，客户端那头应断开");
    assert.ok(written < 64 * 1024 * 1024, "不该把一份没完的正文整份收下来");
  } finally {
    clearInterval(timer);
    await close(image);
    await close(upstream);
  }
});
