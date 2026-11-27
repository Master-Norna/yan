import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import createUsage from "../../server/usage.js";

test("malformed usage entries do not discard valid coalesced entries", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-usage-"));
  const usage = createUsage({ file: () => path.join(dir, "usage.json") });
  const server = http.createServer((req, res) => usage.routes[`POST ${req.url}`](req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const post = (route, body) => fetch(`http://127.0.0.1:${server.address().port}/api/usage/${route}`, { method: "POST", body: JSON.stringify(body) });
  const day = "2026-01-01";
  const responses = await Promise.all([post("add", { batchId: "bad", items: [null, { day, kind: "main", amount: { toString: 0 } }, { day, kind: "main", amount: 7 }] }), post("add", { batchId: "good", items: [{ day, kind: "main", amount: 11 }] })]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  await Promise.all(responses.map(response => response.json()));
  assert.equal((await (await post("read", {})).json()).days[day].main, 18);
  assert.equal((await post("add", null)).status, 400);
});
