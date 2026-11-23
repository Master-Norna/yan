import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { estimateText } = load(["estimateText"]);

test("估字数沿用原来的汉字范围，其余按 UTF-16 长度折算", () => {
  const boundaries = "\u33ff\u3400\u4e00\u9fff\ua000";
  for (const [text, expected] of [
    ["", 0],
    ["abcde", 2],
    ["㐀中鿿", 3],
    ["㐀a中b鿿cde", 5],
    [boundaries.repeat(4), 14],
    ["中𠮷🙂abc", 3],
    ["简洁中文".repeat(30_000), 120_000]
  ])
    assert.equal(estimateText(text), expected);
});
