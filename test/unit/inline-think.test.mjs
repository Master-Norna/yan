import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

// 把思考写进正文开头 <think>…</think> 的接口：思考里提到标签本身（`</think>`）不能当成收尾，不然后半截思考落进正文
const event = content => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`;
const done = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
const f = load([
  "readSse",
  "thinkCloser",
  "parseInlineThink",
  `setup: () => {
    document.documentElement.dataset.inkMotion = 'off';
    document.hidden = true;
    saveStoreSoon = saveStore = paintMessage = syncJumpBottom = scrollBottom = () => {};
  }`
]);
f.setup();
/** 按给的 SSE 内容片段流进来 */
function receive(chunks, assistant, terminal = done) {
  return f.readSse(new Response(chunks.map(event).join("") + terminal), assistant);
}
async function stream(chunks, content = "", reasoning = "") {
  const assistant = { id: "a", role: "assistant", content, reasoning };
  await receive(chunks, assistant);
  return assistant;
}
const THOUGHT = '模型生成的 `</think>` 标记、引号里的 "</think>" 与「</think>」都只是提到它';

test("思考里提到的结束标签不算收尾：整段一块到", async () => {
  const a = await stream([`<think>${THOUGHT}\n</think>\n\n正文`]);
  assert.equal(a.reasoning, `${THOUGHT}\n`);
  assert.equal(a.content, "正文");
});

test("逐字流进来也一样（标签被切开、标签恰在块尾等下一个字）", async () => {
  const a = await stream([...`<think>${THOUGHT}\n</think>\n\n正文`]);
  assert.equal(a.reasoning, `${THOUGHT}\n`);
  assert.equal(a.content, "正文");
});

test("真的结束标签紧接正文、或流到头只剩标签", async () => {
  let a = await stream(["<think>想一想</think>答"]);
  assert.deepEqual([a.reasoning, a.content], ["想一想", "答"]);
  a = await stream(["<think>想", "一想</think>"]);
  assert.deepEqual([a.reasoning, a.content], ["想一想", ""]);
});

test("没有开头标签：这一轮正文里裸的 </think> 之前都是思考，接在思考字段后", async () => {
  for (const chunks of [[`Let me check ${THOUGHT}.</think>\n\n模板看清了`], [..."Let me check.</think>\n\n模板看清了"]]) {
    const assistant = await stream(chunks, "上一轮的话\n\n", "原生思考");
    assert.equal(assistant.content, "上一轮的话\n\n模板看清了");
    assert.match(assistant.reasoning, /^原生思考\n\nLet me check/);
  }
});

test("没有开头标签：引号里的、代码围栏里的、流到头都没有真的结束标签的，正文不动", async () => {
  for (const text of [`答复里讲 ${THOUGHT}`, "示例：\n```\n</think>\n```\n完"]) {
    const a = await stream([text]);
    assert.equal(a.content, text);
    assert.equal(a.reasoning, "");
  }
});

test("裸标签的前一个字可以来自上一轮，后一个字可以在下一块", async () => {
  const prior = '上一轮末字是引号"';
  const a = await stream(["</thi", "nk>", "正文中提到 `", "</think>", "`，不是思考"], prior);
  assert.deepEqual([a.reasoning, a.content], ["", prior + "</think>正文中提到 `</think>`，不是思考"]);
  const unquoted = await stream(["</thi", "nk>", "\n正文"], "上一轮结束。");
  assert.deepEqual([unquoted.reasoning, unquoted.content], ["", "上一轮结束。正文"]);
});

test("跳过围栏里的裸标签后接着找，找到后不再拆正文", async () => {
  const thought = "想看示例：\n```\n</think>\n```\n再作答";
  for (const chunks of [[`${thought}</think>\n正文。</think>还是正文`], [...`${thought}</think>\n正文。</think>还是正文`]]) {
    const a = await stream(chunks, "旧正文。", "旧思考");
    assert.deepEqual([a.reasoning, a.content], [`旧思考\n\n${thought}`, "旧正文。正文。</think>还是正文"]);
  }
});

test("流正常结束或断开时，照样收住恰落在末尾的裸结束标签", async () => {
  for (const terminal of [done, "", 'data: {"error":"上游故障"}\n\n']) {
    const a = { id: "a", content: "旧正文。", reasoning: "旧思考" };
    const reading = receive(["想一想", "</th", "ink>"], a, terminal);
    if (terminal === done) await reading;
    else await assert.rejects(reading, terminal ? /上游故障/ : /未发送结束标志/);
    assert.deepEqual([a.reasoning, a.content], ["旧思考\n\n想一想", "旧正文。"]);
  }
  const partial = await stream([" \n", "<th"], "旧正文。");
  assert.deepEqual([partial.reasoning, partial.content], ["", "旧正文。 \n<th"]);
});

test("整段拆开（旧消息、撮要）：同样跳过提到的标签", () => {
  assert.deepEqual({ ...f.parseInlineThink(`<think>${THOUGHT}</think>\n正文`) }, { reasoning: THOUGHT, content: "正文" });
  assert.equal(f.parseInlineThink("正文里说到 <think>"), null);
  assert.equal(f.thinkCloser("`</think>`"), -1);
  assert.equal(f.thinkCloser("</think>x", "`"), -1);
  assert.equal(f.thinkCloser("ab</think>", "", false), -1);
  assert.equal(f.thinkCloser("ab</think>", "", true), 2);
});
