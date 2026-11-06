// 非事件流的正文有个上限（server/model/index.js 的 SNIFF_LIMIT，8 MiB）：判定只看开头，只有整份 JSON 的答复才要整份，
// 配错的地址、失控的中转不能把常驻桥接一直吃到内存天花板。读到超过上限就停下、把上游那头掐掉，报 415 说清不再往下读；
// 不到上限的整份 JSON 照旧整份读进来；事件流不受这条上限管，照旧逐块往下交（大附件、带图的答复都在事件流里）
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createModel = require("../../server/model/index.js");
const chat = createModel({ home: () => "test/.tmp/upstream-body-limit" }).openRoutes["POST /api/chat"];

const MiB = 1024 * 1024;
// 上限本身没导出，照修法里的数写死：改了这个数就该有一条测试跟着醒过来
const LIMIT = 8 * MiB;

// 上游的回应由每件用例自己换掉；桥接只看这一份，不真发请求
let upstream = null;
globalThis.fetch = async url => {
  upstream.url = String(url);
  return upstream.response();
};
const answer = (body, type) => {
  upstream = { response: () => new Response(body, { status: 200, headers: { "content-type": type } }) };
};

const openai = { baseUrl: "http://relay.test/v1", model: "gpt-x" };

// 一只源源不断吐 1 MiB 块的身子：开头给 head（默认 { ，一眼不是事件流），之后每块都是同一段字。
// 被拉走几块、有没有被掐掉都记下来——超了上限还继续往下读，这里就看得出来
function runaway(total, head = "{") {
  const encoder = new TextEncoder();
  const blocks = Math.ceil(total / MiB);
  let pulled = 0,
    cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      if (pulled >= blocks) return controller.close();
      const at = pulled++,
        size = Math.min(MiB, total - at * MiB),
        fill = at === 0 ? head + "x".repeat(size - head.length) : "x".repeat(size);
      controller.enqueue(encoder.encode(fill));
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
// 一段文字按 size 字节分块交出去（只用于纯 ASCII），到齐了就关
function chunked(text, size) {
  const encoder = new TextEncoder();
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= text.length) return controller.close();
      controller.enqueue(encoder.encode(text.slice(at, at + size)));
      at += size;
    }
  });
}

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
  get json() {
    return JSON.parse(this.text);
  }
}

async function ask(profile = openai) {
  const res = new Res();
  const body = { profile, messages: [{ role: "user", content: "你好" }] };
  await chat(Readable.from([Buffer.from(JSON.stringify(body))]), res);
  return res;
}

test("正文不是事件流又超过 8 MiB：415 说清不再往下读，读到上限就停手", { timeout: 15000 }, async () => {
  const wire = runaway(40 * MiB);
  answer(wire.body, "text/plain; charset=utf-8");
  const res = await ask();
  assert.equal(res.status, 415);
  const error = res.json.error;
  assert.match(error, /不是事件流/, "要说清这不是事件流");
  assert.match(error, /超过 8 MB/, "要带上限是多少，看的人才知道是配置错了还是答复太大");
  assert.match(error, /不再往下读/);
  assert.match(error, /前 200 字/, "前 200 字照旧带出来，配错的地址一眼看得出");
  assert.ok(!/读不出 JSON/.test(error), "超上限是停下不再读，不该报成读完了却读不出 JSON");
  assert.ok(wire.pulled < 40, `拉到 ${wire.pulled} 块说明整份都读进来了，上限没起作用`);
  assert.ok(wire.pulled <= 10, `超过上限只该多读那一块，实际读了 ${wire.pulled} 块`);
  assert.ok(wire.cancelled, "停下时要把上游那头掐掉，不然中转还在替没人读的流往外发");
});

test("OpenAI 兼容那路的整份 JSON 超过上限：同样 415，不摆成一块事件流", { timeout: 15000 }, async () => {
  // 开头是 { 也照样先看上限：整份 JSON 的答复也不该无界地收进来
  const wire = runaway(LIMIT + MiB);
  answer(wire.body, "application/json");
  const res = await ask();
  assert.equal(res.status, 415);
  assert.match(res.json.error, /超过 8 MB/);
});

test("不到上限的整份 JSON：分块到达也照旧整份读进来，摆成一块事件流", async () => {
  const wire = JSON.stringify({
    choices: [{ index: 0, message: { role: "assistant", content: "整段答复" }, finish_reason: "stop" }],
    usage: { total_tokens: 12 }
  });
  answer(chunked(wire, 7), "application/json");
  const res = await ask();
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/event-stream/);
  assert.match(res.text, /"content":"整段答复"/);
  assert.match(res.text, /"finish_reason":"stop"/);
  assert.ok(res.text.endsWith("data: [DONE]\n\n"));
});

test("正文正好 8 MiB 的整份 JSON 不算超：上限是「超过」才停", { timeout: 15000 }, async () => {
  // 一份不多不少正好到上限的整份答复：差一字节的判定（> 还是 >=）只有这条看得出
  const head = '{"choices":[{"message":{"role":"assistant","content":"',
    tail = '"},"finish_reason":"stop"}]}',
    pad = "x".repeat(LIMIT - head.length - tail.length),
    wire = head + pad + tail;
  assert.equal(Buffer.byteLength(wire), LIMIT, "先确认这份正文真的正好到上限");
  answer(chunked(wire, MiB), "application/json");
  const res = await ask();
  assert.equal(res.status, 200, "正好到上限不该当成超了");
  assert.match(res.text, /"finish_reason":"stop"/);
  assert.ok(res.text.includes(pad), "整份都读进来了，正文一个字没丢");
});

test("事件流不受这条上限管：超过 8 MiB 也照旧逐块往下交", { timeout: 15000 }, async () => {
  // 带图、带大附件的答复都在事件流里，这里不能因为「长得大」就掐掉
  const total = LIMIT + MiB,
    wire = runaway(total, "data: ");
  answer(wire.body, "text/event-stream");
  const res = await ask();
  assert.equal(res.status, 200);
  assert.equal(res.text.length, total, "事件流要整份原样交给页面");
});
