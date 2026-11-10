// read_file 的行数口径：末尾的一个换行不算多一行（与 write_file 那边的 countLines 同一个数法），
// 空文件是 0 行、也不再吐一行空的「   1| 」；分页 offset 的夹取跟着这个行数走，400 行 limit 400 时一次取完
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");
const { countLines } = require("../../server/work/text.js");

const root = path.resolve("test/.tmp/read-total-lines");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
after(() => rmSync(root, { recursive: true, force: true }));
const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });

async function call(route, body) {
  const req = Readable.from([Buffer.from(JSON.stringify({ workdir: root, ...body }))]);
  let status = 0,
    text = "";
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    on() {},
    writeHead(code) {
      status = code;
      this.headersSent = true;
    },
    end(chunk) {
      text = String(chunk || "");
      this.writableEnded = true;
    }
  };
  await work.routes[`POST /api/work/${route}`](req, res);
  return { status, data: JSON.parse(text || "{}") };
}
const put = (name, content) => writeFileSync(path.join(root, name), content);

test("空文件：0 行、0 行可见，text 里没有一行空的「   1| 」", async () => {
  put("empty.txt", "");
  const { status, data } = await call("read", { path: "empty.txt" });
  assert.equal(status, 200);
  assert.equal(data.totalLines, 0);
  assert.equal(data.shown, 0);
  assert.equal(data.text, "");
});

test("末尾一个换行：两行就是两行", async () => {
  put("two.txt", "第一行\n第二行\n");
  const { data } = await call("read", { path: "two.txt" });
  assert.equal(data.totalLines, 2);
  assert.equal(data.shown, 2);
  assert.equal(data.text, "   1| 第一行\n   2| 第二行");
});

test("末尾两个换行：仍是三行，最后一个空行算一行", async () => {
  put("three.txt", "a\nb\n\n");
  const { data } = await call("read", { path: "three.txt" });
  assert.equal(data.totalLines, 3);
  assert.equal(data.shown, 3);
  assert.equal(data.text, "   1| a\n   2| b\n   3| ");
});

test("400 行的文件 limit 400：一次取完，shown 与 totalLines 相等（目录记忆的 partial 判定据此）", async () => {
  put("big.txt", `${Array.from({ length: 400 }, (_, i) => `第 ${i + 1} 行`).join("\n")}\n`);
  const { data } = await call("read", { path: "big.txt", limit: 400 });
  assert.equal(data.totalLines, 400);
  assert.equal(data.shown, 400);
  assert.equal(data.text.split("\n").length, 400);
  // 取 399 行时仍分页，两边的数都不变
  const paged = await call("read", { path: "big.txt", limit: 399 });
  assert.equal(paged.data.totalLines, 400);
  assert.equal(paged.data.shown, 399);
  assert.equal(paged.data.text.split("\n").length, 399);
});

test("offset 超出末尾：夹到末行，不越界", async () => {
  put("abc.txt", "a\nb\nc\n");
  const { data } = await call("read", { path: "abc.txt", offset: 99 });
  assert.equal(data.totalLines, 3);
  assert.equal(data.offset, 3);
  assert.equal(data.shown, 1);
  assert.equal(data.text, "   3| c");
  // offset 0 与不传，都从第一行起
  const zero = await call("read", { path: "abc.txt", offset: 0, limit: 1 });
  assert.equal(zero.data.offset, 1);
  assert.equal(zero.data.text, "   1| a");
});

test("CRLF 与几种收尾：行数与 countLines 一个数法", async () => {
  const samples = ["a", "a\n", "a\nb", "a\nb\n", "a\nb\n\n", "\n", "", "a\r\nb\r\n", "a\r\n\r\n"];
  for (const [i, content] of samples.entries()) {
    const name = `sample-${i}.txt`;
    put(name, content);
    const { data } = await call("read", { path: name });
    assert.equal(data.totalLines, countLines(content), JSON.stringify(content));
  }
});
