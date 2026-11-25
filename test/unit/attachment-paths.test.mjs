// 附件的本机原件：用户随问发来的文件在对话附件里、不在工作目录；发问时把原件的路径一并写明，
// 模型要拿原件（脚本处理、复制进目录）时才找得到，不必到工作目录里找同名文件
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";
const createFiles = createRequire(import.meta.url)("../../server/files.js");

const text = entry => entry.content.map(part => part.text || "").join("\n");

test("这一问与往后各问的附件都带上本机原件；「不在工作目录」只在最新一问说一回", async () => {
  const calls = [],
    f = load(["messageForApi", "attachmentPlaces", "setup:(fn,meta)=>{bridge=fn;getAttachmentMeta=meta;}"]);
  f.setup(
    async (route, body) => {
      calls.push([route, body.ids]);
      if (route === "/api/files/paths") return { paths: { t1: "D:\\言\\附件\\t1.csv" } };
      return {};
    },
    async () => ({ kind: "text", name: "a.csv", data: "a,b\n1,2" })
  );
  const message = { id: "u1", role: "user", content: "看", attachments: [{ id: "t1", name: "a.csv", kind: "text", size: 8 }] };
  const places = await f.attachmentPlaces([message]);
  const latest = text(await f.messageForApi(message, true, 24000, true, places));
  assert.match(latest, /不在工作目录/);
  assert.match(latest, /本机原件：D:\\言\\附件\\t1\.csv/);
  const earlier = text(await f.messageForApi(message, false, 24000, false, places));
  assert.doesNotMatch(earlier, /不在工作目录/);
  assert.match(earlier, /本机原件：D:\\言\\附件\\t1\.csv/);
  // 同一件问过就不再问：一页里同一段对话每问都装历史，不能每问都为同一批附件跑一趟桥接
  await f.attachmentPlaces([message]);
  assert.equal(calls.filter(([route]) => route === "/api/files/paths").length, 1);
});

test("没抽出正文的文件：随原件说清缘由，并给本机原件", async () => {
  const MB = 1024 * 1024,
    f = load(["messageForApi", "setup:(fn,whole,meta)=>{bridge=fn;getAttachment=whole;getAttachmentMeta=meta;}"]);
  f.setup(
    async () => ({}),
    async () => ({ kind: "file", name: "扫描.pdf", data: "data:application/pdf;base64,AAAA", size: 2 * MB }),
    async () => null
  );
  const message = {
    id: "u2",
    role: "user",
    content: "看",
    attachments: [
      {
        id: "s1",
        name: "扫描.pdf",
        kind: "file",
        size: 2 * MB,
        extracted: false,
        extractionError: "PDF 没有文字层（多半是扫描件），原件照发"
      }
    ]
  };
  const latest = text(await f.messageForApi(message, true, 24000, true, { s1: "D:\\言\\附件\\s1.pdf" }));
  assert.match(latest, /本机没抽出正文（PDF 没有文字层/);
  assert.match(latest, /本机原件：D:\\言\\附件\\s1\.pdf/);
});

test("换过存储根：旧路径不再算数，按新根重问", async () => {
  const calls = [],
    f = load(["attachmentPlaces", "setup:(fn,root)=>{bridge=fn;bootstrap={...bootstrap,store:{root}};}"]);
  const answer = () => async (route, body) => {
    calls.push(body.root);
    return { paths: { t1: `D:\\${body.root}\\附件\\t1.csv` } };
  };
  const message = { id: "u1", role: "user", attachments: [{ id: "t1", name: "a.csv", kind: "text" }] };
  f.setup(answer(), "A");
  assert.equal((await f.attachmentPlaces([message])).t1, "D:\\A\\附件\\t1.csv");
  // 同一个根：不再跑桥接
  await f.attachmentPlaces([message]);
  assert.equal(calls.length, 1);
  // 换了位置（原件搬到新根下，同一个 id 的路径全变）：记着的那份不能再用，按新根重问
  f.setup(answer(), "B");
  assert.equal((await f.attachmentPlaces([message])).t1, "D:\\B\\附件\\t1.csv");
  assert.deepEqual(calls, ["A", "B"]);
});

test("随问发来的图也给本机原件：只有 image_url，要嵌进文档时找不到文件", async () => {
  const f = load(["messageForApi", "setup:(fn,whole)=>{bridge=fn;getAttachment=whole;}"]);
  f.setup(
    async () => ({ paths: {} }),
    async () => ({ kind: "image", name: "图.png", size: 1234, data: "data:image/png;base64,AAAA" })
  );
  const message = { id: "u3", role: "user", content: "看图", attachments: [{ id: "i1", name: "图.png", kind: "image", size: 1234 }] },
    latest = text(await f.messageForApi(message, true, 24000, true, { i1: "D:\\言\\附件\\i1.png" }));
  assert.match(latest, /本机原件：D:\\言\\附件\\i1\.png/);
});

test("批量没回、单件问到时也认：取到的按存储根记下，下一问不再问", async () => {
  const calls = [],
    f = load(["messageForApi", "attachmentPlaces", "setup:(fn,whole)=>{bridge=fn;getAttachment=whole;}"]);
  f.setup(
    async route => {
      calls.push(route);
      // 这一趟批量没回（原件刚到、或瞬时失败）：单件那口才有
      return route === "/api/files/paths" ? { paths: {} } : { path: "D:\\言\\附件\\z1.zip" };
    },
    async () => ({ kind: "file", name: "包.zip", size: 8, data: "data:application/zip;base64,AAAA" })
  );
  const message = { id: "u4", role: "user", content: "看", attachments: [{ id: "z1", name: "包.zip", kind: "file", size: 8 }] },
    places = await f.attachmentPlaces([message]);
  assert.match(text(await f.messageForApi(message, true, 24000, true, places)), /本机原件路径：D:\\言\\附件\\z1\.zip/);
  // 单件取到的也写回缓存：下一问不必再问桥接
  const before = calls.length;
  await f.attachmentPlaces([message]);
  assert.equal(calls.length, before, "单件取到的路径也记进了缓存");
});

test("桥接：一批附件的原件路径，找不到的不回", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-paths-"));
  const { routes } = createFiles({ filesHome: () => root });
  const server = http.createServer((req, res) => routes[`POST ${req.url.split("?")[0]}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  try {
    const json = Buffer.from(JSON.stringify({ record: { id: "t1", kind: "text", name: "a.csv" } }));
    await fetch(`http://127.0.0.1:${server.address().port}/api/files/put?head=${json.length}`, {
      method: "POST",
      body: Buffer.concat([json, Buffer.from("a,b")])
    });
    const { paths } = await post("/api/files/paths", { ids: ["t1", "gone"] });
    assert.deepEqual(Object.keys(paths), ["t1"]);
    assert.equal(fs.readFileSync(paths.t1, "utf8"), "a,b");
    // 同一个 id 换了扩展名：仍认这一份
    assert.equal(path.basename(paths.t1).startsWith("t1."), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
