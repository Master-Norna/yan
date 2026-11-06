// 生图接口归受信的一边（server/model/index.js 末尾的登记）。/api/image 会按调用方给的 baseUrl 去上游出图、
// 再照上游交回的网址把图取回来，那一步是桥接替页面出站：放在 openRoutes 里，任何本机端口上的页面都能借它读任意 http 地址。
// 转发与列模型不带这种出站取件，照旧对凡本机来源开放——这里一并断言，免得收得太宽把页面自己也挡在外面
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createModel = require("../../server/model/index.js");
// 存储根只在读 ChatGPT 登录凭证时用到（home 是函数，用时才取），这里给一只不会真去写的目录
const model = createModel({ home: () => "test/.tmp/model-image-trusted" });

test("生图接口只在受信的一边：routes 里有，openRoutes 里没有", () => {
  assert.equal(typeof model.routes["POST /api/image"], "function", "受信的那一半要留着它，页面本身还要能生图");
  assert.equal(model.openRoutes["POST /api/image"], undefined, "交给 openRoutes 就等于让本机任意端口页面借它出站读任意 http 地址");
});

test("openRoutes 里没有别的生图接口漏在外面", () => {
  assert.deepEqual(
    Object.keys(model.openRoutes).filter(key => /image/i.test(key)),
    []
  );
});

test("转发、试连、列模型照旧对凡本机来源开放", () => {
  for (const key of ["POST /api/chat", "POST /api/test", "POST /api/models"])
    assert.equal(typeof model.openRoutes[key], "function", `${key} 不带出站取件，页面之外的本机来源也该调得到`);
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
