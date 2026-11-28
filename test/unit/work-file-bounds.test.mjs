import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import createFiles from "../../server/work/files.js";

test("文件工具在读取前拒绝特殊文件与超大的覆盖原件", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-file-bound-")),
    file = path.join(dir, "a.txt"),
    routes = createFiles({
      resolveWorkdir: () => dir,
      targetOf: async () => file,
      shownPath: () => "a.txt",
      lockFile: async () => () => {},
      failed: error => error.message
    }),
    server = http.createServer((req, res) => routes[`POST ${req.url}`](req, res));
  fs.writeFileSync(file, "old");
  const stat = fs.promises.stat;
  let special = true;
  t.mock.method(fs.promises, "stat", async (target, ...args) => {
    const result = await stat(target, ...args);
    if (target === file && special) result.isFile = () => false;
    return result;
  });
  const read = fs.promises.readFile;
  t.mock.method(fs.promises, "readFile", async (target, ...args) => {
    assert.notEqual(target, file, "不应读取被拒绝的目标");
    return read(target, ...args);
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const call = async (tool, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/work/${tool}`, {
        method: "POST",
        body: JSON.stringify({ path: "a.txt", ...body })
      });
      assert.equal(response.status, 400);
      return (await response.json()).error;
    };
    assert.match(await call("read", {}), /普通文件/);
    assert.match(await call("write", { content: "new" }), /普通文件/);
    assert.match(await call("edit", { old: "old", new: "new" }), /普通文件/);
    special = false;
    fs.truncateSync(file, 32 * 1024 * 1024 + 1);
    assert.match(await call("write", { content: "new" }), /原文件超过 32 MB/);
    assert.equal(fs.statSync(file).size, 32 * 1024 * 1024 + 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
