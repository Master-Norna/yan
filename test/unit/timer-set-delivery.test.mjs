import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import createTimers from "../../server/timers.js";

// 响应替身：done 是桥接写完（页面可能已收到），cut 是没写完就断开（回执送不到页面）
function fakeResponse() {
  const res = new EventEmitter();
  res.writableEnded = res.writableFinished = res.destroyed = false;
  res.done = () => {
    res.writableEnded = res.writableFinished = true;
    res.emit("finish");
  };
  res.cut = () => {
    res.destroyed = true;
    res.emit("close");
  };
  return res;
}

function makeBook(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-set-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { routes } = createTimers({ home: () => dir, known: () => true, route: handle => handle });
  return { dir, routes };
}

const saved = dir => JSON.parse(fs.readFileSync(path.join(dir, "约.json"), "utf8")).timers;

test("设约的回执没送达：这一约当即撤去，簿上不留", t => {
  const { dir, routes } = makeBook(t),
    res = fakeResponse();
  const timer = routes["POST /api/timer/set"]({ to: "chat", step: "s1", note: "看看", due: Date.now() + 60000 }, null, res);
  assert.equal(timer.id, "t1");
  res.cut();
  assert.deepEqual(routes["POST /api/timer/list"]({}), { timers: [] });
  assert.deepEqual(saved(dir), [], "撤约要写回约簿，别只在内存里撤");
});

test("设约的回执送到了：约照旧留着", t => {
  const { dir, routes } = makeBook(t),
    res = fakeResponse();
  routes["POST /api/timer/set"]({ to: "chat", step: "s1", note: "看看", due: Date.now() + 60000 }, null, res);
  res.done();
  assert.deepEqual(
    routes["POST /api/timer/list"]({}).timers.map(item => item.id),
    ["t1"]
  );
  assert.equal(saved(dir).length, 1);
});

test("只撤没送到的那一条：同一对话另约的照旧，编号接着往下数", t => {
  const { routes } = makeBook(t),
    cut = fakeResponse(),
    kept = fakeResponse();
  routes["POST /api/timer/set"]({ to: "chat", step: "s1", note: "甲", due: Date.now() + 60000 }, null, cut);
  const second = routes["POST /api/timer/set"]({ to: "chat", step: "s2", note: "乙", due: Date.now() + 120000 }, null, kept);
  cut.cut();
  kept.done();
  assert.deepEqual(
    routes["POST /api/timer/list"]({}).timers.map(item => [item.id, item.note]),
    [[second.id, "乙"]]
  );
  assert.equal(second.id, "t2");
});

test("回执没送达而已到点落盘：那一回也清掉，周期不再排", t => {
  const { dir, routes } = makeBook(t),
    res = fakeResponse();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  routes["POST /api/timer/set"]({ to: "chat", step: "s1", note: "看看", due: Date.now() + 1000, every: 60000 }, null, res);
  t.mock.timers.tick(1000);
  const fired = path.join(dir, "到点");
  assert.equal(fs.readdirSync(fired).filter(name => name.endsWith(".json")).length, 1, "先到点落了一回");
  res.cut();
  assert.deepEqual(routes["POST /api/timer/list"]({}), { timers: [] }, "周期的下一回也要撤");
  assert.deepEqual(fs.readdirSync(fired), [], "页面不知道编号，那一回谁也领不走，留着只是垃圾");
});

test("编号没到手时按对话与步骤撤：只撤那一步骤上的，别的对话与别的步骤照旧", t => {
  const { routes } = makeBook(t),
    kept = fakeResponse(),
    target = fakeResponse(),
    other = fakeResponse(),
    later = fakeResponse();
  routes["POST /api/timer/set"]({ to: "chat", step: "s0", note: "甲", due: Date.now() + 60000 }, null, kept);
  routes["POST /api/timer/set"]({ to: "chat", step: "s1", note: "乙", due: Date.now() + 60000 }, null, target);
  routes["POST /api/timer/set"]({ to: "别的对话", step: "s1", note: "丙", due: Date.now() + 60000 }, null, other);
  for (const res of [kept, target, other]) res.done();
  assert.deepEqual(routes["POST /api/timer/cancel"]({ to: "chat", step: "s1" }).found, true);
  assert.deepEqual(
    routes["POST /api/timer/list"]({}).timers.map(item => item.note),
    ["甲", "丙"],
    "同一步骤只撤那一条，别的对话里同名步骤不动"
  );
  // 撤过再补一句（页面补偿可能重发）：什么也不撤，也不报错
  assert.deepEqual(routes["POST /api/timer/cancel"]({ to: "chat", step: "s1" }), { found: false });
  // 同一步骤后又设了一条：撤的是最近那一条
  routes["POST /api/timer/set"]({ to: "chat", step: "s1", note: "丁", due: Date.now() + 90000 }, null, later);
  later.done();
  routes["POST /api/timer/cancel"]({ to: "chat", step: "s1" });
  assert.deepEqual(
    routes["POST /api/timer/list"]({}).timers.map(item => item.note),
    ["甲", "丙"]
  );
});
