// 大附件：单件放到 256 MB；发问时只取用得着的——抽出正文的只取正文，没抽出的往后各问不取原件，这一问过大的给本机路径
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";
const createFiles = createRequire(import.meta.url)("../../server/files.js");

const MB = 1024 * 1024;
function engine(records) {
  const calls = [],
    f = load(["messageForApi", "setup:(fn,whole)=>{bridge=fn;getAttachment=whole;}"]);
  f.setup(
    async (route, body) => {
      calls.push([route, body.id, !!body.meta]);
      if (route === "/api/files/path") return { path: `D:\\言\\附件\\${body.id}` };
      const { data, ...meta } = records[body.id];
      return { record: body.meta && meta.kind !== "text" ? meta : records[body.id] };
    },
    async id => {
      calls.push(["whole", id]);
      return records[id];
    }
  );
  return { ...f, calls };
}
const text = entry => entry.content.map(part => part.text || "").join("\n");

test("抽出正文的文档：这一问与往后各问都只取正文，不取原件", async () => {
  const doc = { id: "pdf1", name: "书.pdf", kind: "file", mime: "application/pdf", size: 200 * MB, extracted: true };
  const f = engine({ pdf1: { ...doc, data: "data:application/pdf;base64,AAAA", extractedText: "第 1 页\n正文" } });
  for (const latest of [true, false])
    assert.match(text(await f.messageForApi({ role: "user", content: "读", attachments: [doc] }, latest)), /正文/);
  assert.ok(
    f.calls.every(([route, , meta]) => route === "/api/files/get" && meta),
    JSON.stringify(f.calls)
  );
});

test("没抽出正文的文件：往后各问不取原件；这一问过大的给本机路径，小的照旧整份送", async () => {
  const big = { id: "bin1", name: "录像.bin", kind: "file", mime: "application/octet-stream", size: 100 * MB, extracted: false },
    small = { id: "bin2", name: "小.bin", kind: "file", mime: "application/octet-stream", size: 1024, extracted: false };
  const f = engine({ bin2: { ...small, data: "data:application/octet-stream;base64,AAAA" } });
  const old = await f.messageForApi({ role: "user", content: "看", attachments: [big, small] }, false);
  assert.match(text(old), /先前发过/);
  assert.deepEqual(f.calls, []);
  const latest = await f.messageForApi({ role: "user", content: "看", attachments: [big, small] }, true);
  assert.match(text(latest), /D:\\言\\附件\\bin1/);
  assert.ok(latest.content.some(part => part.type === "file" && part.file.filename === "小.bin"));
  assert.ok(!f.calls.some(([route, id]) => route === "whole" && id === "bin1"), JSON.stringify(f.calls));
});

test("桥接：meta 只回元数据与抽出的正文，文本附件照给正文", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-meta-"));
  const { routes } = createFiles({ filesHome: () => root });
  const { post, upload, close } = await serveFiles(root);
  try {
    await upload(
      { record: { id: "d1", kind: "file", name: "a.pdf", mime: "application/pdf", extractedText: "正文" } },
      Buffer.from([0, 0, 0])
    );
    await upload({ record: { id: "t1", kind: "text", name: "a.txt" } }, Buffer.from("全文"));
    const doc = (await post("/api/files/get", { id: "d1", meta: true })).record;
    assert.equal(doc.data, undefined);
    assert.equal(doc.extractedText, "正文");
    assert.equal((await post("/api/files/get", { id: "t1", meta: true })).record.data, "全文");
    assert.equal((await post("/api/files/get", { id: "d1" })).record.data, "data:application/pdf;base64,AAAA");
  } finally {
    await close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("桥接：原件直传——说明之后的字节边收边写，正本与发来的一字不差；没收全的不留半截", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-upload-"));
  const { post, upload, port, close } = await serveFiles(root);
  try {
    const bytes = Buffer.alloc(3 * MB + 7);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 255;
    const done = await upload(
      { record: { id: "b1", kind: "file", name: "大.bin", mime: "application/octet-stream", size: bytes.length } },
      bytes
    );
    assert.deepEqual(done, { id: "b1", bytes: bytes.length });
    assert.deepEqual(fs.readFileSync((await post("/api/files/path", { id: "b1" })).path), bytes);
    // 说明写着有这么长，却只送来一半：报错，目录里不留半截（连临时文件）
    const head = Buffer.from(JSON.stringify({ record: { id: "b2", kind: "file", name: "半.bin" } }));
    const half = await fetch(`http://127.0.0.1:${port}/api/files/put?head=${head.length + 50}`, { method: "POST", body: head }).then(
      r => r.status
    );
    assert.equal(half, 400);
    assert.deepEqual(
      fs.readdirSync(root).filter(name => name.startsWith("b2")),
      []
    );
  } finally {
    await close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
// 一个只挂附件接口的小桥接：post 发 JSON，upload 照页面的 bridgeUpload 发「说明 + 原件」
async function serveFiles(root) {
  const { routes } = createFiles({ filesHome: () => root });
  const server = http.createServer((req, res) => routes[`POST ${req.url.split("?")[0]}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const port = server.address().port,
    post = (route, body) => fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json()),
    upload = (head, body) => {
      const json = Buffer.from(JSON.stringify(head));
      return fetch(`http://127.0.0.1:${port}/api/files/put?head=${json.length}`, {
        method: "POST",
        body: Buffer.concat([json, body])
      }).then(r => r.json());
    };
  return { post, upload, port, close: () => new Promise(resolve => server.close(resolve)) };
}
