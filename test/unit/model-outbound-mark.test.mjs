// 桥接自己发出的请求都带上「桥接转出」的标记（OUTBOUND_MARK，见 server/web.js）：baseUrl 被配成桥接自己的受信接口时，
// server.js 靠这个标记载的请求拒绝掉，模型就不能借转发与列模型绕过请示、把桥接当跳板。
// 这里替掉 globalThis.fetch，截下真正发出去的那次请求的头：对话（handleChat）与列模型（listModels）两处都要带，原有的鉴权头不能丢
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { OUTBOUND_MARK } = require("../../server/web.js");
const createModel = require("../../server/model/index.js");
const model = createModel({ home: () => "test/.tmp/model-outbound-mark" });
const chat = model.routes["POST /api/chat"],
  models = model.routes["POST /api/models"];

// 上游的回应由每件用例自己换掉；截下来的请求头留在 sent 里
let answer = null,
  sent = null;
globalThis.fetch = async (url, init) => {
  sent = { url: String(url), headers: /** @type {any} */ (init?.headers) || {} };
  return answer();
};

const openai = { baseUrl: "http://relay.test/v1", model: "gpt-x", apiKey: "sk-test" };
const anthropic = { api: "anthropic", baseUrl: "http://relay.test", model: "claude-sonnet-4-5", apiKey: "sk-ant" };
// 一份一看就是事件流的回应：判开头只认第一个字节 d，之后原样往下交，对话这条路边到边就完了
const eventStream = () =>
  new Response('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n', {
    headers: { "content-type": "text/event-stream" }
  });

// 假响应：要能收完整条流（source.pipe(res)），所以是一只真的 Writable
class Res extends Writable {
  constructor() {
    super();
    this.headersSent = false;
    this.status = 0;
    this.headers = {};
    this.chunks = [];
  }
  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
  }
  writeHead(status, headers = {}) {
    this.status = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
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

async function ask(profile) {
  const res = new Res();
  const body = { profile, messages: [{ role: "user", content: "你好" }] };
  await chat(Readable.from([Buffer.from(JSON.stringify(body))]), res);
  return res;
}
async function list(profile, kind = "") {
  const res = new Res();
  await models(Readable.from([Buffer.from(JSON.stringify({ profile, kind }))]), res);
  return res;
}

test("对话发往上游时带上标记，Bearer 鉴权头照旧在", async () => {
  answer = eventStream;
  const res = await ask(openai);
  assert.equal(res.status, 200);
  assert.equal(sent.headers[OUTBOUND_MARK], "1", `出站的对话请求要带 ${OUTBOUND_MARK}`);
  assert.equal(sent.headers.Authorization, "Bearer sk-test", "加了标记不能把原来的鉴权头挤掉");
  assert.equal(sent.headers["Content-Type"], "application/json; charset=utf-8");
});

test("对话走 Anthropic 那路时也带上标记，x-api-key 与版本头照旧在", async () => {
  answer = eventStream;
  const res = await ask(anthropic);
  assert.equal(res.status, 200);
  assert.equal(sent.url, "http://relay.test/v1/messages");
  assert.equal(sent.headers[OUTBOUND_MARK], "1");
  assert.equal(sent.headers["x-api-key"], "sk-ant");
  assert.equal(sent.headers["anthropic-version"], "2023-06-01");
});

test("列模型发往上游时带上标记，鉴权头照旧在", async () => {
  answer = () =>
    new Response(JSON.stringify({ data: [{ id: "gpt-x" }, { id: "gpt-y" }] }), { headers: { "content-type": "application/json" } });
  const res = await list(openai);
  assert.equal(res.status, 200);
  assert.match(sent.url, /\/v1\/models$/);
  assert.equal(sent.headers[OUTBOUND_MARK], "1", `出站的列模型请求要带 ${OUTBOUND_MARK}`);
  assert.equal(sent.headers.Authorization, "Bearer sk-test");
  assert.deepEqual(JSON.parse(res.text).models, ["gpt-x", "gpt-y"]);
});

test("没填 API Key 的配置也带标记：标记不靠鉴权头顺路带上", async () => {
  answer = eventStream;
  await ask({ baseUrl: "http://relay.test/v1", model: "gpt-x" });
  assert.equal(sent.headers[OUTBOUND_MARK], "1");
  assert.equal("Authorization" in sent.headers, false, "没填 Key 就不该凭空多出一个鉴权头");
});
