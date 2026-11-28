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
  const request = async options => {
    scanned.length = 0;
    let status, result;
    await listed(Readable.from([Buffer.from(JSON.stringify({ root, ...options }))]), {
      writeHead: code => (status = code),
      end: text => (result = JSON.parse(text))
    });
    return { status, result };
  };
  const list = async options => {
    const { status, result } = await request(options);
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

  const shallow = await list({ depth: 1, scratch: false });
  assert.deepEqual(scanned, [root], "只读当前层，不打开子目录");
  assert.deepEqual(
    shallow.dirs.map(dir => dir.path),
    ["empty", "report"]
  );
  assert.deepEqual(
    shallow.entries.map(file => file.path),
    ["fig.png"]
  );
  const empty = await list({ root: path.join(root, "empty"), depth: 1, scratch: false });
  assert.deepEqual([empty.dirs, empty.entries], [[], []]);
  const missing = await request({ root: path.join(root, "missing"), depth: 1, scratch: false });
  assert.equal(missing.status, 400);
  assert.match(missing.result.error, /路径不存在/);
});

test("单层列目录报告拒绝访问，卷宗全树仍可略过读不了的层", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-work-list-denied-")),
    route = createArchive({ archiveHome: () => root })["POST /api/archive/list"];
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(fs.promises, "readdir", async () => {
    throw Object.assign(Error("denied"), { code: "EACCES" });
  });
  const list = async options => {
    let status, data;
    await route(Readable.from([Buffer.from(JSON.stringify({ scratch: false, ...options }))]), {
      writeHead: code => (status = code),
      end: body => (data = JSON.parse(body))
    });
    return { status, data };
  };
  const shallow = await list({ depth: 1 });
  assert.equal(shallow.status, 400);
  assert.match(shallow.data.error, /没有访问权限/);
  const deep = await list({});
  assert.equal(deep.status, 200);
  assert.deepEqual([deep.data.dirs, deep.data.entries], [[], []]);
});

test("改动所及的隐藏文件直接 stat，不依赖卷宗的扫描结果", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-work-stat-")),
    route = createArchive({ archiveHome: () => root })["POST /api/archive/stat"];
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ".gitignore");
  fs.writeFileSync(file, "abc");
  const stat = async target => {
    let status, data;
    await route(Readable.from([Buffer.from(JSON.stringify({ path: target }))]), {
      writeHead: code => (status = code),
      end: body => (data = JSON.parse(body))
    });
    assert.equal(status, 200);
    return data;
  };
  const present = await stat(file);
  assert.equal(present.kind, "file");
  assert.equal(present.size, 3);
  assert.ok(present.modifiedAt);
  assert.equal((await stat(path.join(root, "missing.md"))).kind, "missing");
  assert.equal((await stat(root)).kind, "dir");
});
