import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import createFind from "../../server/work/find.js";

test("cancelled list and search stop before scanning the next directory", async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yan-find-stop-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(root, "sub"));
  await fs.promises.writeFile(path.join(root, "sub", "hit.txt"), "hit");
  const routes = createFind({
    failed: error => String(error),
    resolveWorkdir: () => root,
    targetOf: async () => root,
    missingHint: async () => "",
    shownPath: (_, file) => file,
    strictBox: () => false,
    storeRoot: () => path.join(root, "store")
  });
  for (const endpoint of ["list", "search"]) {
    const req = Readable.from([Buffer.from(JSON.stringify({ depth: 8, query: "hit" }))]);
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      writeHead() { assert.fail("cancelled scan must not write a response"); },
      end() { assert.fail("cancelled scan must not end a response"); }
    });
    const original = fs.promises.readdir;
    let reads = 0;
    fs.promises.readdir = async (...args) => {
      reads++;
      const entries = await original(...args);
      res.destroyed = true;
      res.emit("close");
      return entries;
    };
    try {
      await routes[`POST /api/work/${endpoint}`](req, res);
      assert.equal(reads, 1);
    } finally {
      fs.promises.readdir = original;
    }
  }
});
