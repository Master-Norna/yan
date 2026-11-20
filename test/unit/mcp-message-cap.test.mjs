// 桥接是单进程：MCP 服务或模型接口回一份没有上限的东西，整份攒在内存里就能把它撑死，
// 所有对话、后台指令一起断。三处出口各设一道上限，超了当场说清，不拿半份数据往下走。
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTransport, readEvents, readLimitedText } = require("../../server/mcp/transports.js");
const createModel = require("../../server/model/index.js");

const streamOf = (...chunks) => ({
  async *[Symbol.asyncIterator]() {
    for (const text of chunks) yield Buffer.from(text);
  }
});
const tick = () => new Promise(resolve => setImmediate(resolve));

test("事件流：一条事件攒过上限就作罢，不整份留在内存里", async () => {
  const got = [];
  await assert.rejects(() => readEvents({ body: streamOf("data: ", "x".repeat(4096)) }, (event, data) => got.push(data), 1024), /事件过大/);
  assert.deepEqual(got, [], "超限的这条不算数");
});

test("整份回话：按上限读，没超的原样交回", async () => {
  assert.equal(await readLimitedText({ body: streamOf("0123456789") }), "0123456789");
  await assert.rejects(() => readLimitedText({ body: streamOf("0123456789", "0123456789") }, 15), /回的消息过大/);
});

test("本机 MCP 服务往 stdout 灌一整段没有换行的文本：报过大，收掉进程", async () => {
  const transport = createTransport({
    command: process.execPath,
    args: ["-e", "process.stdout.write(Buffer.alloc(20 * 1024 * 1024, 120))"]
  });
  const closed = new Promise(resolve => (transport.onclose = resolve));
  await transport.start();
  let timer = null;
  const timeout = new Promise(resolve => (timer = setTimeout(() => resolve(null), 15000)));
  timer.unref?.();
  const error = await Promise.race([closed, timeout]);
  clearTimeout(timer);
  transport.close();
  assert.ok(error, "没有按预期收口");
  assert.match(String(error.message), /消息过大/);
});

test("可流式 HTTP 回一整份超大 JSON：不再往下读", async t => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(Buffer.alloc(20 * 1024 * 1024, 32));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const transport = createTransport({ url: `http://127.0.0.1:${server.address().port}/mcp` });
  await assert.rejects(() => transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }), /回的消息过大/);
});

// 列模型那一路（专司的设置页与「测试连接」都走它）
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

test("列模型：接口回一份超大的 JSON，当场报过大", async t => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(`{"data":[${" ".repeat(5 * 1024 * 1024)}]}`);
    });
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const model = createModel({ home: () => "test/.tmp/mcp-message-cap" });
  const res = new Res(),
    body = { profile: { baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: "m", apiKey: "k" } };
  await model.routes["POST /api/test"](Readable.from([Buffer.from(JSON.stringify(body))]), res);
  assert.equal(res.status, 400, res.text);
  assert.match(JSON.parse(res.text).error, /模型列表过大/);
});

test("列模型：正常那份照旧列出来", async t => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "m" }, { id: "n" }] }));
    });
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const model = createModel({ home: () => "test/.tmp/mcp-message-cap" });
  const res = new Res(),
    body = { profile: { baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: "m", apiKey: "k" } };
  await model.routes["POST /api/test"](Readable.from([Buffer.from(JSON.stringify(body))]), res);
  assert.equal(res.status, 200, res.text);
  assert.equal(JSON.parse(res.text).modelFound, true);
});
