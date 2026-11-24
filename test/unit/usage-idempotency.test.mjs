import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const createUsage = createRequire(import.meta.url)("../../server/usage.js");

test("用量批次 ACK 丢失后重试，不重复记账；重启后仍去重", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-usage-idempotency-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "usage.json");
  let usage = createUsage({ file: () => file });
  const server = http.createServer((req, res) => usage.routes[`POST ${req.url}`](req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (endpoint, body = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/usage/${endpoint}`, {
      method: "POST",
      body: JSON.stringify(body)
    }).then(r => r.json());
  const batch = { batchId: "fixed-batch-1", items: [{ day: "2026-11-22", kind: "main", amount: 1200 }] };
  assert.equal((await post("add", batch)).ok, true);
  assert.equal((await post("add", batch)).duplicate, true);
  assert.equal((await post("read")).days["2026-11-22"].main, 1200);
  usage = createUsage({ file: () => file });
  assert.equal((await post("add", batch)).duplicate, true);
  assert.equal((await post("read")).days["2026-11-22"].main, 1200);
  await post("add", { ...batch, batchId: "fixed-batch-2" });
  assert.equal((await post("read")).days["2026-11-22"].main, 2400);
});

test("同时到达的用量批次合并写盘，重复批次只计一次；换根不串账", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-usage-batch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let target = path.join(root, "first.json");
  const usage = createUsage({ file: () => target });
  const server = http.createServer((req, res) => usage.routes[`POST ${req.url}`](req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = body =>
    fetch(`http://127.0.0.1:${server.address().port}/api/usage/add`, {
      method: "POST",
      body: JSON.stringify(body)
    }).then(r => r.json());
  const batch = id => ({ batchId: id, items: [{ day: "2026-11-22", kind: "main", amount: 10 }] });
  const results = await Promise.all([post(batch("a")), post(batch("a")), post(batch("b"))]);
  assert.equal(results.filter(item => item.duplicate).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).days["2026-11-22"].main, 20);
  target = path.join(root, "second.json");
  await post(batch("a"));
  assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).days["2026-11-22"].main, 10);
  fs.writeFileSync(target, "{broken");
  const rejected = await post(batch("b"));
  assert.ok(rejected.error);
  assert.equal(fs.readFileSync(target, "utf8"), "{broken");
});

test("搬家复制前冲刷待写批次，回执与用量一同搬过去", async t => {
  const createStore = createRequire(import.meta.url)("../../server/store.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-usage-move-"));
  const previous = process.env.YAN_HOME;
  process.env.YAN_HOME = path.join(root, "old");
  t.after(() => {
    if (previous === undefined) delete process.env.YAN_HOME;
    else process.env.YAN_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const store = createStore({ beforeMove: () => usage.flush() });
  const usage = createUsage({ file: () => path.join(store.paths().root, "用量.json") });
  // 不靠网络时序：用量请求已读完并进入合批等待，立刻在同一拍搬家。
  const invoke = (handler, body) =>
    new Promise(resolve => {
      const req = new EventEmitter();
      const res = {
        writeHead(status) {
          this.status = status;
        },
        end(text) {
          resolve({ status: this.status, data: JSON.parse(text) });
        }
      };
      void handler(req, res);
      req.emit("data", Buffer.from(JSON.stringify(body)));
      req.emit("end");
    });
  const add = usage.routes["POST /api/usage/add"];
  const batch = { batchId: "move-batch", items: [{ day: "2026-11-22", kind: "main", amount: 23 }] };
  const queued = invoke(add, batch);
  const moved = await invoke(store.routes["POST /api/store/move"], { parent: path.join(root, "new") });
  assert.equal(moved.status, 200);
  assert.equal((await queued).data.ok, true);
  assert.equal((await invoke(add, batch)).data.duplicate, true);
  const read = await invoke(usage.routes["POST /api/usage/read"], {});
  assert.equal(read.data.days["2026-11-22"].main, 23);
});
