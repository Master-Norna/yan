// 用假时钟驱动实盘约簿和收件箱；故障只注入每项自建的临时目录，不靠权限位或固定等待。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const createTimers = createRequire(import.meta.url)("../../server/timers.js");
const start = 1_700_000_000_000;
const retry = 5000;

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-retry-")),
    outbox = path.join(home, "到点"),
    bookFile = path.join(home, "约.json");
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const logs = t.mock.method(console, "warn", () => {});
  const boot = (now = start) => {
    t.mock.timers.reset();
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
    const { routes } = createTimers({ home: () => home, known: () => true, route: handle => handle });
    return (action, body = {}) => routes[`POST /api/timer/${action}`](body);
  };
  const names = () => (fs.existsSync(outbox) ? fs.readdirSync(outbox) : []);
  const pending = () =>
    names()
      .filter(name => name.endsWith(".json"))
      .map(name => JSON.parse(fs.readFileSync(path.join(outbox, name), "utf8")));
  const book = () => JSON.parse(fs.readFileSync(bookFile, "utf8"));
  const tick = ms => t.mock.timers.tick(ms);
  return { boot, names, pending, book, bookFile, outbox, logs, tick };
}

const fault = () => Object.assign(Error("模拟原子替换失败"), { code: "EIO" });

test("首约投递两次失败：原约和 due 保留，同批及后续的约先投，无需新建约即恢复", t => {
  const { boot, tick, pending, book, outbox, logs } = fixture(t),
    call = boot();
  const first = call("set", { to: "c", due: start + 100 });
  const peer = call("set", { to: "c", due: start + 100 });
  const later = call("set", { to: "c", due: start + 200 });
  const rename = fs.renameSync,
    read = fs.readFileSync,
    attempts = [];
  let blocked = true;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (path.dirname(to) === outbox && to.endsWith(".json") && JSON.parse(read(from, "utf8")).timer.id === first.id) {
      attempts.push(Date.now());
      if (blocked) throw fault();
    }
    return rename(from, to);
  });

  tick(100);
  assert.deepEqual(book().timers, [first, later]);
  assert.deepEqual(
    pending().map(item => item.timer.id),
    [peer.id]
  );
  tick(100);
  assert.deepEqual(book().timers, [first]);
  assert.deepEqual(
    pending()
      .map(item => item.timer.id)
      .sort(),
    [peer.id, later.id]
  );
  tick(retry - 101);
  assert.deepEqual(attempts, [first.due]);
  tick(1);
  assert.deepEqual(attempts, [first.due, first.due + retry]);
  assert.deepEqual(book().timers, [first]);
  assert.equal(logs.mock.callCount(), 1);
  blocked = false;
  tick(retry);
  assert.deepEqual(attempts, [first.due, first.due + retry, first.due + retry * 2]);
  assert.deepEqual(book().timers, []);
  const recovered = pending().find(item => item.timer.id === first.id);
  assert.equal(recovered.timer.due, first.due);
  assert.equal(recovered.timer.late, retry * 2);
});

test("周期首次投递失败：不先推进；恢复时只补一回并排到原周期的下一格", t => {
  const { boot, tick, pending, book, outbox } = fixture(t),
    call = boot(),
    timer = call("set", { to: "c", due: start + 100, every: 1000 });
  fs.writeFileSync(outbox, "暂时不能作目录");
  tick(100);
  assert.deepEqual(book().timers, [timer]);
  fs.unlinkSync(outbox);
  tick(retry);
  const [first, ...extra] = pending();
  assert.deepEqual(extra, []);
  assert.equal(first.timer.due, timer.due);
  assert.equal(first.timer.late, retry);
  assert.equal(first.timer.next, timer.due + 6000);
  assert.deepEqual(book().timers, [{ ...timer, due: first.timer.next }]);
  assert.equal(call("take", { ids: [first.id] }).fired.length, 1);
  tick(999);
  assert.deepEqual(pending(), []);
  tick(1);
  const [next] = pending();
  assert.equal(next.timer.due, first.timer.next);
  assert.notEqual(next.id, first.id);
});

for (const claimed of [false, true])
  test(`投递成功但约簿保存失败：重启不重投${claimed ? "已经认领" : "尚未认领"}的那一回`, t => {
    const { boot, tick, pending, book, bookFile, names } = fixture(t);
    let call = boot();
    const timer = call("set", { to: "c", due: start + 100, every: 20000 });
    const later = call("set", { to: "c", due: start + 200 });
    const rename = fs.renameSync;
    let blocked = true;
    t.mock.method(fs, "renameSync", (from, to) => {
      if (blocked && to === bookFile) throw fault();
      return rename(from, to);
    });
    tick(100);
    const [first] = pending();
    assert.equal(first.timer.next, timer.due + timer.every);
    assert.deepEqual(book().timers, [timer, later]);
    const next = { ...timer, due: first.timer.next };
    assert.deepEqual(call("list").timers, [next, later]);
    if (claimed) {
      assert.deepEqual(call("take", { ids: [first.id, first.id] }).fired, [first]);
      assert.deepEqual(pending(), []);
      assert.deepEqual(names(), [`${first.id}.json.taken`]);
    }
    // 约簿仍写不成，后续独立的约也能进收件箱。
    tick(100);
    const second = pending().find(item => item.timer.id === later.id);
    assert.ok(second);
    assert.deepEqual(call("list").timers, [next]);
    assert.deepEqual(call("cancel", { id: later.id }), { found: false });
    blocked = false;
    call = boot(Date.now()); // 丢掉内存状态与排期，只读回临时目录里的约簿及收件。
    assert.deepEqual(call("list").timers, [next]);
    tick(1);
    assert.deepEqual(
      pending().sort((a, b) => a.at - b.at),
      claimed ? [second] : [first, second]
    );
    assert.deepEqual(book().timers, [{ ...timer, due: first.timer.next }]);
    assert.ok(names().every(name => !name.endsWith(".taken")));
    assert.deepEqual(call("take", { ids: [first.id] }).fired, claimed ? [] : [first]);
    assert.deepEqual(call("take", { ids: [second.id] }).fired, [second]);
    tick(first.timer.next - Date.now());
    assert.equal(pending().length, 1);
    assert.equal(pending()[0].timer.due, first.timer.next);
    assert.notEqual(pending()[0].id, first.id);
  });

test("周期回执已认领、写簿跨过数个周期：先按原回执续排，其后迟到的只补一回", t => {
  const { boot, tick, pending, book, bookFile } = fixture(t),
    call = boot(),
    timer = call("set", { to: "c", due: start + 100, every: 1000 });
  const rename = fs.renameSync;
  let blocked = true;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (blocked && to === bookFile) throw fault();
    return rename(from, to);
  });
  tick(100);
  const [first] = pending();
  call("take", { ids: [first.id] });
  tick(retry);
  assert.deepEqual(pending(), []);
  assert.equal(call("list").timers[0].due, first.timer.next);
  blocked = false;
  tick(retry);
  tick(1);
  const [second, ...extra] = pending();
  assert.deepEqual(extra, []);
  assert.equal(second.timer.due, first.timer.next);
  assert.equal(second.timer.next, timer.due + 11000);
  assert.equal(book().timers[0].due, second.timer.next);
});

for (const field of ["created", "to"])
  test(`重建约簿后复用编号和 due：${field} 不同仍是新的一回`, t => {
    const { boot, tick, pending, bookFile } = fixture(t);
    let call = boot();
    const due = start + 100,
      old = call("set", { to: "old", due });
    tick(100);
    const [first] = pending();
    fs.writeFileSync(bookFile, JSON.stringify({ seq: 0, timers: [] }));
    call = boot(field === "created" ? start + 1 : start);
    const timer = call("set", { to: field === "to" ? "new" : "old", due });
    assert.equal(timer.id, old.id);
    tick(due - Date.now());
    const second = pending().find(item => item.id !== first.id);
    assert.equal(pending().length, 2);
    assert.equal(second.to, timer.to);
    assert.equal(second.timer.due, due);
  });

test("设置和取消写簿失败：不消耗编号、不改变活排期，失败的取消仍会到点", t => {
  const { boot, tick, pending, book, bookFile } = fixture(t),
    call = boot(),
    timer = call("set", { to: "c", due: start + 100 });
  const rename = fs.renameSync;
  let blocked = true;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (blocked && to === bookFile) throw fault();
    return rename(from, to);
  });
  assert.throws(() => call("set", { to: "c", due: start + 50 }), /模拟原子替换失败/);
  assert.throws(() => call("cancel", { id: timer.id }), /模拟原子替换失败/);
  assert.deepEqual(call("list").timers, [timer]);
  assert.deepEqual(book().timers, [timer]);
  blocked = false;
  assert.equal(call("set", { to: "c", due: start + 1000 }).id, "t2");
  tick(100);
  assert.deepEqual(
    pending().map(item => item.timer.id),
    [timer.id]
  );
});

test("约簿损坏时不当成空簿覆盖，修好文件后可恢复使用", t => {
  const { boot, bookFile, tick } = fixture(t);
  const bad = "{bad json";
  fs.writeFileSync(bookFile, bad);
  const call = boot();
  assert.throws(() => call("list"), /约簿损坏/);
  assert.throws(() => call("set", { to: "c", due: start + 100 }), /约簿损坏/);
  assert.equal(fs.readFileSync(bookFile, "utf8"), bad, "损坏原件必须保留给人工恢复");
  fs.writeFileSync(bookFile, JSON.stringify({ seq: 0, timers: [] }));
  assert.deepEqual(call("list").timers, []);
  call("set", { to: "c", due: start + 100 });
  tick(100);
  assert.equal(call("take", { ids: [] }).fired.length, 0);
});

test("桥接读入正常约簿后被外部改坏，下一次保存也拒绝覆盖", t => {
  const { boot, bookFile } = fixture(t);
  const call = boot();
  call("set", { to: "c", due: start + 1000 });
  fs.writeFileSync(bookFile, "{truncated");
  assert.throws(() => call("set", { to: "c", due: start + 2000 }), /约簿损坏/);
  assert.equal(fs.readFileSync(bookFile, "utf8"), "{truncated");
  const restored = { seq: 10, timers: [{ id: "restored-id", to: "c", due: start + 4000 }] };
  fs.writeFileSync(bookFile, JSON.stringify(restored));
  assert.deepEqual(call("list").timers, restored.timers, "修复磁盘簿后应读取已恢复的排期");
  call("set", { to: "c", due: start + 5000 });
  assert.equal(JSON.parse(fs.readFileSync(bookFile, "utf8")).timers[0].id, "restored-id", "不得用旧缓存覆盖恢复出的约");
});

test("合法 JSON 但 timers 不是数组时也要保留损坏约簿", t => {
  const { boot, bookFile } = fixture(t);
  const invalid = JSON.stringify({ seq: 7, timers: { unexpected: true } });
  fs.writeFileSync(bookFile, invalid);
  const call = boot();
  assert.throws(() => call("list"), /约簿损坏/);
  assert.throws(() => call("cancel", { id: "t1" }), /约簿损坏/);
  assert.equal(fs.readFileSync(bookFile, "utf8"), invalid);
});


test("约簿损坏仍可领取已经投递的消息，并保留认领凭据直到约簿恢复", async t => {
  const { boot, bookFile, tick, pending, names } = fixture(t);
  const call = boot();
  call("set", { to: "c", due: start + 100, every: 1000 });
  tick(100);
  const [notice] = pending();
  assert.ok(notice);
  fs.writeFileSync(bookFile, "{broken");
  assert.throws(() => call("set", { to: "c", due: start + 2000 }), /约簿损坏/);
  const waited = await call("wait", {});
  assert.deepEqual(waited.fired, [notice], "约簿损坏时 wait 仍能读到落盘的通知");
  assert.deepEqual(call("take", { ids: [notice.id] }).fired, [notice]);
  assert.ok(names().includes(`${notice.id}.json.taken`), "簿损坏时不能丢弃可能用于去重的认领凭据");
  assert.equal(fs.readFileSync(bookFile, "utf8"), "{broken");
  // 恢复簿后重新核对，才可清理已退休的凭据。
  fs.writeFileSync(bookFile, JSON.stringify({ seq: 1, timers: [] }));
  assert.deepEqual(call("list").timers, []);
  assert.ok(!names().includes(`${notice.id}.json.taken`));
});


test("刚启动时约簿正常、随后无写操作直接损坏：领取仍保留去重凭据", t => {
  const { boot, bookFile, tick, pending, names } = fixture(t);
  const call = boot();
  call("set", { to: "c", due: start + 100, every: 1000 });
  tick(100);
  const [notice] = pending();
  fs.writeFileSync(bookFile, "{external damage");
  assert.deepEqual(call("take", { ids: [notice.id] }).fired, [notice]);
  assert.ok(names().includes(`${notice.id}.json.taken`), "旧内存簿不能决定已损坏约簿的回执是否可清");
});
