// 网关、中转把事件流标成 text/plain / octet-stream / 不写类型：按内容判是不是事件流，两种标错的都要读得出来。
// 反过来，标成 text/plain 的整份 JSON 也不能推进 readSse（只会报「未发送结束标志」）
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const event = (delta = {}, finish_reason = null, extra = {}) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason }], ...extra })}\n\n`;
const head = "data: [DONE]\n\n";
const streaming = text => event({ content: text }) + event({}, "stop", { usage: { total_tokens: 9 } }) + head;
const whole = (text, usage = { total_tokens: 12 }) =>
  JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage });
/** 按块到、类型照给的响应：content-type 传 null 即不写 */
const chunksOf = (chunks, type) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      }
    }),
    type ? { headers: { "content-type": type } } : undefined
  );

function setup(replies = []) {
  const f = load([
    "readSse",
    "streamReply",
    `setup: (request, run) => {
      document.documentElement.dataset.inkMotion = 'off';
      document.hidden = true;
      saveStoreSoon = saveStore = renderSendButtons = renderHistory =
        setJobLabel = refreshSteps = markDirty = accountUsage = renderQuota = () => {};
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
  const requests = [];
  f.setup(
    async (profile, history) => {
      requests.push(structuredClone(history));
      assert.ok(replies.length, "不应无限重试");
      return replies.shift();
    },
    async steps => ({ outcomes: new Map(steps.map(step => [step.id, "工具已完成"])), images: [] })
  );
  return { ...f, requests };
}

/** 开一答，不等着它收尾（要看答复是不是边到边写的用它） */
function begin(f) {
  const assistant = { id: "a", role: "assistant", content: "", status: "streaming" };
  const conversation = { id: "c", messages: [{ id: "u", role: "user", content: "说一句" }, assistant] };
  return { assistant, conversation, done: f.streamReply(conversation, assistant, { id: "p", tools: true }) };
}
const turn = async f => {
  const { assistant, done } = begin(f);
  await done;
  return assistant;
};
/** 等到 ok() 为真；等不到就报错（headline：这一路根本没在流着读） */
async function until(ok, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 20))) if (ok()) return;
  assert.fail("等不到答复写进消息，这一路是整份读完才落的字");
}

test("事件流被标成 text/plain：仍按流读出整段答复", async () => {
  const f = setup([chunksOf([streaming("答复")], "text/plain; charset=utf-8")]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "答复");
  assert.equal(assistant.usage.total_tokens, 9);
  assert.equal(f.requests.length, 1);
});

test("事件流不写 content-type、标成 application/octet-stream：都按流读", async () => {
  for (const type of [null, "application/octet-stream"]) {
    const f = setup([chunksOf([streaming("答复")], type)]);
    const assistant = await turn(f);
    assert.equal(assistant.status, "complete", String(type));
    assert.equal(assistant.content, "答复", String(type));
  }
});

test("整份 JSON 被标成 text/plain：不给事件流读法吞掉，照常读出", async () => {
  const f = setup([chunksOf([whole("整份答复")], "text/plain; charset=utf-8")]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "整份答复");
  assert.equal(assistant.usage.total_tokens, 12);
});

test("开头是 event: 或注释行 : 的，仍认作事件流", async () => {
  for (const lead of ["event: message\n\n", ": keep-alive\n\n", "\n\n", "\uFEFF"]) {
    const f = setup([chunksOf([lead + streaming("答复")], "text/plain")]);
    const assistant = await turn(f);
    assert.equal(assistant.status, "complete", JSON.stringify(lead));
    assert.equal(assistant.content, "答复", JSON.stringify(lead));
  }
});

test("正常标着 text/event-stream 的照旧直接读，不受影响", async () => {
  const f = setup([chunksOf([streaming("答复")], "text/event-stream")]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "答复");
});

test("开头带空白的整份 JSON 仍按整份读", async () => {
  const f = setup([chunksOf(["\n  ", whole("整份答复")], "text/plain")]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "整份答复");
});

test("分块到达：第一块只有几个字节，也判得出是事件流并读全", async () => {
  const wire = streaming("答复");
  const f = setup([chunksOf(["da", wire.slice(2, 20), wire.slice(20)], "text/plain")]);
  const assistant = await turn(f);
  assert.equal(assistant.status, "complete");
  assert.equal(assistant.content, "答复");
});

test("分块到达的流是边到边读的：答复在连接收尾之前就写进了消息", async () => {
  for (const type of ["text/event-stream", "text/plain"]) {
    let release;
    const gate = new Promise(resolve => (release = resolve));
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(event({ content: "边到边写" })));
        await gate;
        controller.enqueue(encoder.encode(event({}, "stop") + head));
        controller.close();
      }
    });
    const f = setup([new Response(body, { headers: { "content-type": type } })]);
    const { assistant, done } = begin(f);
    await until(() => assistant.content.includes("边到边写"));
    release();
    await done;
    assert.equal(assistant.status, "complete", type);
    assert.equal(assistant.content, "边到边写", type);
  }
});
