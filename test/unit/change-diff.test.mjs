// 改动要看得全：整份存不下时按改动摘出两侧同一批窗口，改在文件后头也看得见（见 server/work/text.js 的 changeExcerpts）
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");
const { changeExcerpts } = require("../../server/work/text.js");

const root = path.resolve("test/.tmp/change-diff");
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

const lines = Array.from({ length: 300 }, (_, i) => `第 ${i + 1} 行：一二三四五六七八九十`);
const oldText = `${lines.join("\n")}\n`;
const changed = lines.slice();
changed[298] = "第 299 行：这一行改了";
const newText = `${changed.join("\n")}\n`;

test("改在文件末尾：摘出的两侧都带着这一行，不是两段一样的开头", () => {
  const excerpt = changeExcerpts(oldText, newText);
  assert.equal(excerpt.hunks, 1);
  assert.match(excerpt.old, /第 299 行：一二三四五六七八九十/);
  assert.match(excerpt.new, /第 299 行：这一行改了/);
  // 两侧行数一样，并排比才不错位
  assert.equal(excerpt.old.split("\n").length, excerpt.new.split("\n").length);
});

test("多处改动都摘到；未改的行只留上下几行，中间写明跳过了多少", () => {
  const other = lines.slice();
  other[9] = "第 10 行：第一处";
  other[249] = "第 250 行：第二处";
  const excerpt = changeExcerpts(oldText, `${other.join("\n")}\n`, { context: 2, limit: 4000 });
  assert.equal(excerpt.hunks, 2);
  assert.match(excerpt.new, /第一处/);
  assert.match(excerpt.new, /第二处/);
  assert.match(excerpt.new, /…（跳过 \d+ 行未改）/);
  // 只留改动上下各两行：第 50 行左右的原样不该出现在摘录里
  assert.doesNotMatch(excerpt.new, /第 50 行/);
});

test("原样写回没有可摘的；整份改写只当一块", () => {
  assert.deepEqual(changeExcerpts(oldText, oldText), { old: "", new: "", hunks: 0, omitted: 0 });
  const rewritten = changeExcerpts("a\nb\nc\n", "x\ny\nz\n");
  assert.equal(rewritten.hunks, 1);
  assert.equal(rewritten.old, "a\nb\nc\n");
  assert.equal(rewritten.new, "x\ny\nz\n");
});

test("改动多到放不下：舍掉后头的窗口，并写明还剩几处", () => {
  const many = lines.slice();
  for (let i = 9; i < 300; i += 10) many[i] = `第 ${i + 1} 行：改了`;
  const excerpt = changeExcerpts(oldText, `${many.join("\n")}\n`, { limit: 300 });
  assert.ok(excerpt.omitted > 0);
  assert.match(excerpt.new, /…（另有 \d+ 处改动未列）/);
  assert.ok(excerpt.new.length < 400);
});

test("覆盖写一份大文件：桥接按改动捎回两侧，不再只给开头 4000 字", async () => {
  writeFileSync(path.join(root, "big.txt"), oldText);
  const { status, data } = await call("write", { path: "big.txt", content: newText, unseen: false });
  assert.equal(status, 200);
  assert.equal(data.added, 1);
  assert.equal(data.removed, 1);
  // 改在第 299 行：两侧摘录都得到那一段，previous 那截开头不再冒充「旧的一版」
  assert.equal(data.previous, undefined);
  assert.match(data.diff.old, /第 299 行：一二三四五六七八九十/);
  assert.match(data.diff.new, /第 299 行：这一行改了/);
  assert.ok(!data.diff.old.includes("第 150 行"));
});

test("小文件照旧整份给 previous，不给 diff", async () => {
  writeFileSync(path.join(root, "small.txt"), "甲\n乙\n丙\n");
  const { data } = await call("write", { path: "small.txt", content: "甲\nB\n丙\n", unseen: false });
  assert.equal(data.diff, undefined);
  assert.equal(data.previous, "甲\n乙\n丙\n");
  assert.equal(readFileSync(path.join(root, "small.txt"), "utf8"), "甲\nB\n丙\n");
});
