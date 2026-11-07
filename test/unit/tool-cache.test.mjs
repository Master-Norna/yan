// 工具缓存的两处（src/15-tools/00-registry.js）：
//  1) toolCacheKey 要在参数理顺（别名归位、定型）之后才交给各工具的 cache 算键——
//     拿原始参数算，search_web 的 args.query.trim()、fetch_page 的 args.url.trim() 会抛，
//     异常穿过 runSteps 把整答打断（步骤停在 running、同批其余工具的结果全丢）。
//  2) 复用结果时的呈现要把请示的答案（answers）一并搬过去：不搬的话，命中缓存的那一步
//     在摘要里写成「用户未作答」、行迹里也看不到答案。
// 改动前：别名/数字/空参数三种写法都抛 TypeError（本文件前两条红）；复用后 answers 丢失（第三条红）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const setup = () =>
  load([
    "toolCacheKey",
    "toolPresentation",
    "TOOLS",
    `setup: () => {
      document.documentElement.dataset.inkMotion = "off";
      document.hidden = true;
      refreshSteps = () => {};
    }`
  ]);

test("算缓存键不再被别名、数字、空参数打断", () => {
  const f = setup();
  f.setup();
  // 别名 q：归一后算键，不抛
  assert.ok(f.toolCacheKey({ name: "search_web", arguments: '{"q":"言 yan"}' }));
  // 数字定型成字符串
  assert.ok(f.toolCacheKey({ name: "search_web", arguments: '{"query":123}' }));
  // 缺必填：不给键（交给 runTool 报「参数不合要求」），也不抛
  assert.equal(f.toolCacheKey({ name: "search_web", arguments: "{}" }), null);
  assert.ok(f.toolCacheKey({ name: "fetch_page", arguments: '{"link":"https://example.com/a"}' }));
  assert.equal(f.toolCacheKey({ name: "fetch_page", arguments: "{}" }), null);
});

test("同一份参数算出来的键稳定；不同参数不同键", () => {
  const f = setup();
  f.setup();
  const key = args => f.toolCacheKey({ name: "search_web", arguments: args });
  assert.equal(key('{"query":"言  yan"}'), key('{"query":"言 yan"}'));
  assert.notEqual(key('{"query":"言 yan"}'), key('{"query":"另一个问"}'));
});

test("复用结果时请示的答案跟着走，摘要不写成「用户未作答」", () => {
  const f = setup();
  f.setup();
  const step = {
    id: "s1",
    name: "ask_user",
    arguments: '{"questions":[{"question":"用哪种风格？","header":"风格","options":["清简","繁复"]}]}',
    status: "done",
    answers: ["清简"],
    note: "风格：清简"
  };
  // runSteps 的缓存分支：新的一步照 toolPresentation 的呈现搬过来
  const reused = { id: "s2", name: "ask_user", arguments: step.arguments, status: "running" };
  Object.assign(reused, structuredClone(f.toolPresentation(step)));
  assert.deepEqual(reused.answers, ["清简"]);
  assert.match(f.TOOLS.get("ask_user").digest(reused), /清简/);
  assert.doesNotMatch(f.TOOLS.get("ask_user").digest(reused), /未作答/);
});
