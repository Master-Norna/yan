// 正文里的图与附件按名找回：srcset 的取法与文件名解码（src/04-markdown/00-markdown.js）。
// 两条都是 2026-11-16 那轮审查查出的边角：src="" 吞掉 srcset 指着的图；目录名里带裸 % 时，
// 文件名的 %20 留成盘上不存在的名字，按同名找回也找不着。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("srcset 取第一个候选：data: 里的逗号是它自己的，不能按逗号切", () => {
  const f = load(["firstSrcsetCandidate"]);
  assert.equal(f.firstSrcsetCandidate("p.png 2x, q.png 3x"), "p.png");
  assert.equal(f.firstSrcsetCandidate("  p.png  "), "p.png");
  assert.equal(f.firstSrcsetCandidate("data:image/png;base64,AAAA 1x"), "data:image/png;base64,AAAA");
  assert.equal(f.firstSrcsetCandidate(""), "");
  assert.equal(f.firstSrcsetCandidate(null), "");
});

test("localFileName：目录段带裸 % 时仍解得开末段；反斜杠路、%23 照旧认得出", () => {
  const f = load(["localFileName"]);
  // 整条解不开，只解末段
  assert.equal(f.localFileName("50%off/a%20b.docx"), "a b.docx");
  assert.equal(f.localFileName("50%off/图%201.png"), "图 1.png");
  // 原样的几条不能坏
  assert.equal(f.localFileName("plot%231.png"), "plot#1.png");
  assert.equal(f.localFileName("C:%5Ca%20b.png"), "a b.png");
  assert.equal(f.localFileName(""), "");
  assert.equal(f.localFileName("https://x/a.png"), "");
});
