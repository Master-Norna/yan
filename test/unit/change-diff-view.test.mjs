// 点开改动的人是来看 diff 的：文件大、改动多、行很长，都不能把它省掉（见 src/15-tools/22-changes.js）。
// 这些用例接着页面那一步断言：画出的增删等于真实增删，最后一处改动也在页面上
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const require = createRequire(import.meta.url);
const { changeHunks } = require("../../server/work/text.js");
const view = load(["splitDiffHtml", "changeDiffHtml", "stepDiffParts", "workStepHtml", "stepDiffRender"]);

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
  const h = changeHunks(textOf(lines), textOf(changed));
  const message = {
    steps: [
      step(
        "a",
        "write_file",
        { path: "skip.txt", content: textOf(changed) },
        {
          diff: { hunks: h.hunks, old: h.old },
          change: { path: "skip.txt", added: h.added, removed: h.removed, created: false, lines: 600 }
        }
      )
    ]
  };
  const html = view.changeDiffHtml(message, "skip.txt");
  assert.match(html, /…（跳过 \d+ 行未改）/);
  assert.equal((html.match(/class="d"/g) || []).length, 2);
  assert.equal((html.match(/class="i"/g) || []).length, 2);
  // 提示两侧同文，是未改行，不能挂上红绿
  assert.doesNotMatch(html, /<span class="[di]">…（跳过/);
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

test("参数写了别名（contents / old_string）：照运行时那一套归位，预览与行迹不空白", () => {
  // 运行时本来就会把 contents 归成 content、old_string 归成 old（见 01-arguments.js 的 TOOL_ARG_ALIASES），
  // 页面只看正名的话，这些步骤在预览与行迹里就是一片空白，清单上却照样有增删
  const message = {
    steps: [
      step(
        "a",
        "write_file",
        { path: "n.txt", contents: "一\n二\n三" },
        { change: { path: "n.txt", added: 3, removed: 0, created: true, lines: 3 } }
      ),
      step(
        "b",
        "edit_file",
        { path: "n.txt", old_string: "甲", new_string: "乙" },
        { change: { path: "n.txt", added: 1, removed: 1, lines: 3 } }
      )
    ]
  };
  assert.equal(view.stepDiffParts(message.steps[0])?.new, "一\n二\n三");
  assert.deepEqual(view.stepDiffParts(message.steps[1]), { old: "甲", new: "乙" });
  const html = view.changeDiffHtml(message, "n.txt");
  assert.match(html, /二/);
  assert.match(html, /乙/);
});

test("删了一行、新的一侧隔着六十行新行才有像它的：仍配得上，改的字标得出来", () => {
  // 配对不设窗口：按「删的条数 × 增的条数」封在四万以内，平方的代价本就有上限；
  // 设五十行的窗口会把删的那行配到不相干的新行上，本该标的改字整条丢掉
  const before = "第 1 行：原来的一行\n",
    after = `${Array.from({ length: 60 }, (_, i) => `全新的第 ${i} 件`).join("\n")}\n第 1 行：原来的一行，改过了\n`;
  const drawn = view.splitDiffHtml(before, after);
  // 只标真有改动的那一侧（旧的那行整行删掉，新的一行是加的），所以恰是一个
  assert.equal((drawn.html.match(/<mark>/g) || []).length, 1);
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

test("覆盖写摘录的最后一行是空行：那一行不被当成文件末尾的换行吃掉，两侧对得上", () => {
  const oldText = "甲\n\n丙\n\n",
    newText = "甲\n\n丙改了\n\n\n庚";
  const d = changeHunks(oldText, newText);
  const message = {
    steps: [
      step(
        "a",
        "write_file",
        { path: "blank.txt", content: newText },
        {
          diff: { hunks: d.hunks, old: d.old },
          change: { path: "blank.txt", added: d.added, removed: d.removed, created: false, lines: 6 }
        }
      )
    ]
  };
  const html = view.changeDiffHtml(message, "blank.txt");
  // 旧版 4 行（最后两行都是空行），新版 6 行：删 1 增 3，画出来也得是 1/3
  assert.equal((html.match(/class="d"/g) || []).length, 1);
  assert.equal((html.match(/class="i"/g) || []).length, 3);
});

test("新建的件先跑后成：缓存也认 change，红绿画得出来", () => {
  const st = step("a", "write_file", { path: "new.txt", content: "甲\n乙\n" }, { status: "running" });
  assert.equal(view.stepDiffParts(st), null);
  st.change = { path: "new.txt", added: 2, removed: 0, created: true, lines: 2 };
  st.status = "done";
  const parts = view.stepDiffParts(st);
  assert.ok(parts);
  assert.equal(parts.old, "");
  assert.equal(parts.new, "甲\n乙\n");
});

test("报错的那一步不摊红绿：old/new 在参数里，也不当成已改", () => {
  const bad = {
    id: "e",
    name: "edit_file",
    status: "error",
    arguments: JSON.stringify({ path: "a.txt", old: "旧", new: "新" }),
    result: "old 对不上"
  };
  assert.doesNotMatch(view.workStepHtml(bad, "a.txt"), /tool-diff/);
  const ok = { ...bad, status: "done" };
  assert.match(view.workStepHtml(ok, "a.txt"), /tool-diff/);
});

test("一千行的文件把三十行挪到远处：两块分开比，增删是 30/30，跳过提示不在红绿里", () => {
  // 拼成一整段再比时，窗口之间会拿挪走的那段去配挪到的位置，被挪的三十行认成未改，
  // 上下文与跳过提示反而画成红绿（最小增删会从 30/30 掉成 7/7）
  const lines = plain(1000),
    moved = lines.slice(100, 130),
    rest = [...lines.slice(0, 100), ...lines.slice(130)],
    changed = [...rest.slice(0, 769), ...moved, ...rest.slice(769)],
    d = changeHunks(textOf(lines), textOf(changed));
  assert.deepEqual({ added: d.added, removed: d.removed }, { added: 30, removed: 30 });
  assert.equal(d.hunks.length, 2);
  const message = {
    steps: [
      step(
        "a",
        "write_file",
        { path: "move.txt", content: textOf(changed) },
        {
          diff: { hunks: d.hunks, old: d.old },
          change: { path: "move.txt", added: d.added, removed: d.removed, created: false, lines: 1000 }
        }
      )
    ]
  };
  const html = view.changeDiffHtml(message, "move.txt");
  assert.equal((html.match(/class="d"/g) || []).length, 30);
  assert.equal((html.match(/class="i"/g) || []).length, 30);
  assert.match(html, /…（跳过 \d+ 行未改）/);
  // 提示是未改行，两侧同文，不能挂上红绿
  assert.doesNotMatch(html, /<span class="[di]">…（跳过/);
});

test("同一步骤重画：红绿按 limit 与 wrap 记着，不重跑比法；参数变了整份换新", () => {
  const lines = plain(300),
    changed = lines.slice();
  changed[150] = "第 151 行：改了";
  const d = changeHunks(textOf(lines), textOf(changed));
  const st = step(
    "a",
    "write_file",
    { path: "cache.txt", content: textOf(changed) },
    {
      diff: { hunks: d.hunks, old: d.old },
      change: { path: "cache.txt", added: 1, removed: 1, created: false, lines: 300 }
    }
  );
  const first = view.stepDiffRender(st, { limit: 20, wrap: false }),
    again = view.stepDiffRender(st, { limit: 20, wrap: false }),
    full = view.stepDiffRender(st, { limit: Infinity, wrap: true });
  assert.equal(first, again);
  assert.notEqual(first, full);
  // 参数变了：缓存整份换新，不拿旧的 HTML
  st.arguments = JSON.stringify({ path: "cache.txt", content: textOf([...changed, "又一行"]) });
  const after = view.stepDiffRender(st, { limit: 20, wrap: false });
  assert.notEqual(after, first);
});

test("摘录分块比出来的增删，与整份清单一致：随机改五十回", () => {
  let seed = 11;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 50; round++) {
    const before = plain(40 + Math.floor(next() * 160)),
      after = before.slice();
    for (let k = 0, edits = 1 + Math.floor(next() * 6); k < edits; k++) {
      const at = Math.floor(next() * after.length),
        kind = next();
      if (kind < 0.45) after[at] = `第 ${round}-${k} 处改了`;
      else if (kind < 0.75) after.splice(at, 0, ...Array.from({ length: 1 + Math.floor(next() * 4) }, (_, i) => `插 ${round}-${k}-${i}`));
      else if (after.length > 1) after.splice(at, 1);
    }
    const h = changeHunks(textOf(before), textOf(after));
    if (!h.hunks.length) continue;
    const st = step(
      "a",
      "write_file",
      { path: "rand.txt", content: textOf(after) },
      {
        diff: { hunks: h.hunks, old: h.old },
        change: { path: "rand.txt", added: h.added, removed: h.removed, created: false, lines: after.length }
      }
    );
    const drawn = view.stepDiffRender(st, { limit: Infinity, wrap: true });
    assert.deepEqual({ added: drawn.added, removed: drawn.removed }, { added: h.added, removed: h.removed }, `round ${round}`);
  }
});

test("省略提示都走 i18n：英文表里有这几句", () => {
  const en = readFileSync(new URL("../../i18n/en.js", import.meta.url), "utf8");
  for (const key of ["…（跳过 {0} 行未改）", "…（前 {0} 字略）", "…（后 {0} 字略）", "…（中间 {0} 字略）", "…（{0} 字略）"])
    assert.ok(en.includes(`"${key}"`), `${key} 不在 i18n/en.js`);
});
