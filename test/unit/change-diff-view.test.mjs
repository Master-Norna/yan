// 点开改动的人是来看 diff 的：文件大、改动多、行很长，都不能把它省掉（见 src/15-tools/22-changes.js）。
// 这些用例接着页面那一步断言：画出的增删等于真实增删，最后一处改动也在页面上
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const view = load(["splitDiffHtml", "changeDiffHtml"]);

const plain = (n, tag = "行") => Array.from({ length: n }, (_, i) => `第 ${i + 1} ${tag}：一二三四五六七八九十`);
const textOf = lines => `${lines.join("\n")}\n`;
const step = (id, name, args, extra = {}) => ({ id, name, status: "done", arguments: JSON.stringify(args), ...extra });

test("六百行的文件改第 2、591 行：画出的增删就是 2/2，最后一处也在页面上", () => {
  const lines = plain(600),
    changed = lines.slice();
  changed[1] = "第 2 行：前一处";
  changed[590] = "第 591 行：后一处";
  const drawn = view.splitDiffHtml(textOf(lines), textOf(changed));
  assert.deepEqual({ added: drawn.added, removed: drawn.removed }, { added: 2, removed: 2 });
  assert.match(drawn.html, /前一处/);
  assert.match(drawn.html, /后一处/);
});

test("两千行的文件改第 11、1901 行：改在文件后头也看得见", () => {
  const lines = plain(2000),
    changed = lines.slice();
  changed[10] = "第 11 行：前一处";
  changed[1900] = "第 1901 行：后一处";
  const drawn = view.splitDiffHtml(textOf(lines), textOf(changed));
  assert.deepEqual({ added: drawn.added, removed: drawn.removed }, { added: 2, removed: 2 });
  assert.match(drawn.html, /后一处/);
});

test("四百行的文件改四十处：四十处都画出来，一处也不省", () => {
  const lines = plain(400),
    changed = lines.slice();
  for (let i = 9; i < 400; i += 10) changed[i] = `第 ${i + 1} 行：改了`;
  const drawn = view.splitDiffHtml(textOf(lines), textOf(changed));
  assert.deepEqual({ added: drawn.added, removed: drawn.removed }, { added: 40, removed: 40 });
  assert.equal((drawn.html.match(/改了/g) || []).length, 40);
});

test("中间插入一千二百行：只增不删，尾随的未改行不被画成删除", () => {
  const lines = plain(600),
    inserted = [...lines.slice(0, 300), ...Array.from({ length: 1200 }, (_, i) => `新 ${i}`), ...lines.slice(300)];
  const drawn = view.splitDiffHtml(textOf(lines), textOf(inserted));
  assert.deepEqual({ added: drawn.added, removed: drawn.removed }, { added: 1200, removed: 0 });
  assert.doesNotMatch(drawn.html, /class="d"/);
});

test("单行七万多字的 JSON 改末尾：预览不空白，改动那一处画得出来", () => {
  const long = `{"data":"${"x".repeat(78800)}","tail":1}`,
    changed = `${long.slice(0, -2)}2}`;
  const drawn = view.splitDiffHtml(`${long}\n`, `${changed}\n`);
  assert.deepEqual({ added: drawn.added, removed: drawn.removed }, { added: 1, removed: 1 });
  assert.ok(drawn.html.length > 100);
  assert.match(drawn.html, /<mark>/);
  // 改动是 1 变 2：两侧各自标出来，不是只剩一句「这一行太长」
  assert.match(drawn.html, /<mark>1<\/mark>/);
  assert.match(drawn.html, /<mark>2<\/mark>/);
  assert.doesNotMatch(drawn.html, /<span class="d">…（这一行太长/);
});

test("大段替换撑不开行迹：先看二十行，余下的写明可展开", () => {
  const before = Array.from({ length: 3000 }, (_, i) => `旧 ${i}`),
    after = Array.from({ length: 3000 }, (_, i) => `新 ${i}`);
  const drawn = view.splitDiffHtml(textOf(before), textOf(after), { limit: 20 });
  assert.equal(drawn.clipped, true);
  assert.equal(drawn.rows, 3000);
  assert.equal((drawn.html.match(/<span class="[di]"/g) || []).length, 40); // 二十行，左右各一格
});

test("摘录里的「跳过 N 行未改」画得出来，不被当成未改行省掉", () => {
  const lines = plain(600),
    changed = lines.slice();
  changed[1] = "前一处";
  changed[590] = "后一处";
  // 与页面 hunksText 拼出来的一样：两块之间一句跳过
  const back = {
    old: `第 1 行：一二三四五六七八九十\n第 2 行：一二三四五六七八九十\n第 3 行：一二三四五六七八九十\n…（跳过 585 行未改）\n第 589 行：一二三四五六七八九十\n第 590 行：一二三四五六七八九十\n第 591 行：一二三四五六七八九十`,
    new: `第 1 行：一二三四五六七八九十\n前一处\n第 3 行：一二三四五六七八九十\n…（跳过 585 行未改）\n第 589 行：一二三四五六七八九十\n第 590 行：一二三四五六七八九十\n后一处`
  };
  const drawn = view.splitDiffHtml(back.old, back.new, { all: true });
  assert.match(drawn.html, /跳过 585 行未改/);
  assert.deepEqual({ added: drawn.added, removed: drawn.removed }, { added: 2, removed: 2 });
});

test("新建之后再整份改写：预览只看最后一版对空的多行，与清单「只增不删」一致", () => {
  const message = {
    steps: [
      step(
        "a",
        "write_file",
        { path: "x.txt", content: "一\n二\n" },
        {
          change: { path: "x.txt", added: 2, removed: 0, created: true, lines: 2 }
        }
      ),
      step(
        "b",
        "write_file",
        { path: "x.txt", content: "一\n二\n三\n" },
        {
          diff: { hunks: [{ oldStart: 0, newStart: 0, oldCount: 2, newCount: 3 }], old: "一\n二" },
          change: { path: "x.txt", added: 1, removed: 0, created: false, lines: 3 }
        }
      )
    ]
  };
  const html = view.changeDiffHtml(message, "x.txt");
  assert.equal((html.match(/tool-diff/g) || []).length, 1);
  assert.doesNotMatch(html, /class="d"/);
  assert.match(html, /三/);
});

test("覆盖写的 hunks：新侧从这一步的参数取，画出的增删与清单一致", () => {
  const lines = plain(300),
    changed = lines.slice();
  changed[298] = "第 299 行：这一行改了";
  const message = {
    steps: [
      step(
        "a",
        "write_file",
        { path: "big.txt", content: textOf(changed) },
        {
          diff: {
            hunks: [{ oldStart: 296, newStart: 296, oldCount: 4, newCount: 4 }],
            old: [lines[296], lines[297], lines[298], lines[299]].join("\n")
          },
          change: { path: "big.txt", added: 1, removed: 1, created: false, lines: 300 }
        }
      )
    ]
  };
  const html = view.changeDiffHtml(message, "big.txt");
  assert.match(html, /这一行改了/);
  assert.equal((html.match(/class="d"/g) || []).length, 1);
  assert.equal((html.match(/class="i"/g) || []).length, 1);
});

test("改文件那一步不另存 diff：old/new 在参数里，预览照样画得出", () => {
  const message = {
    steps: [
      step(
        "a",
        "edit_file",
        { path: "a.txt", old: "甲\n乙\n丙", new: "甲\nB\n丙" },
        {
          change: { path: "a.txt", added: 1, removed: 1, lines: 3 }
        }
      )
    ]
  };
  const html = view.changeDiffHtml(message, "a.txt");
  assert.match(html, /B/);
  assert.equal((html.match(/class="d"/g) || []).length, 1);
  assert.equal((html.match(/class="i"/g) || []).length, 1);
});

test("早先存下的步骤照旧画：diff.old/new 与 written/previous 两种旧样子都认", () => {
  const oldStyle = {
    steps: [
      step(
        "a",
        "edit_file",
        { path: "b.txt" },
        {
          diff: { old: "甲\n乙", new: "甲\n丙" },
          change: { path: "b.txt", added: 1, removed: 1 }
        }
      )
    ]
  };
  assert.match(view.changeDiffHtml(oldStyle, "b.txt"), /丙/);
  const writtenStyle = {
    steps: [
      step(
        "b",
        "write_file",
        { path: "c.txt" },
        {
          previous: "一\n二\n",
          written: "一\n三\n",
          change: { path: "c.txt", added: 1, removed: 1, lines: 2 }
        }
      )
    ]
  };
  assert.match(view.changeDiffHtml(writtenStyle, "c.txt"), /三/);
});
