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
    "historyForApi",
    `setup: () => {
      launchHelper = step => { step.sub = { id: "h" + step.id }; };
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

// 名字是拿来寻址的：下一答的行迹摘要（90-delegate.js 的 digest）原样写出 step.title。
// 摘要是模型唯一还看得见的名字——两个都顶到 40 字上限的同名帮手，摘要若照旧截 40 字，
// 「·2」就被切掉，两行又成了同一个名字，模型照摘要叫停、传话会命中原名那一位
test("两个顶到 40 字的同名帮手：下一问的行迹摘要仍分得清两个全名", async () => {
  const f = fixture(),
    base = "把仓库里所有测试跑一遍并把失败的用例整理成一份报告给我看看结果如何呢还有哪些没跑的".slice(0, 40),
    c = { id: "c", messages: [] },
    answer = { id: "m1", role: "assistant", content: "", steps: [] },
    first = { id: "s1", name: "delegate" },
    second = { id: "s2", name: "delegate" };
  assert.equal([...base].length, 40, "这一条要的正是顶到上限的标题");
  c.messages.push(answer);
  f.delegateInBackground(first, { title: base, task: "甲" }, { conversation: c });
  answer.steps.push(first);
  f.delegateInBackground(second, { title: base, task: "乙" }, { conversation: c });
  answer.steps.push(second);
  for (const step of [first, second]) {
    step.status = "done";
    step.result = "3 步 · 12 秒";
  }
  c.messages.push({ id: "u1", role: "user", content: "这两个各做到哪了？" });
  const history = await f.historyForApi(c.messages, "u1"),
    names = [...String(history.at(-1).content).matchAll(/差遣「([^」]*)」/g)].map(match => match[1]);
  assert.deepEqual(names, [first.title, second.title], "摘要里写的要就是按它寻址的名字");
  assert.notEqual(names[0], names[1], "两个名字不能都退回原名");
});
