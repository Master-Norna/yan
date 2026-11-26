import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import createTimers from "../../server/timers.js";

test("structurally corrupt timer book never crashes startup or overwrites the original", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-book-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "约.json");
  const valid = { id: "t1", to: "chat", step: "", note: "", created: Date.now(), due: Date.now() + 60000 };
  for (const bad of [null, { ...valid, due: "invalid" }, { ...valid, every: -1 }]) {
    const original = JSON.stringify({ seq: 1, timers: [bad] });
    fs.writeFileSync(file, original);
    const { routes } = createTimers({ home: () => dir, known: () => true, route: handle => handle });
    assert.throws(() => routes["POST /api/timer/list"]({}), /约簿损坏/);
    assert.throws(() => routes["POST /api/timer/set"]({ to: "chat", due: Date.now() }), /约簿损坏/);
    assert.equal(fs.readFileSync(file, "utf8"), original);
    fs.writeFileSync(file, JSON.stringify({ seq: 1, timers: [] }));
    assert.deepEqual(routes["POST /api/timer/list"]({}), { timers: [] });
  }
});

test("坏约簿不让多页互相叫醒；换根结束旧等待，修复后恢复排程", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-wait-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const bad = JSON.stringify({ seq: 1, timers: [null] });
  for (const name of ["a", "b"]) {
    const scope = path.join(dir, name);
    fs.mkdirSync(scope);
    fs.writeFileSync(path.join(scope, "约.json"), bad);
  }
  let home = path.join(dir, "a");
  const { routes } = createTimers({ home: () => home, known: () => true, route: handle => handle }),
    wait = () => routes["POST /api/timer/wait"]({}, null, new EventEmitter()),
    pending = Symbol("仍在长等"),
    result = async response => {
      // 只让已唤醒的路由完成，不推进假时钟。
      await new Promise(resolve => setImmediate(resolve));
      return Promise.race([response, pending]);
    };

  const firstA = wait();
  t.mock.timers.tick(1);
  const firstB = wait();
  assert.equal(await result(firstA), pending, "B 开始等不能让 A 立即空回");
  t.mock.timers.tick(59999);
  assert.deepEqual(await result(firstA), { fired: [] });
  const secondA = wait();
  assert.equal(await result(firstB), pending, "A 等满续等不能让 B 提早空回");
  t.mock.timers.tick(1);
  assert.deepEqual(await result(firstB), { fired: [] });
  assert.equal(await result(secondA), pending);

  home = path.join(dir, "b");
  const secondB = wait();
  assert.deepEqual(await result(secondA), { fired: [] }, "换到另一份坏簿也要解除旧根的等待");
  assert.equal(await result(secondB), pending);

  const restored = { id: "t1", to: "chat", due: Date.now() + 100 };
  fs.writeFileSync(path.join(home, "约.json"), JSON.stringify({ seq: 1, timers: [restored] }));
  const afterRepair = wait();
  assert.equal(await result(afterRepair), pending);
  t.mock.timers.tick(100);
  const { fired } = await result(afterRepair);
  assert.deepEqual(
    fired?.map(item => [item.to, item.timer.id, item.timer.due]),
    [[restored.to, restored.id, restored.due]]
  );
});
