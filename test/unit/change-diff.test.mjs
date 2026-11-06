// 改动要看得全：覆盖写只存旧侧的行与两侧行号，新侧在参数里，按行号切回来（见 server/work/text.js 的 changeHunks）。
// 这里既测摘出来的窗口，也把它接到页面的 splitDiffHtml 上，看画出的增删与清单对不对得上
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");
const { changeHunks } = require("../../server/work/text.js");
import { load } from "./harness.mjs";

const lineDiffCounts = (before, after) => {
  const { added, removed } = changeHunks(before, after);
  return { added, removed };
};

const view = load(["splitDiffHtml", "diffCounts"]);

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

const plain = (n, tag = "行") => Array.from({ length: n }, (_, i) => `第 ${i + 1} ${tag}：一二三四五六七八九十`);
const textOf = lines => `${lines.join("\n")}\n`;

// 把 hunks 与这一步的参数拼回两侧：与页面上 hunksText 的算法一致（这里是照着它的规矩写的核对）。
// 末尾补一个换行：页面那边 diffLines 会剥掉它，最后一行恰是空行时才不会被当成文件末尾的换行
function rebuild(diff, content) {
  const b = content.replace(/\r?\n$/, "").split(/\r?\n/),
    oldRows = diff.old ? diff.old.split("\n") : [],
    old = [],
    next = [];
  let cursor = 0,
    prevEnd = 0;
  for (const hunk of diff.hunks) {
    const skip = hunk.oldStart - prevEnd;
    if (skip > 0) {
      old.push(`…（跳过 ${skip} 行未改）`);
      next.push(`…（跳过 ${skip} 行未改）`);
    }
    for (let i = 0; i < hunk.oldCount; i++) old.push(oldRows[cursor + i] ?? "");
    for (const line of b.slice(hunk.newStart, hunk.newStart + hunk.newCount)) next.push(line);
    cursor += hunk.oldCount;
    prevEnd = hunk.oldStart + hunk.oldCount;
  }
  const asText = lines => (lines.length ? `${lines.join("\n")}\n` : "");
  return { old: asText(old), new: asText(next) };
}

test("改在文件末尾：窗口指到那一行，旧侧带着原文，新侧按行号取得到", () => {
  const lines = plain(300),
    changed = lines.slice();
  changed[298] = "第 299 行：这一行改了";
  const h = changeHunks(textOf(lines), textOf(changed));
  assert.equal(h.hunks.length, 1);
  assert.deepEqual({ added: h.added, removed: h.removed }, { added: 1, removed: 1 });
  assert.match(h.old, /第 299 行：一二三四五六七八九十/);
  const back = rebuild(h, textOf(changed));
  assert.match(back.new, /第 299 行：这一行改了/);
  // 两侧行数一样，并排比才不错位
  assert.equal(back.old.split("\n").length, back.new.split("\n").length);
});

test("多处改动都取到；未改的行只留上下几行，中间写明跳过了多少", () => {
  const lines = plain(300),
    changed = lines.slice();
  changed[9] = "第 10 行：第一处";
  changed[249] = "第 250 行：第二处";
  const h = changeHunks(textOf(lines), textOf(changed), { context: 2 });
  assert.equal(h.hunks.length, 2);
  const back = rebuild(h, textOf(changed));
  assert.match(back.new, /第一处/);
  assert.match(back.new, /第二处/);
  assert.match(back.new, /…（跳过 \d+ 行未改）/);
  assert.doesNotMatch(back.new, /第 50 行/);
});

test("原样写回没有可摘的；整份改写只当一块", () => {
  assert.deepEqual(changeHunks("a\nb\nc\n", "a\nb\nc\n"), { hunks: [], old: "", added: 0, removed: 0 });
  const rewritten = changeHunks("a\nb\nc\n", "x\ny\nz\n");
  assert.equal(rewritten.hunks.length, 1);
  assert.equal(rewritten.old, "a\nb\nc");
  assert.equal(rewritten.added, 3);
  assert.equal(rewritten.removed, 3);
});

test("相距五百多行的两处改动都取到，不因隔得远退成整块", () => {
  const lines = plain(600),
    changed = lines.slice();
  changed[1] = "第 2 行：前一处";
  changed[590] = "第 591 行：后一处";
  assert.deepEqual(lineDiffCounts(textOf(lines), textOf(changed)), { added: 2, removed: 2 });
  const h = changeHunks(textOf(lines), textOf(changed));
  assert.equal(h.hunks.length, 2);
  const back = rebuild(h, textOf(changed));
  assert.match(back.new, /前一处/);
  assert.match(back.new, /后一处/);
});

test("中间插入一千二百行：只增不删，尾随的未改行不算删", () => {
  const lines = plain(600),
    inserted = [...lines.slice(0, 300), ...Array.from({ length: 1200 }, (_, i) => `新 ${i}`), ...lines.slice(300)];
  assert.deepEqual(lineDiffCounts(textOf(lines), textOf(inserted)), { added: 1200, removed: 0 });
  const h = changeHunks(textOf(lines), textOf(inserted));
  assert.equal(h.added, 1200);
  assert.equal(h.removed, 0);
});

test("隔行改五百零一处、改动量过千步：计数仍精确，不退成整块一删一增", () => {
  // 五百处正好是 1000 步，压在 Myers 的上限上、不进回落那条路；要 501 处（1002 步）才真的走表比
  const lines = plain(2004),
    changed = lines.slice();
  for (let i = 0; i < lines.length; i += 4) changed[i] = `第 ${i + 1} 行：改了`;
  const n = changed.filter((line, i) => line !== lines[i]).length;
  assert.equal(n, 501);
  // 整块一删一增会把 501 处报成 1002 删 + 1002 增；照旧用表比才是一处一对，正如清单上看到的
  assert.deepEqual(lineDiffCounts(textOf(lines), textOf(changed)), { added: n, removed: n });
  const h = changeHunks(textOf(lines), textOf(changed));
  assert.deepEqual({ added: h.added, removed: h.removed }, { added: n, removed: n });
  // 每处相隔四行、前后各三行上下文，全都并成一块；拼回来的新侧就是整份新版
  assert.equal(h.hunks.length, 1);
  const back = rebuild(h, textOf(changed));
  assert.equal(back.new, textOf(changed));
});

test("极扁的形状（三千行只剩三行）：走了表比也照样准，表按一条摊平不越界", () => {
  // 两版行数之积很小、改动量却远超 Myers 的步数上限，正好走 dpOps；宽是三，行却是三千
  const before = plain(3000),
    after = ["新的第一行", "新的第二行", "新的第三行"];
  assert.deepEqual(lineDiffCounts(textOf(before), textOf(after)), { added: 3, removed: 3000 });
});

test("十五万行的整份改写不抛 RangeError（回溯不摊进 push 的参数）", () => {
  const before = "a\n".repeat(150000),
    after = "b\n".repeat(150000);
  assert.deepEqual(lineDiffCounts(before, after), { added: 150000, removed: 150000 });
  const h = changeHunks(before, after);
  assert.equal(h.hunks.length, 1);
  assert.equal(h.added, 150000);
});

test("覆盖写一份大文件：桥接捎回旧侧与行号，不再只给开头 4000 字", async () => {
  const lines = plain(300),
    changed = lines.slice();
  changed[298] = "第 299 行：这一行改了";
  writeFileSync(path.join(root, "big.txt"), textOf(lines));
  const { status, data } = await call("write", { path: "big.txt", content: textOf(changed), unseen: false });
  assert.equal(status, 200);
  assert.equal(data.added, 1);
  assert.equal(data.removed, 1);
  // 改在第 299 行：旧侧窗口得到那一段，previous 那截开头不再冒充「旧的一版」
  assert.equal(data.previous, undefined);
  assert.match(data.diff.old, /第 299 行：一二三四五六七八九十/);
  assert.ok(!data.diff.old.includes("第 150 行"));
  // 页面按行号取新侧，画出来的增删与清单一致
  const back = rebuild(data.diff, textOf(changed)),
    drawn = view.splitDiffHtml(back.old, back.new);
  assert.deepEqual({ added: drawn.added, removed: drawn.removed }, { added: 1, removed: 1 });
  assert.match(drawn.html, /这一行改了/);
});

test("小文件也给 hunks：同一个工具不按文件大小分两种样子", async () => {
  writeFileSync(path.join(root, "small.txt"), "甲\n乙\n丙\n");
  const { data } = await call("write", { path: "small.txt", content: "甲\nB\n丙\n", unseen: false });
  assert.equal(data.previous, undefined);
  assert.equal(data.diff.hunks.length, 1);
  assert.equal(data.diff.old, "甲\n乙\n丙");
  assert.equal(readFileSync(path.join(root, "small.txt"), "utf8"), "甲\nB\n丙\n");
});

test("比法与朴素的最长公共子序列对得上：随机两百对", () => {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 200; round++) {
    const n = Math.floor(next() * 30),
      m = Math.floor(next() * 30),
      a = Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(next() * 4))),
      b = Array.from({ length: m }, () => String.fromCharCode(97 + Math.floor(next() * 4))),
      dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const lcs = dp[0][0],
      want = { added: m - lcs, removed: n - lcs },
      before = a.join("\n"),
      after = b.join("\n");
    assert.deepEqual(lineDiffCounts(before, after), want);
    assert.deepEqual(view.diffCounts(before, after), want);
  }
});

test("新建的件没有旧侧，不给 diff", async () => {
  const { data } = await call("write", { path: "fresh.txt", content: "一\n二\n", unseen: true });
  assert.equal(data.diff, undefined);
  assert.equal(data.added, 2);
  assert.equal(data.removed, 0);
});
