import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createUsage = createRequire(import.meta.url)("../../server/usage.js");

test("用量批次 ACK 丢失后重试，不重复记账；重启后仍去重", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-usage-idempotency-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "usage.json");
  let usage = createUsage({ file: () => file });
  const server = http.createServer((req, res) => usage.routes[`POST ${req.url}`](req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (endpoint, body = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/usage/${endpoint}`, {
    method: "POST", body: JSON.stringify(body)
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
