import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const createFiles = createRequire(import.meta.url)("../../server/work/files.js");

function download(work, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]),
    res = Object.assign(new EventEmitter(), {
      writeHead(status) {
        this.status = status;
      },
      end() {}
    });
  return work["POST /api/work/download"](req, res).then(() => res);
}

test("下载：网址推导出的文件名也须经过完整落点校验", async () => {
  const root = path.resolve("test/.tmp");
  const seen = [];
  const work = createFiles({
    failed: error => error.message,
    resolveWorkdir: () => root,
    targetOf: async (_root, body) => {
      seen.push(body);
      if (seen.length > 1) throw Error("guarded");
      return root;
    }
  });
  const res = await download(work, { url: "http://127.0.0.1/a.txt", sandbox: true, permission: "review", roam: true });
  assert.equal(res.status, 400);
  assert.deepEqual(
    seen.map(body => body.path),
    [".", path.join(root, "a.txt")]
  );
  // 档位与沙箱开关要跟着这条路径一起过去：丢了它们，宽档的下载会忽然按严档筛
  assert.equal(seen[1].sandbox, true);
  assert.equal(seen[1].permission, "review");
  assert.equal(seen[1].roam, true);
});

test("下载：名字被占而顺延出的落点也须经过完整校验", async t => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yan-download-"));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(dir, "a.txt"), "old");
  const seen = [];
  const work = createFiles({
    failed: error => error.message,
    resolveWorkdir: () => dir,
    targetOf: async (_root, body) => {
      seen.push(body.path);
      if (seen.length > 3) throw Error("guarded");
      return body.path === "." ? dir : body.path;
    },
    missingHint: async () => "",
    shownPath: (_root, file) => file,
    strictBox: () => false,
    lockFile: async () => () => {}
  });
  const res = await download(work, { url: `http://127.0.0.1:${server.address().port}/a.txt` });
  assert.equal(res.status, 400);
  // 一次目录、一次推导出的名字，都被占后顺延的那个名字再查一遍
  assert.deepEqual(seen.slice(0, 4), [".", path.join(dir, "a.txt"), path.join(dir, "a.txt"), path.join(dir, "a (2).txt")]);
  // 被占的那一份原样留着，没有被这次下载改写
  assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "old");
});
