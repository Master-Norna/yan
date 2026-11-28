import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");

// 读后被别人改过：整份覆盖不写，照原文改一处的照改并捎回改前的指纹
function setup() {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "stale-"));
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  const call = async (route, body) => {
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
    const req = Readable.from([Buffer.from(JSON.stringify({ workdir: root, path: "a.txt", ...body }))]);
    await work.routes[`POST /api/work/${route}`](req, res);
    return JSON.parse(res.body);
  };
  return { root, call };
}

test("读后被改：write 不覆盖，回现状指纹", async () => {
  const { root, call } = setup();
  const read = await call("read", {});
  assert.match(read.sig, /^[0-9a-f]{16}$/);
  const other = await call("edit", { old: "two", new: "TWO", seen: read.sig });
  assert.equal(other.drift, undefined);
  const stale = await call("write", { content: "mine\n", seen: read.sig });
  assert.equal(stale.stale, true);
  assert.equal(stale.sig, other.sig);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "one\nTWO\n");
  // 带着现状的指纹就写得进
  const ok = await call("write", { content: "mine\n", seen: other.sig });
  assert.equal(ok.stale, undefined);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "mine\n");
});

test("读后被改：edit 原文对得上照改，捎回改前指纹", async () => {
  const { root, call } = setup();
  const read = await call("read", {});
  const other = await call("edit", { old: "two", new: "TWO", seen: read.sig });
  const mine = await call("edit", { old: "one", new: "ONE", seen: read.sig });
  assert.equal(mine.drift, other.sig);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "ONE\nTWO\n");
  // 没带 seen（旧页面）不比
  const legacy = await call("write", { content: "x\n" });
  assert.equal(legacy.stale, undefined);
});

test("读后被清空也算被改：整份覆盖不写", async () => {
  const { root, call } = setup();
  const read = await call("read", {});
  fs.writeFileSync(path.join(root, "a.txt"), "");
  const stale = await call("write", { content: "mine\n", seen: read.sig });
  assert.equal(stale.stale, true);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "");
});

test("并发下载到同一个名字：各落一份，不互相覆盖", async () => {
  const { root, call } = setup();
  const http = await import("node:http");
  const server = http.createServer((req, res) => setTimeout(() => res.end(`body ${req.url}`), 50));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    fs.writeFileSync(path.join(root, "report.txt"), "old");
    const [one, two] = await Promise.all([
      call("download", { url: `${base}/1`, path: "report.txt" }),
      call("download", { url: `${base}/2`, path: "report.txt" })
    ]);
    assert.notEqual(one.path, two.path);
    const bodies = [one.path, two.path].map(p => fs.readFileSync(path.join(root, p), "utf8")).sort();
    assert.deepEqual(bodies, ["body /1", "body /2"]);
    assert.equal(fs.readFileSync(path.join(root, "report.txt"), "utf8"), "old");
  } finally {
    server.close();
  }
});

// 编辑器读完整原文，不带行号、不截断；保存沿用原来的 CAS 与编码。
test("编辑器完整读取 CRLF，保存保留 BOM 与换行", async () => {
  const { root, call } = setup(),
    file = path.join(root, "a.txt");
  fs.writeFileSync(file, "\ufeffone\r\ntwo\r\n");
  const read = await call("read", { editor: true });
  assert.equal(read.text, "one\ntwo\n");
  assert.equal(read.encoding, "utf-8-bom");
  const saved = await call("write", { editor: true, seen: read.sig, content: "one\nTHREE\n" });
  assert.match(saved.sig, /^[0-9a-f]{16}$/);
  assert.equal(fs.readFileSync(file, "utf8"), "\ufeffone\r\nTHREE\r\n");
});

test("编辑器不得写回被 Agent 修改的原件", async () => {
  const { root, call } = setup(),
    file = path.join(root, "a.txt");
  const read = await call("read", { editor: true });
  fs.writeFileSync(file, "agent\n");
  const saved = await call("write", { editor: true, seen: read.sig, content: "mine\n" });
  assert.equal(saved.stale, true);
  assert.equal(fs.readFileSync(file, "utf8"), "agent\n");
});

test("编辑器拒绝截断、混合换行及缺少指纹的覆盖", async () => {
  const { root, call } = setup(),
    file = path.join(root, "a.txt");
  for (const content of ["x".repeat(200001), "one\r\ntwo\n"]) {
    fs.writeFileSync(file, content);
    const read = await call("read", { editor: true });
    assert.equal(read.sig, undefined);
    await call("write", { editor: true, content: "mine" });
    assert.equal(fs.readFileSync(file, "utf8"), content);
  }
});

// 编辑框里的字按 LF 数；写回时再补 CRLF。按含 CR 的字数卡，刚存好的文件会在下一次打开时报超限。
test("CRLF 文本的编辑上限按编辑框字数算，存回后仍能打开", async () => {
  const { root, call } = setup(),
    file = path.join(root, "a.txt"),
    line = "x".repeat(199999);
  // 原文 200001 字节，编辑框里 200000 字
  fs.writeFileSync(file, `${line}\r\n`);
  const read = await call("read", { editor: true });
  assert.equal(read.text, `${line}\n`);
  const saved = await call("write", { editor: true, seen: read.sig, content: `${line}\n` });
  assert.match(saved.sig, /^[0-9a-f]{16}$/);
  assert.equal(fs.readFileSync(file, "utf8"), `${line}\r\n`);
  const again = await call("read", { editor: true });
  assert.equal(again.text, `${line}\n`);
});

// 读时比过的指纹到替换前这一小段：外部写入要当场作废，盘上留外部那份，回 stale 让页面保住编辑稿。
test("比对通过后、替换之前原件被改：不覆盖，回 stale", async () => {
  const { root, call } = setup(),
    file = path.join(root, "a.txt"),
    read = await call("read", { editor: true }),
    realOpen = fs.promises.open;
  fs.promises.open = async (target, ...rest) => {
    // 临时件在替换前写好；这里模拟外部编辑器恰好在这一段里落盘
    if (String(target).endsWith(".tmp")) fs.writeFileSync(file, "outside\n");
    return realOpen.call(fs.promises, target, ...rest);
  };
  try {
    const saved = await call("write", { editor: true, seen: read.sig, content: "mine\n" });
    assert.equal(saved.stale, true);
    assert.equal(fs.readFileSync(file, "utf8"), "outside\n");
    assert.equal(saved.sig, (await call("read", {})).sig);
  } finally {
    fs.promises.open = realOpen;
    fs.unlinkSync(file);
    fs.rmdirSync(root);
  }
});
