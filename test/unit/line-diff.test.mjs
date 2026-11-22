import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { changeHunks, countLines, splitLines } = createRequire(import.meta.url)("../../server/work/text.js");
const lineDiffCounts = (before, after) => {
  const { added, removed } = changeHunks(before, after);
  return { added, removed };
};

test("覆盖写只算真改的行，不整删整增", () => {
  const before = "a\nb\nc\nd\ne\n",
    after = "a\nB\nc\nd\ne\nf\n";
  assert.deepEqual(lineDiffCounts(before, after), { added: 2, removed: 1 });
});

test("原样写回不算改；清空与从无到有各算整份", () => {
  assert.deepEqual(lineDiffCounts("x\ny\n", "x\ny\n"), { added: 0, removed: 0 });
  assert.deepEqual(lineDiffCounts("x\ny\n", ""), { added: 0, removed: 2 });
  assert.deepEqual(lineDiffCounts("", "x\ny"), { added: 2, removed: 0 });
});

test("换行符不同不算改；末尾换行与行数的算法和 countLines 一致", () => {
  assert.deepEqual(lineDiffCounts("a\r\nb\r\n", "a\nb\n"), { added: 0, removed: 0 });
  const samples = [
    ["", []],
    ["一", ["一"]],
    ["一\n二\n三\n", ["一", "二", "三"]],
    ["\n", [""]],
    ["\r\n\n", ["", ""]],
    ["一\r\n二\n\r\n", ["一", "二", ""]],
    ["a\r\r\nb\r", ["a\r", "b\r"]],
    ["a\n\u2028\u2029", ["a", "\u2028\u2029"]]
  ];
  for (const [text, expected] of samples) {
    assert.deepEqual(splitLines(text), expected, JSON.stringify(text));
    assert.equal(countLines(text), expected.length, JSON.stringify(text));
    assert.deepEqual(lineDiffCounts("", text), { added: expected.length, removed: 0 });
  }
});

test("桥接切行与只数行各自保留非字符串归一", () => {
  for (const value of [0, false, NaN, 0n]) {
    assert.deepEqual(lineDiffCounts(value, ""), { added: 0, removed: 1 });
    assert.equal(countLines(value), 0);
  }
  for (const value of [null, undefined, []]) {
    assert.deepEqual(lineDiffCounts(value, ""), { added: 0, removed: 0 });
    assert.equal(countLines(value), 0);
  }
  const multiline = { toString: () => "一\r\n二\n" };
  assert.deepEqual(lineDiffCounts(multiline, ""), { added: 0, removed: 2 });
  assert.equal(countLines(multiline), 2);
});
