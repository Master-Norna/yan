import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const createWork = createRequire(import.meta.url)("../../server/work/index.js");

function folder() {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "dir-prints-"));
  assert.equal(path.dirname(root), parent);
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  const print = async () => {
    const req = Readable.from([Buffer.from(JSON.stringify({ workdir: root, dirs: ["."] }))]);
    let result;
    await work.routes["POST /api/work/prints"](req, {
      writeHead() {},
      end(text) {
        result = JSON.parse(text);
      }
    });
    assert.equal(typeof result.dirs?.["."], "string");
    return result.dirs["."];
  };
  return {
    root,
    print,
    clean() {
      if (path.dirname(root) !== parent) throw Error("测试清理目录越界");
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test("目录凭据不因言自己的目录记忆、意与临时稿更新而失效", async () => {
  const { root, print, clean } = folder();
  try {
    fs.writeFileSync(path.join(root, "app.js"), "业务代码");
    const before = await print();
    fs.mkdirSync(path.join(root, ".yan"));
    fs.writeFileSync(path.join(root, ".yan/意.json"), '{"nodes":{}}');
    fs.mkdirSync(path.join(root, ".草稿"));
    fs.writeFileSync(path.join(root, ".草稿/probe.py"), "print('x')");
    assert.equal(await print(), before);
    fs.writeFileSync(path.join(root, ".yan/意.json"), '{"nodes":{"甲":{}}}');
    assert.equal(await print(), before);
  } finally {
    clean();
  }
});

test("目录凭据认得空目录的新增、删除", async () => {
  const { root, print, clean } = folder();
  try {
    const before = await print();
    fs.mkdirSync(path.join(root, "empty"));
    assert.notEqual(await print(), before);
    fs.rmdirSync(path.join(root, "empty"));
    assert.equal(await print(), before);
  } finally {
    clean();
  }
});

test("目录超过 2000 件文件：后面的改动、新增、删除也改变指纹", async () => {
  const { root, print, clean } = folder();
  try {
    for (let i = 0; i < 2005; i++) fs.writeFileSync(path.join(root, `${String(i).padStart(4, "0")}.txt`), "a");
    let before = await print();
    assert.equal(await print(), before);
    fs.writeFileSync(path.join(root, "2004.txt"), "changed");
    const changed = await print();
    assert.notEqual(changed, before);
    before = changed;
    fs.writeFileSync(path.join(root, "zz-new.txt"), "new");
    const added = await print();
    assert.notEqual(added, before);
    fs.unlinkSync(path.join(root, "2004.txt"));
    assert.notEqual(await print(), added);
  } finally {
    clean();
  }
});
