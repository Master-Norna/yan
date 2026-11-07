// 生图取图（server/model/image.js 的 fetchImage）与其它公网请求走同一条路：地址门禁、逐跳复检、带出站标记。
// 上游交回的网址可以写成内网、本机——裸 fetch 就等于让桥接替它去取，桥接的受信接口对无标记的本机请求
// 是放行的（见 server.js 的门禁）。上游自己在本机时（用户配的本地生图服务）回环照常放行，与 http_request 同规矩。
// 改动前第一条红：内网地址被照取（裸 fetch 直接去连）。
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
const close = ({ server }) => new Promise(resolve => server.close(resolve));
const imageBody = (upstreamPort, prompt = "画一只猫") => ({
  profile: { baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, model: "img-x", apiKey: "sk-img" },
  prompt
});

test("公网中转交回的内网地址，生图取图不替它去取", async () => {
  // 一个连不上的内网地址作靶：门禁在连之前就拒（改动前会直接去连它）
  const upstream = await listen((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ url: "http://192.168.1.1:1/secret" }] }));
    });
  });
  try {
    const model = createModel({ home: () => "test/.tmp/model-image-fetch-gate" });
    const res = new Res();
    await model.routes["POST /api/image"](Readable.from([Buffer.from(JSON.stringify(imageBody(upstream.port)))]), res);
    assert.equal(res.status, 400, "不许把内网地址当图取回");
    assert.match(JSON.parse(res.text).error, /内网|本机/);
  } finally {
    await close(upstream);
  }
});

test("上游在本机：它交回的本机图照常取（本地生图服务）", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
  const image = await listen((req, res) => {
    res.setHeader("content-type", "image/png");
    res.end(png);
  });
  const upstream = await listen((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${image.port}/cat.png` }] }));
    });
  });
  try {
    const model = createModel({ home: () => "test/.tmp/model-image-fetch-gate" });
    const res = new Res();
    await model.routes["POST /api/image"](Readable.from([Buffer.from(JSON.stringify(imageBody(upstream.port)))]), res);
    assert.equal(res.status, 200, res.text);
    assert.match(JSON.parse(res.text).images[0].data, /^data:image\/png;base64,/);
  } finally {
    await close(upstream);
    await close(image);
  }
});
