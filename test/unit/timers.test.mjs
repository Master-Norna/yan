// 桥接的候 · 等时刻（server/timers.js）：到点落一回等页面来取、几页同时认领只一页拿到、等的时候跳过的不回、
// 周期排下一回、取消了与对话已删的不叫、重启后补叫并记迟了多久
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createTimers = createRequire(import.meta.url)("../../server/timers.js");

async function serve(home, known = id => id === "c1") {
  const { routes } = createTimers({ home: () => home, known });
  const server = http.createServer((req, res) => routes[`POST ${req.url}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  return { post, close: () => new Promise(resolve => server.close(resolve)) };
}
const soon = () => Date.now() + 150;
const settle = () => new Promise(resolve => setTimeout(resolve, 400));

test("到点：落一回等页面来取；两页同时认领只一页拿到", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-"));
  const { post, close } = await serve(home);
  try {
    await post("/api/timer/set", { to: "c1", step: "s1", note: "看一眼", due: soon() });
    await settle();
    const { fired } = await post("/api/timer/wait", {});
    assert.equal(fired.length, 1);
    assert.deepEqual([fired[0].to, fired[0].timer.step, fired[0].timer.note], ["c1", "s1", "看一眼"]);
    const [a, b] = await Promise.all([post("/api/timer/take", { ids: [fired[0].id] }), post("/api/timer/take", { ids: [fired[0].id] })]);
    assert.equal(a.fired.length + b.fired.length, 1);
    assert.equal(fs.readdirSync(path.join(home, "到点")).length, 0);
  } finally {
    await close();
  }
});

test("等着：跳过的那几回不回，新到点的一来就回", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-"));
  const { post, close } = await serve(home);
  try {
    await post("/api/timer/set", { to: "c1", step: "s1", note: "一", due: soon() });
    await settle();
    const first = (await post("/api/timer/wait", {})).fired[0];
    const waiting = post("/api/timer/wait", { skip: [first.id] });
    await post("/api/timer/set", { to: "c1", step: "s2", note: "二", due: soon() });
    const { fired } = await waiting;
    assert.deepEqual(
      fired.map(item => item.timer.note),
      ["二"]
    );
  } finally {
    await close();
  }
});

test("周期的排到下一回；取消了的不再叫；对话已删的连同周期一并撤去", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-"));
  const { post, close } = await serve(home);
  try {
    const every = await post("/api/timer/set", { to: "c1", step: "s2", note: "周期", due: soon(), every: 60000 });
    const gone = await post("/api/timer/set", { to: "c1", step: "s3", note: "取消的", due: soon() });
    await post("/api/timer/set", { to: "deleted", step: "s4", note: "对话已删", due: soon(), every: 60000 });
    assert.deepEqual([every.id, gone.id], ["t1", "t2"]);
    assert.equal((await post("/api/timer/cancel", { id: "t2" })).found, true);
    await settle();
    const { fired } = await post("/api/timer/wait", {});
    assert.deepEqual(
      fired.map(item => item.timer.id),
      ["t1"]
    );
    assert.ok(fired[0].timer.next > Date.now() + 50000, "周期的下一回排在一分钟后");
    const { timers: left } = await post("/api/timer/list", {});
    assert.deepEqual(
      left.map(timer => timer.id),
      ["t1"]
    );
  } finally {
    await close();
  }
});

test("桥接重启后读回，错过的当场补叫并记下迟了多久；编号接着往下数", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-"));
  fs.writeFileSync(
    path.join(home, "约.json"),
    JSON.stringify({ seq: 4, timers: [{ id: "t4", to: "c1", step: "s4", note: "早该叫了", due: Date.now() - 3600000, created: 0 }] })
  );
  const { post, close } = await serve(home);
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const { fired } = await post("/api/timer/wait", {});
    assert.equal(fired.length, 1);
    assert.ok(fired[0].timer.late >= 3600000);
    assert.equal((await post("/api/timer/set", { to: "c1", note: "下一个", due: Date.now() + 60000 })).id, "t5");
  } finally {
    await close();
  }
});

test("换了存储位置：读那边的约，不把这边的带过去盖掉", async () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-")),
    b = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-"));
  fs.writeFileSync(
    path.join(b, "约.json"),
    JSON.stringify({ seq: 7, timers: [{ id: "t7", to: "c1", step: "s7", note: "那边的", due: Date.now() + 3600000, created: 1 }] })
  );
  let home = a;
  const { routes } = createTimers({ home: () => home, known: () => true });
  const server = http.createServer((req, res) => routes[`POST ${req.url}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  try {
    await post("/api/timer/set", { to: "c1", step: "s1", note: "这边的", due: Date.now() + 3600000 });
    home = b;
    assert.deepEqual(
      (await post("/api/timer/list", {})).timers.map(timer => timer.note),
      ["那边的"]
    );
    assert.equal((await post("/api/timer/set", { to: "c1", step: "s8", note: "又一个", due: Date.now() + 3600000 })).id, "t8");
    home = a;
    assert.deepEqual(
      (await post("/api/timer/list", {})).timers.map(timer => timer.note),
      ["这边的"]
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
