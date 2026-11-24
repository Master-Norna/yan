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
  const batch = async (body = { dirs: ["."] }) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ workdir: root, ...body }))]);
    let result;
    await work.routes["POST /api/work/prints"](req, {
      on() {},
      writeHead() {},
      end(text) {
        result = JSON.parse(text);
      }
    });
    return result;
  };
  const print = async () => {
    const result = await batch();
    assert.equal(typeof result.dirs?.["."], "string");
    return result.dirs["."];
  };
  return {
    root,
    print,
    batch,
    clean() {
      if (path.dirname(root) !== parent) throw Error("测试清理目录越界");
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test("目录凭据不因言自己的目录记忆、图与临时稿更新而失效", async () => {
  const { root, print, clean } = folder();
  try {
    fs.writeFileSync(path.join(root, "app.js"), "业务代码");
    const before = await print();
    fs.mkdirSync(path.join(root, ".yan"));
    fs.writeFileSync(path.join(root, ".yan/图.json"), '{"nodes":{}}');
    fs.mkdirSync(path.join(root, ".草稿"));
    fs.writeFileSync(path.join(root, ".草稿/probe.py"), "print('x')");
    assert.equal(await print(), before);
    fs.writeFileSync(path.join(root, ".yan/图.json"), '{"nodes":{"甲":{}}}');
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

test("重叠目录与显式文件在同一批只读一次，下一批仍读新内容", async () => {
  const { root, batch, clean } = folder();
  const file = path.join(root, "nested", "x");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, "a");
  const original = fs.createReadStream;
  let reads = 0;
  fs.createReadStream = function (given, ...args) {
    if (given === file) reads++;
    return original.call(this, given, ...args);
  };
  try {
    const first = await batch({ paths: ["nested/x"], dirs: [".", "nested"] });
    assert.equal(reads, 1);
    assert.equal(typeof first.prints["nested/x"], "string");
    assert.equal(typeof first.dirs["nested"], "string");
    fs.writeFileSync(file, "b");
    const second = await batch({ paths: ["nested/x"], dirs: [".", "nested"] });
    assert.equal(reads, 2);
    assert.notEqual(second.prints["nested/x"], first.prints["nested/x"]);
    assert.notEqual(second.dirs["."], first.dirs["."]);
  } finally {
    fs.createReadStream = original;
    clean();
  }
});

test("凭据：暂时无法访问不等于消失", async () => {
  const { root, batch, clean } = folder();
  const file = path.join(root, "blocked");
  fs.writeFileSync(file, "x");
  const original = fs.createReadStream;
  fs.createReadStream = function (given, ...args) {
    if (given === file) throw Object.assign(Error("busy"), { code: "EACCES" });
    return original.call(this, given, ...args);
  };
  try {
    const result = await batch({ paths: ["blocked", "missing"], dirs: [".", "missing"] });
    assert.deepEqual(result.prints, { missing: null });
    assert.deepEqual(result.dirs, { missing: null });
  } finally {
    fs.createReadStream = original;
    clean();
  }
});
