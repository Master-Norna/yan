import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { sendFile } from "../../server/http.js";

test("file ranges cover full, suffix, empty and HEAD responses", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yan-range-"));
  await fs.writeFile(path.join(dir, "full.txt"), "abcde");
  await fs.writeFile(path.join(dir, "empty.txt"), "");
  const server = http.createServer((req, res) => {
    sendFile(req, res, path.join(dir, req.url.slice(1)), { name: "test.txt" }).catch(error => res.destroy(error));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const get = (file, range, method = "GET") =>
    fetch(`http://127.0.0.1:${server.address().port}/${file}`, { method, headers: range ? { Range: range } : {} });
  for (const range of ["bytes=0-", "bytes=0-4", "bytes=-99"]) {
    const res = await get("full.txt", range);
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), "bytes 0-4/5");
    assert.equal(await res.text(), "abcde");
  }
  const suffix = await get("full.txt", "bytes=-2");
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), "de");
  for (const [file, range, size] of [["empty.txt", "bytes=0-", 0], ["full.txt", "bytes=-0", 5], ["full.txt", "bytes=5-", 5]]) {
    const res = await get(file, range);
    assert.equal(res.status, 416);
    assert.equal(res.headers.get("content-range"), `bytes */${size}`);
    await res.text();
  }
  const head = await get("full.txt", "bytes=1-2", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "5");
  assert.equal(head.headers.get("content-range"), null);
  const empty = await get("empty.txt");
  assert.equal(empty.status, 200);
  assert.equal(await empty.text(), "");
});
