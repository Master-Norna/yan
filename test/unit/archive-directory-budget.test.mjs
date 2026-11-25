import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createArchive = require("../../server/work/archive.js");
const { SCRATCH_DIR } = require("../../server/work/paths.js");

async function makeDirs(root, count) {
  for (let i = 0; i < count; i += 64)
    await Promise.all(Array.from({ length: Math.min(64, count - i) }, (_, j) => fs.mkdir(path.join(root, String(i + j)))));
}

test("纯目录也受卷宗与草稿的遍历上限约束", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yan-archive-budget-"));
  const route = createArchive({ archiveHome: () => root })["POST /api/archive/list"];
  const list = async () => {
    let status, data;
    await route(Readable.from([Buffer.from("{}")]), {
      writeHead(code) { status = code; },
      end(body) { data = JSON.parse(body); }
    });
    assert.equal(status, 200);
    return data;
  };
  try {
    const scratch = path.join(root, SCRATCH_DIR);
    await fs.mkdir(scratch);
    await makeDirs(root, 3001);
    await makeDirs(scratch, 5001);
    const data = await list();
    assert.equal(data.entries.length + data.dirs.length, 3000);
    assert.equal(data.truncated, true);
    assert.equal(data.scratch.count, 5000);
    assert.equal(data.scratch.files, 0);
    assert.equal(data.scratch.truncated, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
