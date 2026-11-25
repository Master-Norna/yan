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

test("无效草稿编号不能扩大清理范围", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yan-clean-id-"));
  const scratch = path.join(root, SCRATCH_DIR);
  const route = createArchive({ archiveHome: () => root })["POST /api/archive/clean"];
  const clean = async body => {
    let status;
    await route(Readable.from([Buffer.from(JSON.stringify(body))]), {
      writeHead: code => (status = code),
      end() {}
    });
    return status;
  };
  try {
    await fs.mkdir(path.join(scratch, "keep"), { recursive: true });
    for (const id of ["...", "../keep", "keep!", null, false, 0]) {
      assert.equal(await clean({ id }), 400);
      assert.equal((await fs.stat(path.join(scratch, "keep"))).isDirectory(), true);
    }
    assert.equal(await clean({ id: "missing" }), 200);
    assert.equal((await fs.stat(path.join(scratch, "keep"))).isDirectory(), true);
    assert.equal(await clean({ id: "" }), 200);
    await assert.rejects(fs.stat(scratch), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
