// 桥接是单进程：MCP 服务或模型接口回一份没有上限的东西，整份攒在内存里就能把它撑死，
// 所有对话、后台指令一起断。三处出口各设一道上限，超了当场说清，不拿半份数据往下走。
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough, Readable, Writable } from "node:stream";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { createTransport, readEvents, readLimitedText } = require("../../server/mcp/transports.js");
const createModel = require("../../server/model/index.js");

// 真的 ReadableStream（桥接里收到的回话都是这个形状）：readLimitedBytes 与 readEvents 都按它读、按块交
const streamOf = (...chunks) =>
  new ReadableStream({
    start(controller) {
      for (const text of chunks) controller.enqueue(Buffer.from(text));
      controller.close();
    }
  });
test("事件流：按解码后的单条计量，不因合块或拆开空行误拒", async () => {
  // 正好 9 个 UTF-16 码元，但 UTF-8 字节更多；末尾空行不计入事件体量。
  for (const chunks of [["data: 甲😀\n\ndata: b\n\n"], ["data: 甲😀\n", "\ndata: b\n\n"], ["data: 甲😀\r", "\n\r\ndata: b\r\r"]]) {
    const got = [];
    await readEvents({ body: streamOf(...chunks) }, (event, data) => got.push(data), 9);
    assert.deepEqual(got, ["甲😀", "b"]);
  }
});

test("事件流：完整事件和未结束余段都限量，已读出的合法事件不丢", async () => {
  for (const chunks of [
    ["data: a\n\ndata: 1234\n\ndata: b\n\n"],
    ["data: a\n\ndata: 12", "34"],
    ["data: a\n\ndata: 123\n", "x\n\n"],
    ["data: a\n\ndata: 1234\r\r"]
  ]) {
    const got = [];
    await assert.rejects(() => readEvents({ body: streamOf(...chunks) }, (event, data) => got.push(data), 9), /事件过大/);
    assert.deepEqual(got, ["a"]);
  }
});

test("整份回话：按字节限量，没超的原样交回", async () => {
  assert.equal(await readLimitedText({ body: streamOf("0", "甲") }, 4), "0甲");
  await assert.rejects(() => readLimitedText({ body: streamOf("0", "甲") }, 3), /回的消息过大/);
});

// 用假进程给真实的 stdout 处理器喂确定的块，不依赖 OS 管道如何合块。
async function fakeStdio(limit) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const got = [],
    errors = [],
    kills = [],
    module = { exports: {} },
    // transports.js 里成对的 require 按它自己所在的位置解析（它现在已经引 ../web.js）
    requireTransport = createRequire(new URL("../../server/mcp/transports.js", import.meta.url));
  vm.runInNewContext(readFileSync(new URL("../../server/mcp/transports.js", import.meta.url), "utf8"), {
    module,
    process,
    require(name) {
      if (name === "node:child_process") return { spawn: () => child };
      if (name === "../platform.js") return { OWN_GROUP: {}, killTree: (...args) => kills.push(args) };
      return requireTransport(name);
    }
  });
  const transport = module.exports.createTransport({ command: process.execPath });
  transport.onmessage = message => got.push(message.id);
  transport.onclose = error => errors.push(error.message);
  const started = transport.start(limit);
  child.emit("spawn");
  await started;
  return { child, got, errors, kills };
}

test("stdio：合在一个块里的行各量各的，余段接到下一块", async () => {
  const { child, got, errors, kills } = await fakeStdio(11);
  child.stdout.write('{"id":"😀"}\n{"id":2}\n{"id":');
  child.stdout.write("3}\n");
  assert.deepEqual(got, ["😀", 2, 3]);
  assert.deepEqual(errors, []);
  assert.deepEqual(kills, []);
});

test("stdio：完整行和未结束余段都限量，超限报错并收进程", async () => {
  for (const chunks of [['{"id":1}\n {"id":2}\n{"id":3}\n'], ['{"id":1}\n {"id":2', "}"]]) {
    const { child, got, errors, kills } = await fakeStdio(8);
    for (const chunk of chunks) child.stdout.write(chunk);
    assert.equal(errors.length, 1, "不能等到看到换行才检查余段");
    assert.match(errors[0], /服务回的消息过大（一行超过/);
    child.stdout.write('{"id":4}\n');
    assert.deepEqual(got, [1]);
    assert.equal(errors.length, 1);
    assert.deepEqual(kills, [[child, "SIGTERM"]]);
  }
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

test("可流式 HTTP 回一整份普通 JSON：不超上限的照常交出", async t => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const transport = createTransport({ url: `http://127.0.0.1:${server.address().port}/mcp` });
  const got = [];
  transport.onmessage = message => got.push(message);
  await transport.send({ jsonrpc: "2.0", id: 1, method: "ping" });
  assert.deepEqual(got, [{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
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
