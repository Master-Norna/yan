// 模型接口全归受信的一边（server/model/index.js 末尾的登记）：地址都由调用方给，开放给别的本机页面就等于替它往内网发请求、把回话读回去。
// 真正按来源拦的是 server.js 的门禁，见 test/bridge-security.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createModel = require("../../server/model/index.js");
// 存储根只在读 ChatGPT 登录凭证时用到（home 是函数，用时才取），这里给一只不会真去写的目录
const model = createModel({ home: () => "test/.tmp/model-image-trusted" });

test("模型接口只登记在受信的一边，不留开放的那份", () => {
  for (const key of ["POST /api/chat", "POST /api/test", "POST /api/models", "POST /api/image"])
    assert.equal(typeof model.routes[key], "function", `${key} 要在 routes 里，页面本身还要用`);
  assert.equal(model.openRoutes, undefined);
});

// 只断言登记表里没有它还不够：那条路由得真接在生图处理上（缺描述时回 400 那句话），不是随手一只空函数
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

test("受信那半边的生图接口接的是真处理：缺画面描述时回 400", async () => {
  const res = new Res();
  const body = { profile: { baseUrl: "http://relay.test/v1", model: "img-x", apiKey: "sk-img" }, prompt: "" };
  await model.routes["POST /api/image"](Readable.from([Buffer.from(JSON.stringify(body))]), res);
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.text).error, /缺少画面描述/);
});
