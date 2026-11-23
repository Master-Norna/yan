// 图（原「意」，2026-11-23 改名）的落点：.yan/图.json；旧目录里只有 .yan/意.json 时读得出来，
// 写下第一笔就迁到新名、旧文件删去。桥接是唯一的写者，读旧写新这一段只在它这头。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createIntent = require("../../server/work/intent.js");

function bridge(dir) {
  const work = {
    failed: (res, error) => {
      throw error;
    },
    resolveWorkdir: value => path.resolve(value),
    targetOf: async (workdir, body) => path.join(workdir, body.path),
    lockFile: async () => () => {}
  };
  const route = createIntent(work)["POST /api/work/intent"];
  return async body => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    const res = {
      writableEnded: false,
      headersSent: false,
      destroyed: false,
      status: 0,
      payload: "",
      writeHead(status) {
        this.status = status;
        this.headersSent = true;
      },
      end(chunk) {
        if (chunk) this.payload += chunk;
        this.writableEnded = true;
      },
      on() {},
      once() {},
      off() {},
      removeListener() {}
    };
    await route(req, res);
    return { status: res.status, data: JSON.parse(res.payload || "null") };
  };
}

function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-intent-legacy-"));
  fs.mkdirSync(path.join(dir, ".yan"), { recursive: true });
  return dir;
}

test("旧目录里只有 .yan/意.json：读得出来；写入迁到 .yan/图.json，旧文件删去", async () => {
  const dir = folder(),
    legacy = path.join(dir, ".yan/意.json"),
    current = path.join(dir, ".yan/图.json"),
    call = bridge(dir);
  const old = '{\n  "nodes": {\n    "甲": {\n      "claim": "旧名写的"\n    }\n  }\n}\n';
  fs.writeFileSync(legacy, old);
  try {
    const read = await call({ workdir: dir });
    assert.equal(read.status, 200);
    assert.deepEqual(read.data.data, JSON.parse(old), "读旧名的那一份");
    assert.ok(read.data.version, "带版本，供页面对上再写");
    const next = { nodes: { 甲: { claim: "改名后写的" } } },
      written = await call({ workdir: dir, data: next, base: read.data.version });
    assert.equal(written.status, 200);
    assert.deepEqual(written.data.data, next);
    assert.equal(fs.existsSync(legacy), false, "旧文件迁走即删");
    assert.deepEqual(JSON.parse(fs.readFileSync(current, "utf8")), next, "写在新名上");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("新名已有：读新名，旧名不再看；版本对不上时交回此刻这一份", async () => {
  const dir = folder(),
    legacy = path.join(dir, ".yan/意.json"),
    current = path.join(dir, ".yan/图.json"),
    call = bridge(dir);
  fs.writeFileSync(legacy, '{"nodes":{"旧":{"claim":"旧"}}}\n');
  fs.writeFileSync(current, '{"nodes":{"新":{"claim":"新"}}}\n');
  try {
    const read = await call({ workdir: dir });
    assert.deepEqual(read.data.data, { nodes: { 新: { claim: "新" } } }, "新名优先");
    const stale = await call({ workdir: dir, data: { nodes: {} }, base: "别的版本" });
    assert.equal(stale.data.conflict, true);
    assert.deepEqual(stale.data.data, { nodes: { 新: { claim: "新" } } }, "交回新名的内容");
    assert.ok(fs.existsSync(legacy), "没写成就别动旧文件");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
