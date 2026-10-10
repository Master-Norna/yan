import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const createArchive = createRequire(import.meta.url)("../../server/work/archive.js");

async function move(route, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  let status, data;
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHead(code) {
      status = code;
      this.headersSent = true;
    },
    end(text) {
      data = JSON.parse(text);
      this.writableEnded = true;
    }
  };
  await route(req, res);
  return { status, data };
}

for (const rename of [false, true])
  test(rename ? "同时改成同一个名字：只成功一份，另一份原件留下" : "同名文件同时移入一层：两份原件都在，不相互覆盖", async () => {
    const parent = path.resolve("test/.tmp");
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, "archive-move-"));
    assert.equal(path.dirname(root), parent);
    const route = createArchive({ archiveHome: () => root })["POST /api/archive/move"];
    const original = fs.promises.rename;
    // 把落笔稍往后放，确保两份请求有机会同时挑中同一个名字。
    fs.promises.rename = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 15));
      return original(...args);
    };
    try {
      for (let i = 0; i < 8; i++) {
        const base = path.join(root, String(i));
        for (const dir of ["a", "b", "out"]) fs.mkdirSync(path.join(base, dir), { recursive: true });
        for (const dir of ["a", "b"]) fs.writeFileSync(path.join(base, dir, "same.txt"), dir);
        const results = await Promise.all(
          ["a", "b"].map(dir =>
            move(route, {
              root: base,
              path: `${dir}/same.txt`,
              dir: "out",
              ...(rename ? { name: "renamed.txt" } : {})
            })
          )
        );
        const files = fs.readdirSync(path.join(base, "out"));
        const contents = files.map(file => fs.readFileSync(path.join(base, "out", file), "utf8"));
        if (rename) {
          assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
          assert.deepEqual(files, ["renamed.txt"]);
          const remaining = ["a", "b"].filter(dir => fs.existsSync(path.join(base, dir, "same.txt")));
          assert.equal(remaining.length, 1);
          assert.notEqual(fs.readFileSync(path.join(base, remaining[0], "same.txt"), "utf8"), contents[0]);
          assert.match(results.find(r => r.status === 400).data.error, /已有/);
        } else {
          assert.deepEqual(
            results.map(r => r.status),
            [200, 200]
          );
          assert.deepEqual(contents.sort(), ["a", "b"]);
          assert.equal(new Set(results.map(r => r.data.path)).size, 2);
        }
      }
    } finally {
      fs.promises.rename = original;
      if (path.dirname(root) !== parent) throw Error("测试清理目录越界");
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
