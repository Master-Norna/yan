import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import createFiles from "../../server/work/files.js";

test("write_file checks the actual encoded size before replacing a UTF-16 file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-write-")),
    file = path.join(dir, "a.txt"),
    original = Buffer.from("\uFEFFold", "utf16le");
  fs.writeFileSync(file, original);
  const routes = createFiles({
    resolveWorkdir: () => dir,
    targetOf: async () => file,
    shownPath: () => "a.txt",
    lockFile: async () => () => {},
    failed: error => error.message
  });
  const server = http.createServer(routes["POST /api/work/write"]);
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/work/write`, {
      method: "POST",
      body: JSON.stringify({ path: "a.txt", content: "a".repeat(16 * 1024 * 1024) })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /32 MB/);
    assert.deepEqual(fs.readFileSync(file), original);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
