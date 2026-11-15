import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const { wholeReplyEvents } = createRequire(import.meta.url)("../../server/model/sse.js");
const prompts = {};
new Function("window", readFileSync(new URL("../../prompts/assistant.js", import.meta.url), "utf8"))({ YAN_PROMPTS: prompts });
const conversation = (id, content = "你来继续推荐这个项目以及训练") => ({
  id,
  title: "原题",
  messages: [{ id: `user-${id}`, role: "user", content }]
});
const response = title =>
  new Response(wholeReplyEvents({ choices: [{ message: { content: title } }], usage: { total_tokens: 10 } }), {
    headers: { "content-type": "text/event-stream" }
  });

function titler(current, others, request) {
  const f = load([
    "maybeAutoTitle",
    `setup: (current, others, prompts, request) => {
      store.settings.autoTitle = true; store.conversations = [current, ...others];
      Object.assign(PROMPTS, prompts); requestChat = request;
      quotaExhausted = () => false;
      spendTokens = renderQuota = markDirty = saveStore = renderHistory = () => {};
    }`
  ]);
  f.setup(current, others, prompts, request);
  return f;
}

for (const withReply of [false, true])
  test(`拟题要求独立于问答素材（${withReply ? "收尾补拟" : "首问并行"}），不再把侧栏命名场景送给模型`, async () => {
    const current = conversation("winter", "冬意初临，炉火将红");
    if (withReply) current.messages.push({ id: "reply", role: "assistant", content: "窗上未霜，杯中先暖。", status: "complete" });
    let sent;
    const f = titler(current, [], async (_profile, messages, _signal, overrides) => {
      sent = { messages, overrides };
      return response("冬日炉火");
    });
    await f.maybeAutoTitle(current, { id: "model", systemPrompt: "主对话的角色设定" });
    assert.deepEqual(sent.messages, [
      { role: "user", content: "用户：冬意初临，炉火将红" + (withReply ? "\n\n助手：窗上未霜，杯中先暖。" : "") }
    ]);
    assert.equal(sent.overrides.systemPrompt, prompts.assistant.title);
    assert.match(sent.overrides.systemPrompt, /只输出题名/);
    assert.doesNotMatch(sent.overrides.systemPrompt, /侧栏|冬意|窗上|主对话的角色设定/);
    assert.equal(current.title, "冬日炉火");
    assert.equal(current.titled, true);
  });

test("确实讨论侧栏命名的对话仍可用这个题名，不靠黑名单过滤", async () => {
  const current = conversation("sidebar", "修改侧栏对话命名的逻辑");
  let ask;
  const f = titler(current, [], async (_profile, messages) => {
    ask = messages[0].content;
    return response("侧栏对话命名");
  });
  await f.maybeAutoTitle(current, { id: "model" });
  assert.equal(ask, "用户：修改侧栏对话命名的逻辑");
  assert.equal(current.title, "侧栏对话命名");
  assert.equal(current.titled, true);
});

test("拟题只据当前发送的内容，同项目及其他项目的手改题都不进入请求", async () => {
  const current = { ...conversation("training"), workdir: "E:\\项目\\Training", groupId: "train" };
  const others = [
    { ...conversation("music", "给音乐起名"), title: "山月", titleAuto: false, workdir: "E:\\项目\\天籁" },
    { ...conversation("same-project", "查看旧基线"), title: "旧基线的叫法", titleAuto: false, workdir: current.workdir, groupId: "train" }
  ];
  let ask;
  const f = titler(current, others, async (_profile, messages) => {
    ask = messages[0].content;
    return response("项目训练");
  });
  await f.maybeAutoTitle(current, { id: "model" });
  assert.match(ask, /你来继续推荐这个项目以及训练/);
  assert.doesNotMatch(ask, /山月|给音乐起名|旧基线|Training|train/);
  assert.equal(current.title, "项目训练");
  assert.equal(current.titled, true);
  assert.equal(current.titleTries, undefined);
});

test("首问之后补拟时，只带当前对话已完成的回答", async () => {
  const current = conversation("training");
  current.messages.push({ id: "reply", role: "assistant", content: "接续模型训练与基线验证", status: "complete" });
  const other = conversation("music", "创作山月");
  other.messages.push({ id: "other-reply", role: "assistant", content: "其他对话的音乐", status: "complete" });
  let ask;
  const f = titler(current, [other], async (_profile, messages) => {
    ask = messages[0].content;
    return response("模型训练");
  });
  await f.maybeAutoTitle(current, { id: "model" });
  assert.match(ask, /助手：接续模型训练与基线验证/);
  assert.doesNotMatch(ask, /山月|其他对话的音乐/);
  assert.equal(current.title, "模型训练");
});

test("只发附件时仍根据本次附件名字拟题", async () => {
  const current = conversation("attachment", "");
  current.messages[0].attachments = [{ name: "训练计划.pdf" }];
  let ask;
  const f = titler(current, [], async (_profile, messages) => {
    ask = messages[0].content;
    return response("训练计划");
  });
  await f.maybeAutoTitle(current, { id: "model" });
  assert.match(ask, /用户：训练计划.pdf/);
  assert.equal(current.title, "训练计划");
});

for (const change of ["content", "id", "attachment"])
  test(`拟题在途时${{ content: "首问同 id 原地变更", id: "首问换成另一个版本", attachment: "附件名字变更" }[change]}：旧题不写入，按新内容补拟`, async () => {
    const current = conversation("training", change === "attachment" ? "" : "接续训练"),
      requests = [];
    if (change === "attachment") current.messages[0].attachments = [{ name: "训练计划.pdf" }];
    let release;
    const held = new Promise(resolve => (release = resolve));
    const f = titler(current, [], async (_profile, messages) => {
      requests.push(messages[0].content);
      return requests.length === 1 ? held : response("新题");
    });
    const pending = f.maybeAutoTitle(current, { id: "model" });
    if (change === "content") current.messages[0].content = "总结项目文档";
    else if (change === "id") current.messages[0] = { id: "new-user", role: "user", content: "总结项目文档" };
    else current.messages[0].attachments[0].name = "项目文档.pdf";
    release(response("旧内容的题"));
    await pending;
    assert.equal(current.title, "原题");
    assert.notEqual(current.titled, true);
    for (let i = 0; i < 100 && !current.titled; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(requests.length, 2);
    assert.match(requests[1], /项目文档/);
    assert.equal(current.title, "新题");
    assert.equal(current.titled, true);
  });

test("拟题在途时用户亲手定题，自动回包不覆盖", async () => {
  const current = conversation("training");
  let release;
  const f = titler(current, [], () => new Promise(resolve => (release = resolve)));
  const pending = f.maybeAutoTitle(current, { id: "model" });
  current.title = "亲手定的模型训练";
  current.titleAuto = false;
  release(response("自动拟的题"));
  await pending;
  assert.equal(current.title, "亲手定的模型训练");
  assert.equal(current.titleAuto, false);
});
