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

test("草稿根或指定草稿经链接指向外部时不删原件", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "yan-clean-link-"));
  const root = path.join(base, "archive");
  const outside = path.join(base, "outside");
  const scratch = path.join(root, SCRATCH_DIR);
  const route = createArchive({ archiveHome: () => root })["POST /api/archive/clean"];
  const clean = async body => {
    let status;
    await route(Readable.from([Buffer.from(JSON.stringify(body))]), {
      writeHead(code) { status = code; },
      end() {}
    });
    return status;
  };
  try {
    assert.equal(await clean({ id: "keep" }), 200);
    await fs.mkdir(root);
    await fs.mkdir(path.join(outside, "keep"), { recursive: true });
    await fs.writeFile(path.join(outside, "keep", "file.txt"), "keep");
    const type = process.platform === "win32" ? "junction" : "dir";
    await fs.symlink(outside, scratch, type);
    assert.equal(await clean({ id: "keep" }), 400);
    assert.equal(await clean({ id: "" }), 400);
    assert.equal(await fs.readFile(path.join(outside, "keep", "file.txt"), "utf8"), "keep");
    await fs.unlink(scratch);
    await fs.mkdir(scratch);
    await fs.symlink(outside, path.join(scratch, "keep"), type);
    assert.equal(await clean({ id: "keep" }), 400);
    assert.equal(await fs.readFile(path.join(outside, "keep", "file.txt"), "utf8"), "keep");
    await fs.unlink(path.join(scratch, "keep"));
    await fs.mkdir(path.join(scratch, "keep"));
    assert.equal(await clean({ id: "keep" }), 200);
    await assert.rejects(fs.stat(path.join(scratch, "keep")), { code: "ENOENT" });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
