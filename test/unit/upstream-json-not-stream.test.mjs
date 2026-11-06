// 上游回 200 之后交给页面的只有事件流（server/model/index.js 的 eventBody）。判据看正文开头的字节，不看 content-type：
// 事件流不管标成什么照旧往下交（#22、#31）；OpenAI 兼容那路整份答复摆成一块事件流；要重译的两路（Anthropic、ChatGPT 订阅）译不了整份，
// 报错的整份（可重试、带上游原话）、正常答复的整份（415、不重试、带前 200 字）分开给（#26）
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const require = createRequire(import.meta.url);
const createModel = require("../../server/model/index.js");
const chat = createModel({ home: () => "test/.tmp/upstream-json-not-stream" }).routes["POST /api/chat"];

// 上游的回应由每件用例自己换掉；桥接只看这一份，不真发请求
let upstream = null;
globalThis.fetch = async (url, init) => {
  upstream.last = { url: String(url), init };
  return upstream.response();
};
const answer = (body, type, status = 200) => {
  upstream = { response: () => new Response(body, { status, headers: type === null ? {} : { "content-type": type } }) };
};
const anthropic = { api: "anthropic", baseUrl: "http://relay.test", model: "claude-sonnet-4-5", apiKey: "sk-test" };
const openai = { baseUrl: "http://relay.test/v1", model: "gpt-x" };

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
    this.onWrite?.();
    done();
  }
  get text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
  get json() {
    return JSON.parse(this.text);
  }
}
async function ask(profile = anthropic) {
  const res = new Res();
  const body = { profile, messages: [{ role: "user", content: "你好" }] };
  await chat(Readable.from([Buffer.from(JSON.stringify(body))]), res);
  return res;
}
// 一份正常的 Anthropic 事件流：两段正文、end_turn 收尾，用量 9 + 4
const anthropicSse = () =>
  [
    ["message_start", { type: "message_start", message: { model: "claude-sonnet-4-5", usage: { input_tokens: 9 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "整段" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "答复" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } }],
    ["message_stop", { type: "message_stop" }]
  ]
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");

// 页面据状态码定的节奏：408 / 409 / 425 / 429 与 5xx 等一等再试，其余 4xx 当场交回（见 14-chat-engine/30-rounds.js 的 retryableStatus）
const retryable = status => status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;

test("上游 200 回报错的整份 JSON：给可重试的状态码，并带上游原话", async () => {
  const wire = JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
  answer(wire, "application/json");
  const res = await ask();
  assert.equal(res.status, 503);
  assert.equal(res.json.error, "Overloaded");
  assert.ok(retryable(res.status), "过载该等一等再试，不能当成参数错交回");
});

test("中转不支持流式、回了整份答复的 JSON：4xx 且不可重试，说清不是事件流", async () => {
  const wire = JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: "整段答复" }, finish_reason: "stop" }]
  });
  answer(wire, "application/json; charset=utf-8");
  const res = await ask();
  assert.ok(res.status >= 400 && res.status < 500, "回 5xx 页面会把 RETRY_DELAYS 排满，干等五分钟");
  assert.ok(!retryable(res.status), "中转不支持流式不是等一等就会好的事");
  assert.match(res.json.error, /整份 JSON/);
  assert.match(res.json.error, /不是事件流/);
  assert.ok(!/^上游接口返回 200$/.test(res.json.error), "不能只剩一句「上游接口返回 200」");
});

test("整份 JSON 标成 text/plain 或不标类型：也按开头字节认出来，不再白跑两次", async () => {
  const wire = JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "整段答复" }, finish_reason: "stop" }] });
  for (const type of ["text/plain; charset=utf-8", null]) {
    answer(wire, type);
    const res = await ask();
    assert.equal(res.status, 415, `标成 ${type} 的整份 JSON 不该再当成空事件流`);
    assert.match(res.json.error, /整份 JSON/);
    assert.match(res.json.error, /整段答复/, "前 200 字里要看得到上游的原话");
  }
});

test("上游回 {code,message} 这类拒绝：415 带上前 200 字，原话不丢", async () => {
  const wire = JSON.stringify({ code: 40001, message: "余额不足，请充值" });
  answer(wire, "application/json");
  const res = await ask();
  assert.equal(res.status, 415);
  assert.ok(!retryable(res.status), "余额不足不是等一等就会好的事");
  assert.match(res.json.error, /余额不足，请充值/, "上游说的话要原样看得到，不用去猜 message、code");
});

test("开头是 { 却读不出 JSON：415，带前 200 字", async () => {
  answer('{ "choices": [ 这不是 JSON', "text/plain");
  const res = await ask();
  assert.equal(res.status, 415);
  assert.match(res.json.error, /读不出 JSON/);
  assert.match(res.json.error, /这不是 JSON/);
});

test("事件流标成 application/json：照旧翻译，不因类型误判", async () => {
  answer(anthropicSse(), "application/json");
  const res = await ask();
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/event-stream/);
  assert.match(res.text, /"content":"整段"/);
  assert.match(res.text, /"content":"答复"/);
  assert.match(res.text, /"finish_reason":"stop"/);
  assert.ok(res.text.endsWith("data: [DONE]\n\n"));
});

test("判开头只看头一块：事件流不整份读完才往下交", { timeout: 5000 }, async () => {
  const wire = anthropicSse(),
    // 前半截里就有两段正文（头一块到了就该往下交），后半截的收尾等页面那头收到字之后才发
    at = wire.indexOf("event: content_block_stop"),
    parts = [wire.slice(0, at), wire.slice(at)],
    encoder = new TextEncoder();
  let open;
  const gate = new Promise(resolve => (open = resolve));
  let sent = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(parts[sent++]));
    },
    async pull(controller) {
      await gate;
      if (sent < parts.length) controller.enqueue(encoder.encode(parts[sent++]));
      else controller.close();
    }
  });
  upstream = { response: () => new Response(body, { headers: { "content-type": "application/json" } }) };
  const res = new Res();
  res.onWrite = () => open();
  await chat(Readable.from([Buffer.from(JSON.stringify({ profile: anthropic, messages: [{ role: "user", content: "你好" }] }))]), res);
  assert.equal(res.status, 200);
  assert.match(res.text, /"content":"整段"/);
  assert.match(res.text, /"finish_reason":"stop"/);
});

test("回了 200、判定途中断线：502 可重试、带原因码，不落成不再试的 400", async () => {
  const cases = [
    ["", "text/event-stream"],
    ["\n\n", "text/event-stream"],
    ['{"id":"x","cho', "application/json"]
  ];
  for (const [lead, type] of cases) {
    upstream = {
      response: () => {
        let sent = !lead;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (sent) return controller.error(Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET" } }));
              sent = true;
              controller.enqueue(new TextEncoder().encode(lead));
            }
          }),
          { headers: { "content-type": type } }
        );
      }
    };
    const res = await ask();
    assert.equal(res.status, 502, JSON.stringify(lead));
    assert.match(res.json.error, /上游连接中断：UND_ERR_SOCKET/);
  }
});

test("标成 text/plain 或不标类型的事件流照旧翻译（#22 那些中转不能弄坏）", async () => {
  for (const type of ["text/plain; charset=utf-8", null]) {
    answer(anthropicSse(), type);
    const res = await ask();
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/event-stream/);
    assert.match(res.text, /"content":"整段"/);
    assert.match(res.text, /"content":"答复"/);
    assert.match(res.text, /"finish_reason":"stop"/);
    assert.match(res.text, /"total_tokens":13/);
    assert.ok(res.text.endsWith("data: [DONE]\n\n"));
  }
});

const oneChunk = text => [
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
  "data: [DONE]\n\n"
];

test("OpenAI 兼容那路的整份答复：不管标成什么，都摆成一块事件流，正文、用量、结束原因都在", async () => {
  const wire = JSON.stringify({
    choices: [{ index: 0, message: { role: "assistant", content: "整段答复" }, finish_reason: "length" }],
    usage: { total_tokens: 12 }
  });
  for (const type of ["application/json", "text/plain; charset=utf-8", "text/event-stream", null]) {
    answer(`\n  ${wire}`, type);
    const res = await ask(openai);
    assert.equal(res.status, 200, String(type));
    assert.match(res.headers["content-type"], /text\/event-stream/);
    assert.match(res.text, /"content":"整段答复"/);
    assert.match(res.text, /"finish_reason":"length"/);
    assert.match(res.text, /"total_tokens":12/);
    assert.ok(res.text.endsWith("data: [DONE]\n\n"));
  }
});

test("OpenAI 兼容那路的整份报错：上游原话当场交回，不重试", async () => {
  for (const [wire, said] of [
    [{ error: { message: "上游故障：余额不足" } }, /余额不足/],
    [{ error: "接口限流" }, /接口限流/]
  ]) {
    answer(JSON.stringify(wire), "application/json");
    const res = await ask(openai);
    assert.ok(res.status >= 400 && !retryable(res.status), JSON.stringify(wire));
    assert.match(res.json.error, said);
  }
});

test("OpenAI 兼容那路回的既不是答复也不是事件流：415 带前 200 字，不报成「未返回正文」", async () => {
  for (const [wire, said] of [
    [JSON.stringify({ code: 40001, message: "余额不足，请充值" }), /余额不足，请充值/],
    ["<html>网关出错</html>", /网关出错/]
  ]) {
    answer(wire, "text/html");
    const res = await ask(openai);
    assert.equal(res.status, 415);
    assert.match(res.json.error, said);
  }
});

test("OpenAI 兼容那路的事件流不管标成什么、开头带什么，都原样往下交", async () => {
  const stream = oneChunk("答复").join("");
  for (const type of ["text/event-stream", "text/plain; charset=utf-8", "application/octet-stream", null])
    for (const lead of ["", "event: message\n\n", ": keep-alive\n\n", "\n\n", "\uFEFF"]) {
      answer(lead + stream, type);
      const res = await ask(openai);
      assert.equal(res.status, 200, `${type} ${JSON.stringify(lead)}`);
      assert.match(res.headers["content-type"], /text\/event-stream/);
      assert.equal(res.text, lead + stream);
    }
});

test("OpenAI 兼容那路分块到达：第一块只有几个字节也判得出，且边到边往下交", { timeout: 5000 }, async () => {
  const [first, last] = oneChunk("边到边写"),
    encoder = new TextEncoder();
  let open;
  const gate = new Promise(resolve => (open = resolve));
  const parts = [first.slice(0, 2), first.slice(2)];
  let sent = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (sent < parts.length) return controller.enqueue(encoder.encode(parts[sent++]));
      await gate;
      controller.enqueue(encoder.encode(last));
      controller.close();
    }
  });
  upstream = { response: () => new Response(body, { headers: { "content-type": "text/plain" } }) };
  const res = new Res();
  res.onWrite = () => res.text.includes("边到边写") && open();
  await chat(Readable.from([Buffer.from(JSON.stringify({ profile: openai, messages: [{ role: "user", content: "你好" }] }))]), res);
  assert.equal(res.text, first + last);
});

// 上游 200 却是空事件流（开了流又一个字没发）：页面对它的处置不变——「已中断」要先有写出的内容，
// 一个字没有的按 error 记，不给「已写的部分都在，可由此续写」那行（见 14-chat-engine/20-stream.js、07-render/20-conversation.js）
function page(replies) {
  const f = load([
    "readSse",
    "streamReply",
    `setup: (request) => {
      document.documentElement.dataset.inkMotion = 'off';
      document.hidden = true;
      saveStoreSoon = saveStore = renderSendButtons = renderHistory =
        setJobLabel = refreshSteps = markDirty = accountUsage = renderQuota = () => {};
      keepInWindow = mcpForTurn = maybeAutoCompact = maybeAutoTitle = async () => {};
      reserveTokens = () => () => {};
      replyDeliverables = async () => [];
      restFor = async () => {};
      systemPrompt = () => '';
      toolDefinitions = () => [];
      requestPatiently = request;
      PROMPTS.assistant = { resume: '请从断处继续' };
    }`
  ]);
  const requests = [];
  f.setup(async (profile, history) => {
    requests.push(structuredClone(history));
    assert.ok(replies.length, "不应无限重试");
    return replies.shift();
  });
  return { ...f, requests };
}

test("上游 200 却是空事件流：没写出字落成 error，不是可续写的中断", async () => {
  const empty = () => new Response("", { headers: { "content-type": "text/event-stream" } });
  const f = page([empty(), empty(), empty()]);
  const assistant = { id: "a", role: "assistant", content: "", status: "streaming" };
  const conversation = { id: "c", messages: [{ id: "u", role: "user", content: "你好" }, assistant] };
  await f.streamReply(conversation, assistant, { id: "p", tools: false });
  assert.equal(assistant.status, "error");
  assert.match(assistant.error, /未发送结束标志/);
  assert.equal(assistant.interruptedAt, undefined, "没写出字的不给续写");
});
