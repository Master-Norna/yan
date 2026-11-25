import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { once } from "node:events";
import { createRequire } from "node:module";

const { receiveUpload, sendFile } = createRequire(import.meta.url)("../../server/http.js");

function upload(data) {
  const head = Buffer.from("{}"),
    req = Readable.from([Buffer.concat([head, data])]);
  req.url = `/upload?head=${head.length}`;
  return req;
}

test("原件直传遇短写，仍逐字节收全", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-transfer-")),
    file = path.join(dir, "upload");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const original = fs.promises.open;
  t.mock.method(fs.promises, "open", async (...args) => {
    const out = await original(...args),
      write = out.write.bind(out);
    out.write = (buffer, offset = 0, length = buffer.length - offset) => write(buffer, offset, Math.min(length, 3));
    return out;
  });
  const data = Buffer.from("完整的附件");
  const result = await receiveUpload(upload(data), 1024, () => file);
  assert.equal(result.bytes, data.length);
  assert.deepEqual(fs.readFileSync(file), data);
});

test("原件直传遇零字节写入，不报成功且清理半成品", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-transfer-")),
    file = path.join(dir, "upload");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const original = fs.promises.open;
  t.mock.method(fs.promises, "open", async (...args) => {
    const out = await original(...args);
    out.write = async () => ({ bytesWritten: 0 });
    return out;
  });
  await assert.rejects(receiveUpload(upload(Buffer.from("data")), 1024, () => file), /没有进展/);
  assert.equal(fs.existsSync(file), false);
});

test("临时文件独占创建失败，不删除别人的既存文件", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-transfer-")),
    file = path.join(dir, "upload");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(file, "other");
  await assert.rejects(receiveUpload(upload(Buffer.from("data")), 1024, () => file), { code: "EEXIST" });
  assert.equal(fs.readFileSync(file, "utf8"), "other");
});

test("预览或下载途中断开，关闭未读完的文件流", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-transfer-")),
    file = path.join(dir, "download");
  fs.writeFileSync(file, Buffer.alloc(1024 * 1024));
  let source;
  const original = fs.createReadStream;
  t.mock.method(fs, "createReadStream", (...args) => (source = original(...args)));
  const res = new Writable({ highWaterMark: 1, write: () => {} });
  res.writeHead = () => {};
  t.after(async () => {
    if (source && !source.closed) {
      const closed = once(source, "close");
      source.destroy();
      await closed;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await sendFile({ headers: {}, method: "GET" }, res, file, { name: "download.bin" });
  await once(source, "data");
  const closed = once(res, "close");
  res.destroy();
  await closed;
  assert.equal(source.destroyed, true, "不能留下暂停但还开着文件的流");
});
