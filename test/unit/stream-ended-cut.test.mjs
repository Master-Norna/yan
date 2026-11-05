// 已收到结束标志（[DONE] 或 finish_reason）之后连接再断：答复其实已经写完，不当成断头去续写。
// 豁免只加在 pump 上，结束标志、finishFault 的判断照走——长度截断、被拦下、无结束标志的 EOF 照旧报错
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const event = (delta = {}, finish_reason = null, extra = {}) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason }], ...extra })}\n\n`;
const done = "data: [DONE]\n\n";
const sse = wire => new Response(wire, { headers: { "content-type": "text/event-stream" } });
/** 送完这几帧之后连接报错（controller.error）：读到的字都在，下一块读不出来 */
const broken = (wire, error) => {
  const chunk = new TextEncoder().encode(wire);
  return new Response(
    new ReadableStream({
      start: controller => controller.enqueue(chunk),
      pull: controller => controller.error(error)
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
};
const failure = (message, name = "Error") => Object.assign(Error(message), { name });
const aborted = () => failure("已停止", "AbortError");

function setup() {
  const f = load([
    "readSse",
    `setup: () => {
      document.documentElement.dataset.inkMotion = 'off';
      document.hidden = true;
      saveStoreSoon = saveStore = paintMessage = syncJumpBottom = scrollBottom = () => {};
    }`
  ]);
  f.setup();
  return f;
}

/** 读一份流，把结果（写成收尾 / 抛了什么）一并交回 */
async function read(f, response) {
  const target = { id: "a", role: "assistant", content: "" };
  const outcome = await f.readSse(response, target).then(
    () => ({ ok: true }),
    error => ({ ok: false, error })
  );
  return { target, ...outcome };
}

test("stop 结束块之后来一个错误事件：照常收尾，不报错", async () => {
  const f = setup();
  for (const terminal of [event({}, "stop"), done]) {
    const { target, ok, error } = await read(
      f,
      sse(event({ content: "写完了" }) + terminal + 'data: {"error":{"message":"上游掐线"}}\n\n')
    );
    assert.equal(ok, true, error?.message);
    assert.equal(target.content, "写完了");
  }
});

test("stop 结束块之后连接报错（controller.error）：照常收尾，不报错", async () => {
  const f = setup();
  const { target, ok, error } = await read(f, broken(event({ content: "写完了" }, "stop"), failure("网络断了")));
  assert.equal(ok, true, error?.message);
  assert.equal(target.content, "写完了");
});

test("length 即使带 DONE 仍报长度上限，被拦下的仍报被拦", async () => {
  const f = setup();
  let cut = await read(f, sse(event({ content: "半截" }, "length") + done));
  assert.equal(cut.ok, false);
  assert.match(cut.error.message, /长度上限/);
  assert.equal(cut.error.finish, "length");
  assert.equal(cut.target.content, "半截");
  // 结束块之后连接才断，也不改变「写到上限」这个判断
  cut = await read(f, broken(event({ content: "半截" }, "length") + done, failure("网络断了")));
  assert.equal(cut.ok, false);
  assert.match(cut.error.message, /长度上限/);
  const refused = await read(f, sse(event({ content: "说不出口" }, "content_filter") + done));
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /拦下/);
});

test("没有结束标志的 EOF 仍报未发送结束标志，途中断线仍按中断报出", async () => {
  const f = setup();
  const eof = await read(f, sse(event({ content: "半句话" })));
  assert.equal(eof.ok, false);
  assert.match(eof.error.message, /未发送结束标志/);
  assert.equal(eof.target.content, "半句话");
  const cutMidway = await read(f, broken(event({ content: "半句话" }), failure("网络断了")));
  assert.equal(cutMidway.ok, false);
  assert.equal(cutMidway.error.message, "网络断了");
  assert.equal(cutMidway.target.content, "半句话");
});

test("用户按停（AbortError）照旧抛出，即使已收到结束块", async () => {
  const f = setup();
  for (const wire of ["", event({ content: "写了半句" }), event({ content: "写完了" }, "stop") + done]) {
    const { ok, error } = await read(f, broken(wire, aborted()));
    assert.equal(ok, false);
    assert.equal(error.name, "AbortError");
  }
});
