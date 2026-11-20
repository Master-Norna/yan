// 帮手是按名字寻址的：helper 的传话、叫停、续派、翻看都按 args.helper 找那一名。差遣时标题只截前 40 字、不查重，
// 同一轮派两名「查日志」很自然，此后 find 只认得头一个——该停的没停、不该停的被停，话也递错人。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function fixture() {
  const f = load([
    "delegateInBackground",
    "uniqueHelperTitle",
    "crews",
    `setup: () => {
      launchHelper = () => {};
      PROMPTS.delegate = { started: "已开工：{{title}}" };
    }`
  ]);
  f.setup();
  return f;
}

const conversation = (...titles) => ({
  id: "c",
  messages: [
    {
      id: "m1",
      role: "assistant",
      steps: titles.map((title, index) => ({ id: `s${index}`, name: "delegate", title, sub: { id: `h${index}` } }))
    }
  ]
});

test("没撞名：照原样用", () => {
  const f = fixture();
  assert.equal(f.uniqueHelperTitle(conversation("查日志"), "跑测试"), "跑测试");
});

test("撞上已经收工的那一趟：补序号，回执里说得明白", () => {
  const f = fixture(),
    c = conversation("查日志"),
    step = { id: "s9", name: "delegate" };
  const outcome = f.delegateInBackground(step, { title: "查日志", task: "再查一遍" }, { conversation: c });
  assert.equal(step.title, "查日志·2");
  assert.match(outcome.content, /查日志·2/);
});

test("撞上正在做的那一名、也撞上·2：顺次往后补", () => {
  const f = fixture(),
    c = conversation("查日志", "查日志·2"),
    step = { id: "s9", name: "delegate" };
  f.crews.set("c", [{ title: "查日志·3", step: { id: "live" } }]);
  f.delegateInBackground(step, { title: "查日志", task: "再来一遍" }, { conversation: c });
  assert.equal(step.title, "查日志·4");
});

test("没给标题的按任务开头取名，同样不撞", () => {
  const f = fixture(),
    c = conversation("整理这份周报"),
    step = { id: "s9", name: "delegate" };
  f.delegateInBackground(step, { task: "整理这份周报" }, { conversation: c });
  assert.equal(step.title, "整理这份周报·2");
});
