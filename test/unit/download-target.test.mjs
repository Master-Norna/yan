import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import path from "node:path";

const createFiles = createRequire(import.meta.url)("../../server/work/files.js");

test("下载：网址推导出的文件名也须经过完整落点校验", async () => {
  const root = path.resolve("test/.tmp");
  const paths = [];
  const work = createFiles({
    failed: error => error.message,
    resolveWorkdir: () => root,
    targetOf: async (_root, body) => {
      paths.push(body.path);
      if (paths.length > 1) throw Error("guarded");
      return root;
    }
  });
  const req = Readable.from([Buffer.from(JSON.stringify({ url: "http://127.0.0.1/a.txt" }))]);
  const res = Object.assign(new EventEmitter(), {
    writeHead(status) {
      this.status = status;
    },
    end() {}
  });
  await work["POST /api/work/download"](req, res);
  assert.equal(res.status, 400);
  assert.deepEqual(paths, [".", path.join(root, "a.txt")]);
});
