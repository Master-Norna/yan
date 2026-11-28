import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { deflateRawSync } from "node:zlib";
import { officeZipFixture as zip } from "../helpers/office-zip.mjs";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const { readOffice, patchOffice } = require("../../server/work/office.js");
const createWork = require("../../server/work/index.js");

test("Office 仅替换指定 XML，未改的局部记录原样保留；多次保存不会积累废记录", () => {
  const original = zip({
    "word/document.xml": "<doc>old</doc>",
    "word/media/picture.png": "picture",
    "word/styles.xml": "<styles/>"
  });
  let updated = patchOffice("a.docx", original, { "word/document.xml": "<doc>new</doc>" });
  assert.equal(readOffice("a.docx", updated)["word/document.xml"], "<doc>new</doc>");
  assert.ok(updated.includes(deflateRawSync(Buffer.from("picture"))));
  assert.ok(updated.includes(deflateRawSync(Buffer.from("<styles/>"))));
  updated = patchOffice("a.docx", updated, { "word/document.xml": "<doc>old</doc>" });
  assert.deepEqual(updated, original);
  assert.equal(patchOffice("a.docx", original, { "word/document.xml": "<doc>old</doc>" }), original);
  assert.throws(() => patchOffice("a.docx", original, { "word/styles.xml": "<bad/>" }));
});

test("拒绝数字签名、无效 CRC、非编辑部件及 XML 实体", () => {
  const signed = zip({ "word/document.xml": "<doc/>", "_xmlsignatures/sig1.xml": "<sig/>" });
  assert.throws(() => readOffice("a.docx", signed));
  const original = zip({ "xl/worksheets/sheet1.xml": "<sheet/>", "xl/_rels/workbook.xml.rels": "<rels/>" });
  assert.throws(() => patchOffice("a.xlsx", original, { "xl/_rels/workbook.xml.rels": "<rels>changed</rels>" }));
  assert.throws(() => patchOffice("a.xlsx", original, { "xl/worksheets/sheet1.xml": "<!DOCTYPE x><x/>" }));
  const corrupt = Buffer.from(original);
  const central = corrupt.readUInt32LE(corrupt.length - 6);
  corrupt.writeUInt32LE(0, central + 16);
  assert.throws(() => readOffice("a.xlsx", corrupt));
});

test("Office 保存复用指纹保护：不覆盖 Agent 修改、删除后的文件或无指纹请求", async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "office-"));
  const file = path.join(root, "a.docx");
  const old = zip({ "word/document.xml": "<doc>old</doc>" });
  const other = zip({ "word/document.xml": "<doc>agent</doc>" });
  fs.writeFileSync(file, old);
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
    const req = Readable.from([Buffer.from(JSON.stringify({ workdir: root, path: "a.docx", editor: "office", ...body }))]);
    await work.routes["POST /api/work/" + route](req, res);
    return JSON.parse(res.body);
  };
  try {
    const read = await call("read", {});
    assert.equal(read.parts["word/document.xml"], "<doc>old</doc>");
    const parts = { "word/document.xml": "<doc>mine</doc>" };
    const noSig = await call("write", { parts });
    assert.ok(noSig.error);
    assert.deepEqual(fs.readFileSync(file), old);
    fs.writeFileSync(file, other);
    const stale = await call("write", { parts, seen: read.sig });
    assert.equal(stale.stale, true);
    assert.deepEqual(fs.readFileSync(file), other);
    const fresh = await call("read", {});
    const saved = await call("write", { parts, seen: fresh.sig });
    assert.match(saved.sig, /^[0-9a-f]{16}$/);
    assert.equal(readOffice("a.docx", fs.readFileSync(file))["word/document.xml"], "<doc>mine</doc>");
    fs.unlinkSync(file);
    assert.equal((await call("write", { parts, seen: saved.sig })).stale, true);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
