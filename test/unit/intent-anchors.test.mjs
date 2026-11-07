// 意 · 凭据（src/19-intent/05-anchors.js）的两处规整：
//  1) dir 的空值不收成「.」——那等于罩住整个工作目录，收尾前对照的「改了而无凭据罩着」就静默失效；
//  2) covers 比路径不分大小写（与 intentPath 剥目录前缀同一个口径），别把已罩着的报成无主改动。
// 改动前两条用例都红。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load(["parseAnchor", "intentUnowned"]);

test("dir 的空值写不对；显式的「.」「./」照旧规整成「.」", () => {
  assert.match(f.parseAnchor("dir:").problem || "", /要一个目录/);
  assert.match(f.parseAnchor("dir:   ").problem || "", /要一个目录/);
  assert.equal(f.parseAnchor("dir:.").key, "dir:.");
  assert.equal(f.parseAnchor("dir:./").key, "dir:.");
  assert.ok(f.parseAnchor("file:").problem, "file 的空值本来就说写不对");
});

test("凭据罩文件与目录都不计较大小写（Windows）", () => {
  // 没了结的项才比凭据（了结的「不再附着、不比凭据」，见 00-core.js 的 intentClosed）
  const node = { claim: "甲成立", check: "看结果", needs: [], anchors: ["file:README.md", "dir:Src"], state: "doing", rev: 1, root: true },
    intent = { nodes: { 甲: node } };
  assert.deepEqual(f.intentUnowned(intent, ["readme.md", "src/a.js", "SRC/深/b.js"]), []);
  assert.deepEqual(f.intentUnowned(intent, ["docs/b.md"]), ["docs/b.md"]);
});
