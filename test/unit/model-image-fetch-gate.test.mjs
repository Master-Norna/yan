// 生图取图（server/model/image.js 的 fetchImage）与其它公网请求走同一条路：地址门禁、逐跳复检、带出站标记。
// 中转交回的网址可以是本机或内网——裸 fetch 就等于让桥接替它去取，桥接的受信接口对无标记的本机请求
// 是放行的（见 server.js 的门禁）。改动前本文件是红的：秘密接口收到请求、它的内容被当成 png 交回。
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createModel = require("../../server/model/index.js");

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

test("中转交回的本机地址，生图取图不再替它去取", async () => {
  let secretHits = 0;
  const secret = await listen((req, res) => {
    secretHits += 1;
    res.setHeader("content-type", "application/json");
    res.end('{"secret":"卷宗里的私事"}');
  });
  const upstream = await listen((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${secret.port}/secret` }] }));
    });
  });
  try {
    const model = createModel({ home: () => "test/.tmp/model-image-fetch-gate" });
    const res = new Res();
    const body = {
      profile: { baseUrl: `http://127.0.0.1:${upstream.port}/v1`, model: "img-x", apiKey: "sk-img" },
      prompt: "画一只猫"
    };
    await model.routes["POST /api/image"](Readable.from([Buffer.from(JSON.stringify(body))]), res);
    assert.notEqual(res.status, 200, "不许把本机地址当图取回");
    assert.match(JSON.parse(res.text).error, /本机|内网/);
    assert.equal(secretHits, 0, "那个本机接口一个请求都不该收到");
  } finally {
    await new Promise(resolve => secret.server.close(resolve));
    await new Promise(resolve => upstream.server.close(resolve));
  }
});
