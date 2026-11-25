import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const load = createRequire(import.meta.url),
  createArchive = load("../../server/work/archive.js"),
  { SCRATCH_DIR } = load("../../server/work/paths.js");

test("卷宗列表仅在 scratch 为 false 时不遍历草稿，其他字段不变", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-archive-list-")),
    scratchDir = path.join(root, SCRATCH_DIR),
    listed = createArchive({ archiveHome: () => root })["POST /api/archive/list"];
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ["report", "empty", ".hidden", "node_modules", `${SCRATCH_DIR}/chat/sub`])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ["report/fig.png", "fig.png", ".hidden/fig.png", "node_modules/fig.png", `${SCRATCH_DIR}/chat/sub/fig.png`])
    fs.writeFileSync(path.join(root, file), "abc");
  fs.symlinkSync(path.join(root, "report"), path.join(root, "linked"), "junction");
  fs.utimesSync(path.join(root, "fig.png"), 1000, 1000);

  const scanned = [],
    readdir = fs.promises.readdir;
  t.mock.method(fs.promises, "readdir", (dir, ...args) => {
    scanned.push(dir);
    return readdir(dir, ...args);
  });
  const list = async options => {
    scanned.length = 0;
    let status, result;
    await listed(Readable.from([Buffer.from(JSON.stringify({ root, ...options }))]), {
      writeHead: code => (status = code),
      end: text => (result = JSON.parse(text))
    });
    assert.equal(status, 200, JSON.stringify(result));
    return result;
  };

  const { scratch, ...visible } = await list({});
  assert.deepEqual(scratch, { count: 1, files: 1, bytes: 3, truncated: false });
  assert.ok(scanned.includes(scratchDir));
  assert.equal(visible.archive, root);
  assert.deepEqual(
    visible.entries.map(file => file.path),
    ["report/fig.png", "fig.png"]
  );
  assert.deepEqual(visible.dirs.map(dir => dir.path).sort(), ["empty", "report"]);
  assert.equal(visible.truncated, false);

  const skipped = await list({ scratch: false });
  assert.deepEqual(skipped, visible, "响应只省去 scratch，不改可见项");
  assert.equal(
    scanned.some(dir => dir === scratchDir || dir.startsWith(`${scratchDir}${path.sep}`)),
    false,
    "没有下钻草稿目录"
  );
  for (const value of [true, null, 0, "false"]) assert.deepEqual(await list({ scratch: value }), { ...visible, scratch });
});
