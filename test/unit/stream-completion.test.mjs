import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const { wholeReplyEvents } = createRequire(import.meta.url)("../../server/model/sse.js");
const event = (delta = {}, finish_reason = null, extra = {}) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason }], ...extra })}\n\n`;
const sse = wire => new Response(wire, { headers: { "content-type": "text/event-stream" } });
const json = data => sse(wholeReplyEvents(data));

function setup(replies = []) {
  const f = load([
    "readSse",
    "streamReply",
    "estimateTokens",
    "requestJobs",
    `setup: (request, run, recordUsage) => {
      document.documentElement.dataset.inkMotion = 'off';
      document.hidden = true;
      saveStoreSoon = saveStore = renderSendButtons = renderHistory =
        setJobLabel = refreshSteps = markDirty = renderQuota = () => {};
      noteUsage = recordUsage;
      keepInWindow = mcpForTurn = maybeAutoCompact = maybeAutoTitle = async () => {};
      reserveTokens = () => () => {};
      replyDeliverables = async () => [];
      restFor = async () => {};
      systemPrompt = () => '';
      toolDefinitions = () => [{ type: 'function', function: { name: 'probe' } }];
      requestPatiently = request;
      runSteps = run;
      PROMPTS.assistant = { resume: '请从断处继续' };
    }`
  ]);
  const requests = [],
    runs = [],
    charges = [],
    profile = { id: "p", tools: true };
  f.setup(
    async (_profile, history, signal) => {
      requests.push(structuredClone(history));
      assert.ok(replies.length, "不应无限重试");
      const reply = replies.shift();
      return typeof reply === "function" ? reply(signal, () => f.requestJobs.get("c").controller.abort()) : reply;
    },
    async steps => {
      runs.push(...steps);
      for (const step of steps) step.status = "done";
      return { outcomes: new Map(steps.map(step => [step.id, "工具已完成"])), images: [] };
    },
    (kind, amount) => {
      if (amount > 0) charges.push([kind, amount]);
    }
  );
  return { ...f, requests, runs, charges, profile };
}

test("SSE：没有结束标志的 EOF 不能冒充完成，已收到的文字保留", async () => {
  const f = setup();
  for (const wire of ["", event({ content: "半句话" })]) {
    const target = { content: "已有进度。", toolCalls: null };
    await assert.rejects(f.readSse(sse(wire), target), /未发送结束标志/);
    assert.equal(target.content, "已有进度。" + (wire ? "半句话" : ""));
  }
});

test("SSE：兼容 DONE 或 finish_reason，末帧没有换行仍保留正文及用量", async () => {
  const f = setup();
  for (const terminal of ["data: [DONE]", event({}, "stop", { usage: { total_tokens: 77 } }).trimEnd()]) {
    const target = { content: "" };
    await f.readSse(sse(event({ content: "完整答复" }) + terminal), target);
    assert.equal(target.content, "完整答复");
    if (!terminal.includes("[DONE]")) assert.equal(target.usage.total_tokens, 77);
  }
});

test("SSE：长度截断即使带 DONE 也报错，显式错误仍保留", async () => {
  const f = setup();
  const target = { content: "" };
  await assert.rejects(f.readSse(sse(event({ content: "半截" }, "length") + "data: [DONE]\n\n"), target), /长度上限/);
  assert.equal(target.content, "半截");
  await assert.rejects(f.readSse(sse('data: {"error":{"message":"上游故障"}}\n\n'), { content: "" }), /上游故障/);
});

const toolReply = () =>
  sse(
    event(
      {
        content: "我先查一下。",
        tool_calls: [{ index: 0, id: "call_probe", function: { name: "probe", arguments: "{}" } }]
      },
      "tool_calls"
    ) + "data: [DONE]\n\n"
  );
const emptyReply = () => sse(event({}, "stop") + "data: [DONE]\n\n");
const finalReply = () => sse(event({ content: "检查完成。" }, "stop") + "data: [DONE]\n\n");
async function turn(f) {
  const assistant = { id: "a", role: "assistant", content: "", status: "streaming" };
  const conversation = { id: "c", messages: [{ id: "u", role: "user", content: "检查一下" }, assistant] };
  await f.streamReply(conversation, assistant, f.profile);
  return assistant;
}

const usageFrame = (prompt_tokens, completion_tokens, cached_tokens) =>
  `data: ${JSON.stringify({
    choices: [],
    usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens, prompt_tokens_details: { cached_tokens } }
  })}\n\n`;
const done = "data: [DONE]\n\n";
const lengthReply = () => sse(event({ content: "半句" }, "length") + usageFrame(800, 100, 700) + done);
const exactReply = () => sse(event({ content: "写完。" }, "stop") + usageFrame(900, 30, 500) + done);

function assertCharges(f, assistant, amounts, estimated) {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  assert.equal(assistant.tokenCount, total);
  assert.equal(assistant.tokenEstimated, estimated);
  assert.equal(f.profile.usedTokens, total);
  assert.deepEqual(
    f.charges,
    amounts.map(amount => ["main", amount])
  );
}

// 只在读完上一块、准备读下一块时按止；不靠计时等帧。[DONE] 已到时，按止落在 reader.cancel（整答收尾之前）。
const stopDuringRead = wire => (signal, stop) => {
  let sent = false;
  const body = new ReadableStream(
    {
      start: controller => signal.addEventListener("abort", () => controller.error(signal.reason), { once: true }),
      pull(controller) {
        if (sent) return stop();
        sent = true;
        controller.enqueue(new TextEncoder().encode(wire));
      },
      cancel: stop
    },
    { highWaterMark: 0 }
  );
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
};

test("自动续写：长度结束标志后的用量与正常末轮的用量各扣一次，缓存也相加", async () => {
  const f = setup([lengthReply(), exactReply()]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "半句写完。");
  assert.equal(f.requests.length, 2);
  assertCharges(f, assistant, [900, 930], false);
  assert.deepEqual(assistant.usage, { prompt_tokens: 1700, completion_tokens: 130, total_tokens: 1830, cached_tokens: 1200 });
});

test("自动续写耗尽：最后一个中断请求已报的用量也只按实数记一次", async () => {
  const f = setup([lengthReply(), lengthReply(), lengthReply()]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "interrupted");
  assert.equal(f.requests.length, 3);
  assertCharges(f, assistant, [900, 900, 900], false);
  assert.equal(assistant.usage.cached_tokens, 2100);
});

test("自动续写：开流却没报有效用量的请求才估算，正常末轮也不沿用前一轮用量", async () => {
  const f = setup([lengthReply(), sse(event({ content: "没写完" })), sse(event({ content: "检查完成。" }, "stop", { usage: {} }) + done)]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(f.requests.length, 3);
  const estimate = (i, said) => f.estimateTokens(f.requests[i]) + f.estimateTokens([{ content: said }]);
  assertCharges(f, assistant, [900, estimate(1, "没写完"), estimate(2, "检查完成。")], true);
  assert.equal(assistant.usage.cached_tokens, 700);
});

test("上游把这一轮的用量报成 0：算报过、不拿估算替它，整答也不标含估算", async () => {
  // 有的中转把计量抹成 0 回过来。估一份整历史替它，余墨会比实数多扣好几倍（见 delegate 那条端到端）。
  const f = setup([lengthReply(), sse(event({ content: "等一等" }, "stop") + usageFrame(0, 0, 0) + done)]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assertCharges(f, assistant, [900], false);
  assert.equal(assistant.usage.total_tokens, 900);
});

test("上游只报入、出两段、没有 total：合起来算这一轮的量", async () => {
  const f = setup([
    sse(
      event({ content: "写完。" }, "stop") +
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 30 } })}\n\n` +
        done
    )
  ]);
  const assistant = await turn(f);
  assertCharges(f, assistant, [930], false);
  assert.equal(assistant.usage.total_tokens, 930);
});

for (const ending of ["未收到用量", "已收到用量但未收到 DONE", "已收到 DONE"]) {
  test(`止：${ending}时，当前请求只结算一次`, async () => {
    const reported = ending !== "未收到用量",
      wire =
        event({ content: "后半句" }, reported ? "stop" : null) +
        (reported ? usageFrame(900, 30, 500) : "") +
        (ending === "已收到 DONE" ? done : "");
    const f = setup([lengthReply(), stopDuringRead(wire)]);
    const assistant = await turn(f);
    assert.equal(assistant.status, "stopped");
    assert.equal(f.requests.length, 2);
    const estimate = f.estimateTokens(f.requests[1]) + f.estimateTokens([{ content: "后半句" }]);
    assertCharges(f, assistant, [900, reported ? 930 : estimate], !reported);
    assert.equal(assistant.usage.cached_tokens, reported ? 1200 : 700);
  });
}

test("止：接续的请求开流前就被取消，不估量也不重复扣上轮用量", async () => {
  const f = setup([
    lengthReply(),
    (signal, stop) => {
      stop();
      signal.throwIfAborted();
    }
  ]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "stopped");
  assert.equal(f.requests.length, 2);
  assertCharges(f, assistant, [900], false);
  assert.equal(assistant.usage.cached_tokens, 700);
});

test("工具后空回复会重试，后续正文正常收尾且已完成工具只执行一次", async () => {
  const f = setup([toolReply(), emptyReply(), finalReply()]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.match(assistant.content, /检查完成/);
  assert.equal(f.requests.length, 3);
  assert.equal(f.runs.length, 1);
  assert.deepEqual(f.requests[1], f.requests[2]);
});

test("工具后连续空回复只重试两次，保留进度并标记中断", async () => {
  const f = setup([toolReply(), emptyReply(), emptyReply(), emptyReply()]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "interrupted");
  assert.match(assistant.error, /本轮未返回/);
  assert.match(assistant.content, /我先查一下/);
  assert.equal(f.requests.length, 4);
  assert.equal(f.runs.length, 1);
});

test("缺结束标志的半截工具调用不能执行，重试完成后才执行", async () => {
  const cut = sse(event({ tool_calls: [{ index: 0, id: "cut", function: { name: "probe", arguments: '{"x":' } }] }));
  const f = setup([cut, toolReply(), finalReply()]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  // 半截那一件不算，重试补齐之后才执行一件
  assert.deepEqual(
    f.runs.map(step => step.name),
    ["probe"]
  );
});

test("非流式长度截断同样自动续写，旧正文不会掩盖非流式空回复", async () => {
  const f = setup([
    json({ choices: [{ message: { content: "半句" }, finish_reason: "length" }] }),
    json({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
    finalReply()
  ]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "半句检查完成。");
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[1].at(-1).content, "请从断处继续");
});

test("SSE：一个 JSON 事件可拆成多行 data", async () => {
  const f = setup();
  const target = { content: "" };
  await f.readSse(sse('data: {"choices": [\ndata: {"delta": {"content": "多行"}}]}\n\ndata: [DONE]\n\n'), target);
  assert.equal(target.content, "多行");
});

test("上游事件转换：多行 JSON 可读，转换器内部异常不能静默吞掉", async () => {
  const { translateSse } = createRequire(import.meta.url)("../../server/model/sse.js");
  const wire = 'event: sample\ndata: {"text":\ndata: "ok"}\n\n';
  const source = () => new Response(wire).body;
  const translated = source().pipeThrough(
    translateSse("model", (out, data, name) => {
      assert.equal(name, "sample");
      out.chunk({ content: data.text });
      out.done();
    })
  );
  assert.match(await new Response(translated).text(), /"content":"ok"/);
  const failed = source().pipeThrough(
    translateSse("model", () => {
      throw Error("converter failure");
    })
  );
  await assert.rejects(new Response(failed).text(), /converter failure/);
});
