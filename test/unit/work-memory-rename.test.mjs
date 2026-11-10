// 目录记忆原名账本：桥接备目录时把旧目录里的 .yan/账本.md 改名为 记忆.md；新名已有就不动
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");

function scratch() {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "memory-rename-"));
  fs.mkdirSync(path.join(root, ".yan"));
  return root;
}
async function prepare(root) {
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  const res = Object.assign(new EventEmitter(), {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    body: "",
    writeHead() {
      this.headersSent = true;
    },
    end(text) {
      this.body = String(text || "");
      this.writableEnded = true;
    }
  });
  await work.routes["POST /api/work/prepare"](Readable.from([Buffer.from(JSON.stringify({ workdir: root }))]), res);
  return JSON.parse(res.body);
}

test("备目录：旧的 账本.md 改名为 记忆.md", async () => {
  const root = scratch();
  try {
    fs.writeFileSync(path.join(root, ".yan/账本.md"), "# 约束\n- 只用 CPU\n");
    assert.equal((await prepare(root)).workdir, root);
    assert.deepEqual(fs.readdirSync(path.join(root, ".yan")), ["记忆.md"]);
    assert.equal(fs.readFileSync(path.join(root, ".yan/记忆.md"), "utf8"), "# 约束\n- 只用 CPU\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("备目录：记忆.md 已有时不拿旧的 账本.md 盖掉它", async () => {
  const root = scratch();
  try {
    fs.writeFileSync(path.join(root, ".yan/账本.md"), "旧");
    fs.writeFileSync(path.join(root, ".yan/记忆.md"), "新");
    await prepare(root);
    assert.equal(fs.readFileSync(path.join(root, ".yan/记忆.md"), "utf8"), "新");
    assert.equal(fs.readFileSync(path.join(root, ".yan/账本.md"), "utf8"), "旧");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
