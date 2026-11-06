import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { changeHunks, countLines } = createRequire(import.meta.url)("../../server/work/text.js");
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
  const text = "一\n二\n三\n";
  assert.equal(lineDiffCounts("", text).added, countLines(text));
});
