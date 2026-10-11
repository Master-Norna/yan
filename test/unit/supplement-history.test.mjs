// 一答的投影：往后每一问里，上一答途中递进来的话（补言、回报）按到达的位置还原成一句用户的话，不再折成一行冠在下一问头上；
// 递上与往后重装经同一个 replay，一字不差
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const f = load(["historyForApi", "answerParts", "answerForApi", "stepsDigest", "keptImageQuestion", "deliverSupplements", "PROMPTS"]);
{
  const win = { YAN_PROMPTS: {} };
  const req = createRequire(import.meta.url);
  for (const file of ["assistant.js", "tools.js"]) new Function("window", readFileSync(req.resolve(`../../prompts/${file}`), "utf8"))(win);
  Object.assign(f.PROMPTS, win.YAN_PROMPTS);
}
const text = content => (typeof content === "string" ? content : content[0].text);

test("上一答里的「不用了我来」留在上一答里，不冠到下一问头上", async () => {
  const before = "先改了 a.js。";
  const source = [
    { id: "u1", role: "user", content: "把三处都改了", timestamp: "" },
    {
      id: "a1",
      role: "assistant",
      content: `${before}\n\n好的，剩下的交给你。`,
      timestamp: "",
      steps: [
        { id: "s1", name: "edit_file", arguments: "{}", status: "done", title: "a.js", result: "已改", at: 0 },
        { id: "n1", name: "user_note", arguments: "{}", status: "done", note: "不需要了我来吧", at: before.length }
      ]
    },
    { id: "u2", role: "user", content: "那你去继续推进下一个", timestamp: "" }
  ];
  const history = await f.historyForApi(source, "u2", 24000);
  assert.deepEqual(
    history.map(m => m.role),
    ["user", "assistant", "user", "assistant", "user"]
  );
  assert.equal(history[1].content, before);
  assert.match(text(history[2].content), /作答途中用户补充.*不需要了我来吧/s);
  assert.equal(history[3].content, "好的，剩下的交给你。");
  // 下一问只冠上一答的行迹，补言不在里面
  assert.ok(text(history[4].content).endsWith("那你去继续推进下一个"));
  assert.ok(!text(history[4].content).includes("不需要了我来吧"));
});

test("没递出去的补言不进历史；没有补言的一答原样", () => {
  const plain = { id: "a", role: "assistant", content: "答", timestamp: "" };
  assert.deepEqual(f.answerParts(plain), [{ role: "assistant", content: "答" }]);
  const pending = { ...plain, steps: [{ id: "n", name: "user_note", arguments: "{}", status: "running", note: "等等", at: 0 }] };
  assert.deepEqual(f.answerParts(pending), [{ role: "assistant", content: "答" }]);
});

test("补言落在答的开头：前面不留空的助手消息", () => {
  const message = {
    id: "a",
    role: "assistant",
    content: "改道后的答",
    timestamp: "",
    steps: [{ id: "n", name: "user_note", arguments: "{}", status: "done", note: "换个思路", at: 0 }]
  };
  assert.deepEqual(
    f.answerParts(message).map(part => part.role),
    ["user", "assistant"]
  );
});

test("补言摊开全文时题头不再重复第一行；一句短话只占题头", () => {
  const { noteStepHtml } = load(["noteStepHtml"]);
  const count = (html, text) => html.split(text).length - 1;
  const long = noteStepHtml({ id: "n", name: "user_note", arguments: "{}", status: "done", note: "先停一下\n换成另一种做法，理由如下" });
  assert.equal(count(long.replace(/title="[^"]*"/g, ""), "先停一下"), 1);
  const withFile = noteStepHtml({
    id: "n",
    name: "user_note",
    arguments: "{}",
    status: "done",
    note: "看这张图",
    attachments: [{ name: "a.png" }]
  });
  assert.equal(count(withFile.replace(/title="[^"]*"/g, ""), "看这张图"), 1);
  const short = noteStepHtml({ id: "n", name: "user_note", arguments: "{}", status: "done", note: "换个思路" });
  assert.match(short, /class="tool-title"[^>]*>换个思路</);
  assert.ok(!short.includes("tool-note"));
});

test("作答途中递上的回报：往后重装这一答插回原处，与当时递上的一字不差", async () => {
  const report = "帮手「查三家框架」回报：推荐 B，A 不支持流式。";
  const assistant = { id: "a1", role: "assistant", content: "先派人去查。", timestamp: "", steps: [] };
  const note = { id: "r1", name: "relay_note", arguments: "{}", status: "running", title: "查三家框架", at: 0 };
  assistant.steps.push(note);
  const history = [];
  await f.deliverSupplements({ queue: [{ report, step: {}, note }] }, history, 24000, assistant);
  assert.deepEqual(history, [{ role: "user", content: report }]);
  assert.equal(note.report, report);
  assert.equal(note.at, "先派人去查。".length);
  assistant.content += "\n\n就用 B。";
  const replayed = await f.answerForApi(assistant, 24000);
  assert.deepEqual(replayed, [
    { role: "assistant", content: "先派人去查。" },
    { role: "user", content: report },
    { role: "assistant", content: "就用 B。" }
  ]);
});

test("早先存下、没记原话的回报：这一答原样一条，前文不变", () => {
  const message = {
    id: "a",
    role: "assistant",
    content: "前半。后半。",
    timestamp: "",
    steps: [{ id: "r", name: "relay_note", arguments: "{}", status: "done", at: 3 }]
  };
  assert.deepEqual(f.answerParts(message), [{ role: "assistant", content: "前半。后半。" }]);
});

test("补言递上与往后重装同一个写法：停在句尾递上的，重装时仍是那句前缀", async () => {
  const assistant = { id: "a", role: "assistant", content: "写到一半。", timestamp: "", steps: [] };
  const step = { id: "n", name: "user_note", arguments: "{}", status: "running", note: "换个思路", at: 2 };
  assistant.steps.push(step);
  const history = [];
  const user = { id: "u", role: "user", content: "换个思路", timestamp: "" };
  await f.deliverSupplements({ queue: [{ user, step }] }, history, 24000, assistant, { steer: true });
  assistant.content += "\n\n换了。";
  const replayed = await f.answerForApi(assistant, 24000);
  assert.deepEqual(replayed[1], history[0]);
  assert.match(history[0].content, /写到此处暂停.*换个思路/s);
});

test("帮手时间线上的传话：那一步挪到帮手自己正文的落点，不是主答的", async () => {
  const host = { id: "a", role: "assistant", content: "主答已经写了很长一段话。", timestamp: "", steps: [] };
  const sub = { id: "s", content: "帮手写的", reasoning: "", steps: [] };
  const note = { id: "h", name: "helper_note", arguments: "{}", status: "running", note: "顺便看下 b", at: 0 };
  sub.steps.push(note);
  await f.deliverSupplements({ queue: [{ report: "主模型传话：顺便看下 b", note }] }, [], undefined, host, { target: sub });
  assert.equal(note.at, "帮手写的".length);
  assert.equal(note.report, "主模型传话：顺便看下 b");
});

test("行迹摘要步数多了留头留尾：末尾做到哪不丢", () => {
  const steps = Array.from({ length: 30 }, (_, i) => ({
    id: `s${i}`,
    name: "run_command",
    arguments: "{}",
    status: "done",
    title: `第${i}步`,
    result: "好"
  }));
  const text = f.stepsDigest({ steps });
  assert.match(text, /第0步/);
  assert.match(text, /第3步/);
  assert.ok(!text.includes("第4步 "));
  assert.match(text, /中间 14 步从略/);
  assert.match(text, /第29步/);
  assert.match(text, /第18步/);
});

test("用户发的图只留最新的一批：这一问之外，最近带图的那一问", () => {
  const img = { id: "f", kind: "image", name: "a.png", size: 1 };
  const source = [
    { id: "u1", role: "user", content: "看图一", attachments: [img] },
    { id: "a1", role: "assistant", content: "好" },
    { id: "u2", role: "user", content: "看图二", attachments: [img] },
    { id: "a2", role: "assistant", content: "好" },
    { id: "u3", role: "user", content: "左下角是什么" },
    { id: "a3", role: "assistant", content: "好" },
    { id: "u4", role: "user", content: "再说说" }
  ];
  assert.equal(f.keptImageQuestion(source, "u4"), "u2");
  assert.equal(f.keptImageQuestion(source, "u2"), "u1");
  assert.equal(f.keptImageQuestion(source.slice(0, 1), "u1"), "");
});
