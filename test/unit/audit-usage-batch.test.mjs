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
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const post = (route, body) => {
    const url = `http://127.0.0.1:${server.address().port}/api/usage/${route}`;
    return fetch(url, { method: "POST", body: JSON.stringify(body) });
  };
  const day = "2026-01-01";
  const invalid = { day, kind: "main", amount: { toString: 0 } };
  const valid = { day, kind: "main", amount: 7 };
  const bad = { batchId: "bad", items: [null, invalid, valid] };
  const good = { batchId: "good", items: [{ day, kind: "main", amount: 11 }] };
  const responses = await Promise.all([post("add", bad), post("add", good)]);
  const statuses = responses.map(response => response.status);
  assert.deepEqual(statuses, [200, 200]);
  await Promise.all(responses.map(response => response.json()));
  const read = await post("read", {});
  const data = await read.json();
  assert.equal(data.days[day].main, 18);
  const rejected = await post("add", null);
  assert.equal(rejected.status, 400);
});
